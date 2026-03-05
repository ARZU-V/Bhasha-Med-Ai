"""
bedrock_agent_invoker/lambda_function.py (v3 — direct pipeline, no Bedrock Agent)

Calls diagnose -> find_hospitals -> rank_hospitals directly in sequence.
No LLM orchestration loop needed. Uses Nova Pro only for actual diagnosis + ranking.

Env vars:
  BEDROCK_REGION       -- ap-south-1
  APP_REGION           -- ap-south-1
  DYNAMODB_MAIN_TABLE  -- BhashaAIMain
  GOOGLE_MAPS_API_KEY  -- optional
  NOVA_MODEL_ID        -- amazon.nova-pro-v1:0
"""

import json, boto3, os, math, time, urllib.request, urllib.parse
from datetime import datetime, timezone

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'ap-south-1')
APP_REGION     = os.environ.get('APP_REGION', 'ap-south-1')
TABLE_NAME     = os.environ.get('DYNAMODB_MAIN_TABLE', 'BhashaAIMain')
GOOGLE_KEY     = os.environ.get('GOOGLE_MAPS_API_KEY', '')
MODEL_ID       = os.environ.get('NOVA_MODEL_ID', 'amazon.nova-pro-v1:0')

LANG_MAP = {
    'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil', 'en': 'English',
    'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
    'kn': 'Kannada', 'ml': 'Malayalam', 'pa': 'Punjabi',
}

def _bedrock():
    return boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)

def _comprehend():
    return boto3.client('comprehendmedical', region_name='us-east-1')

def _dynamo():
    return boto3.resource('dynamodb', region_name=APP_REGION).Table(TABLE_NAME)

def _nova(prompt, max_tokens=700):
    try:
        resp = _bedrock().converse(
            modelId=MODEL_ID,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': max_tokens, 'temperature': 0.1},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()
        if '```json' in raw: raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:   raw = raw.split('```')[1].split('```')[0].strip()
        print(f'[nova] raw response (first 300): {raw[:300]}')
        return raw
    except Exception as e:
        print(f'[nova] FAILED: {e}')
        raise

# ── Step 1: Diagnose ──────────────────────────────────────────────────────────

def diagnose(symptoms: str, lang: str, user_conditions: list) -> dict:
    entities = {'symptoms': [], 'conditions': [], 'medications': [], 'body_parts': []}
    try:
        for e in _comprehend().detect_entities_v2(Text=symptoms[:20000]).get('Entities', []):
            if e.get('Score', 0) < 0.6: continue
            cat, val = e['Category'], e['Text']
            if   cat == 'SIGN_OR_SYMPTOM':   entities['symptoms'].append(val)
            elif cat == 'MEDICAL_CONDITION': entities['conditions'].append(val)
            elif cat == 'MEDICATION':        entities['medications'].append(val)
            elif cat == 'ANATOMY':           entities['body_parts'].append(val)
        for k in entities: entities[k] = list(dict.fromkeys(entities[k]))
    except Exception as e:
        print(f'[comprehend] {e}')

    ctx = ''
    if entities['symptoms']:    ctx += f"\nSymptoms detected: {', '.join(entities['symptoms'])}"
    if entities['body_parts']:  ctx += f"\nAffected areas: {', '.join(entities['body_parts'])}"
    if user_conditions:         ctx += f"\nKnown conditions: {', '.join(user_conditions)}"

    prompt = (
        f'You are a clinical decision support system. Reply in {LANG_MAP.get(lang,"English")}.\n'
        f'Patient says: "{symptoms}"{ctx}\n\n'
        'Return ONLY valid JSON (no extra text):\n'
        '{"condition":"diagnosis","severity":"mild|moderate|severe",'
        '"specialty_needed":"specialty","urgency":"emergency|urgent|routine",'
        '"urgency_reason":"reason","red_flags":["flag1"],'
        '"action_steps":["step1","step2"],"questions_for_doctor":["q1","q2"]}'
    )
    try:
        result = json.loads(_nova(prompt))
        result['entities'] = entities
        return result
    except Exception as e:
        print(f'[diagnose] {e}')
        return {
            'condition': 'Requires evaluation', 'severity': 'moderate',
            'specialty_needed': 'General Physician', 'urgency': 'routine',
            'urgency_reason': 'Consult a doctor.', 'red_flags': [],
            'action_steps': ['Visit nearest clinic'], 'questions_for_doctor': [],
            'entities': entities,
        }

# ── Step 2: Find hospitals ────────────────────────────────────────────────────

def _haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2-lat1), math.radians(lng2-lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# Maps specialty → OSM healthcare:speciality tag values
SPECIALTY_OSM_MAP = {
    'cardiologist':     'cardiology',
    'orthopedic':       'orthopaedics',
    'orthopedist':      'orthopaedics',
    'neurologist':      'neurology',
    'gynecologist':     'gynaecology',
    'gynaecologist':    'gynaecology',
    'pediatrician':     'paediatrics',
    'paediatrician':    'paediatrics',
    'dermatologist':    'dermatology',
    'ophthalmologist':  'ophthalmology',
    'ent':              'otolaryngology',
    'psychiatrist':     'psychiatry',
    'urologist':        'urology',
    'pulmonologist':    'pulmonology',
    'gastroenterologist': 'gastroenterology',
    'oncologist':       'oncology',
    'endocrinologist':  'endocrinology',
    'nephrologist':     'nephrology',
    'rheumatologist':   'rheumatology',
    'dentist':          'dentistry',
}

# Name-based keywords for specialty matching (fallback when OSM tags not present)
SPECIALTY_NAME_KEYWORDS = {
    'cardiologist':     ['cardiac','heart','cardio'],
    'orthopedic':       ['ortho','bone','joint'],
    'orthopedist':      ['ortho','bone','joint'],
    'neurologist':      ['neuro','brain','nerve'],
    'gynecologist':     ['gynae','gyneco','women','maternity','obstet'],
    'gynaecologist':    ['gynae','gyneco','women','maternity','obstet'],
    'pediatrician':     ['child','pediatric','paediatric'],
    'paediatrician':    ['child','pediatric','paediatric'],
    'dermatologist':    ['skin','derm','cosmet'],
    'ophthalmologist':  ['eye','ophthal','vision'],
    'ent':              ['ent','ear','nose','throat'],
    'psychiatrist':     ['mental','psychiatr','psycholog'],
    'urologist':        ['urol','kidney','urinary'],
    'dentist':          ['dental','dent','teeth'],
    'oncologist':       ['cancer','oncol','tumor'],
}

def _facility_type(tags: dict, name: str) -> tuple:
    """Return (type_label, is_emergency, specialty_tags) from OSM tags."""
    amenity   = tags.get('amenity', '')
    healthcare = tags.get('healthcare', '')
    osm_spec  = tags.get('healthcare:speciality', '') or tags.get('speciality', '')
    name_low  = name.lower()

    if amenity == 'hospital' or healthcare == 'hospital':
        ftype = 'hospital'
        emergency = True
    elif amenity in ('clinic', 'doctors') or healthcare in ('clinic', 'centre'):
        ftype = 'clinic'
        emergency = False
    elif 'hospital' in name_low:
        ftype = 'hospital'
        emergency = True
    else:
        ftype = 'clinic'
        emergency = False

    return ftype, emergency, osm_spec.lower()


def _overpass_query(query: str) -> list:
    try:
        req = urllib.request.Request(
            'https://overpass-api.de/api/interpreter',
            data=urllib.parse.urlencode({'data': query}).encode(),
            headers={'User-Agent': 'BhashaAI/1.0'}, method='POST',
        )
        with urllib.request.urlopen(req, timeout=16) as r:
            return json.loads(r.read().decode()).get('elements', [])
    except Exception as e:
        print(f'[overpass] {e}'); return []

def _overpass_specialty(lat, lng, radius_m, osm_tag: str) -> list:
    """Extra query to find facilities with a specific OSM healthcare:speciality tag."""
    if not osm_tag:
        return []
    q = (f'[out:json][timeout:12];'
         f'(node["healthcare:speciality"~"{osm_tag}"](around:{radius_m},{lat},{lng});'
         f'way["healthcare:speciality"~"{osm_tag}"](around:{radius_m},{lat},{lng});'
         f'node["speciality"~"{osm_tag}"](around:{radius_m},{lat},{lng});'
         f'node["amenity"="doctors"]["healthcare:speciality"~"{osm_tag}"](around:{radius_m},{lat},{lng});'
         f');out center tags;')
    return _overpass_query(q)

def _overpass(lat, lng, radius_m):
    q = (f'[out:json][timeout:18];'
         f'(node["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat},{lng});'
         f'way["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat},{lng});'
         f'node["healthcare"~"^(hospital|clinic|centre|doctor)$"](around:{radius_m},{lat},{lng});'
         f'way["healthcare"~"^(hospital|clinic|centre|doctor)$"](around:{radius_m},{lat},{lng});'
         f');out center tags;')
    elements = _overpass_query(q)
    results, seen = [], set()
    for el in elements:
        tags = el.get('tags', {})
        name = (tags.get('name') or tags.get('amenity', 'Medical Facility')).strip()
        plat = el.get('lat', lat) if el['type'] == 'node' else el.get('center', {}).get('lat', lat)
        plng = el.get('lon', lng) if el['type'] == 'node' else el.get('center', {}).get('lon', lng)
        key = f'{name}_{round(plat,4)}_{round(plng,4)}'
        if key in seen: continue
        seen.add(key)
        ftype, emergency, osm_spec = _facility_type(tags, name)
        results.append({
            'id': str(el.get('id', key)), 'name': name,
            'address': tags.get('addr:street', '') or tags.get('addr:suburb', '') or tags.get('addr:city', '') or '',
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat': plat, 'lng': plng,
            'type': ftype,
            'emergency': emergency,
            'phone': tags.get('phone') or tags.get('contact:phone') or '',
            'rating': 0, 'total_ratings': 0,
            'osm_specialty': osm_spec,
        })
    return sorted(results, key=lambda h: h['distance_km'])

def _google_search(lat, lng, radius_m, keyword, place_type):
    url = (f'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
           f'?location={lat},{lng}&radius={radius_m}&type={place_type}'
           f'&keyword={urllib.parse.quote(keyword)}&key={GOOGLE_KEY}')
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return json.loads(r.read().decode()).get('results', [])
    except Exception as e:
        print(f'[google:{place_type}] {e}'); return []

def _google(lat, lng, radius_m, specialty):
    if not GOOGLE_KEY: return []
    is_general = specialty in ('General Physician', 'GP', '')
    kw = specialty if not is_general else 'hospital clinic'

    # For general physician: search hospitals only
    # For specialist: search both hospitals AND individual doctor clinics
    places = _google_search(lat, lng, radius_m, kw, 'hospital')
    if not is_general:
        seen_ids = {p.get('place_id') for p in places}
        for p in _google_search(lat, lng, radius_m, kw, 'doctor'):
            if p.get('place_id') not in seen_ids:
                places.append(p)
                seen_ids.add(p.get('place_id'))

    results = []
    for p in places[:12]:
        loc = p.get('geometry', {}).get('location', {})
        if not loc: continue
        plat, plng = loc['lat'], loc['lng']
        types = p.get('types', [])
        ftype = 'hospital' if 'hospital' in types else 'clinic'
        results.append({
            'id': p.get('place_id', ''), 'name': p.get('name', 'Clinic'),
            'address': p.get('vicinity', ''),
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat': plat, 'lng': plng,
            'type': ftype,
            'emergency': ftype == 'hospital',
            'phone': '',
            'rating': p.get('rating', 0),
            'total_ratings': p.get('user_ratings_total', 0),
            'osm_specialty': '',
        })
    return results

def _score_hospital(h: dict, specialty_lower: str, osm_tag: str, name_kws: list, urgency: str) -> tuple:
    """
    Returns sort key (lower = better):
      0: exact OSM specialty tag match
      1: name keyword match
      2: hospital with emergency (for urgent/emergency cases)
      3: general hospital
      4: clinic
    Secondary key: distance_km
    """
    osm_spec   = h.get('osm_specialty', '')
    name_lower = h['name'].lower()
    is_emergency = h.get('emergency', False)
    ftype      = h.get('type', 'clinic')

    if osm_tag and osm_tag in osm_spec:
        tier = 0  # OSM specialty tag match — best
    elif name_kws and any(kw in name_lower for kw in name_kws):
        tier = 1  # Name keyword match (e.g. "Bone & Joint Clinic")
    elif urgency in ('emergency', 'urgent') and is_emergency:
        tier = 2  # Emergency hospital — critical for urgent/emergency
    elif urgency in ('emergency', 'urgent') and ftype == 'hospital':
        tier = 3  # Any hospital for urgent
    elif not osm_tag:
        # No specialty needed (General Physician / routine) — sort purely by distance
        tier = 3
    else:
        # Specialist needed but this place doesn't match — deprioritize
        tier = 4

    h['specialty_match'] = tier <= 1
    return (tier, h['distance_km'])


def find_hospitals(specialty: str, lat: float, lng: float, urgency: str) -> dict:
    radius = 5000 if urgency in ('emergency', 'urgent') else 10000

    # Resolve specialty to OSM tag and name keywords first (needed for specialty query)
    specialty_lower = specialty.lower()
    osm_tag  = ''
    name_kws = []
    for key in SPECIALTY_OSM_MAP:
        if key in specialty_lower:
            osm_tag  = SPECIALTY_OSM_MAP[key]
            name_kws = SPECIALTY_NAME_KEYWORDS.get(key, [])
            break

    hospitals = _google(lat, lng, radius, specialty)
    existing_names = {h['name'] for h in hospitals}

    # General OSM search
    for h in _overpass(lat, lng, radius):
        if h['name'] not in existing_names:
            hospitals.append(h)
            existing_names.add(h['name'])

    # Specialty-specific OSM search (catches specialist clinics not tagged as hospital/clinic)
    if osm_tag:
        spec_radius = radius * 2  # wider radius for specialists — they're rarer
        for el in _overpass_specialty(lat, lng, spec_radius, osm_tag):
            tags = el.get('tags', {})
            name = (tags.get('name') or tags.get('amenity', 'Specialist')).strip()
            if name in existing_names:
                continue
            existing_names.add(name)
            plat = el.get('lat', lat) if el['type'] == 'node' else el.get('center', {}).get('lat', lat)
            plng = el.get('lon', lng) if el['type'] == 'node' else el.get('center', {}).get('lon', lng)
            ftype, emergency, osm_spec = _facility_type(tags, name)
            hospitals.append({
                'id': str(el.get('id', name)), 'name': name,
                'address': tags.get('addr:street', '') or tags.get('addr:suburb', '') or '',
                'distance_km': round(_haversine(lat, lng, plat, plng), 2),
                'lat': plat, 'lng': plng,
                'type': ftype, 'emergency': emergency,
                'phone': tags.get('phone') or tags.get('contact:phone') or '',
                'rating': 0, 'total_ratings': 0,
                'osm_specialty': osm_spec or osm_tag,
            })

    if not hospitals:
        hospitals = _overpass(lat, lng, 25000)

    # Score and sort
    hospitals.sort(key=lambda h: _score_hospital(h, specialty_lower, osm_tag, name_kws, urgency))

    print(f'[find_hospitals] specialty={specialty} osm_tag={osm_tag} name_kws={name_kws} found={len(hospitals)}')
    return {'hospitals': hospitals[:10], 'count': len(hospitals), 'specialty': specialty}

# ── Step 3: Rank hospitals ────────────────────────────────────────────────────

def rank_hospitals(hospitals: list, diagnosis: dict, lang: str) -> dict:
    if not hospitals:
        return {
            'recommended_hospital': None, 'ranked_list': [],
            'ranking_reason': 'No hospitals found nearby.',
            'visit_prep': {
                'urgency_note': diagnosis.get('urgency_reason',''),
                'questions_to_ask': diagnosis.get('questions_for_doctor',[]),
                'what_to_bring': ['Government ID','Previous reports','Insurance card'],
                'transport_tip': '',
            },
        }

    hosp_text = '\n'.join(
        f'{i+1}. {h["name"]} | {h["distance_km"]}km'
        f'{" | Emergency" if h.get("emergency") else ""}'
        f'{" | " + h["phone"] if h.get("phone") else ""}'
        for i, h in enumerate(hospitals[:8])
    )
    prompt = (
        f'Hospital recommendation engine. Reply in {LANG_MAP.get(lang,"English")}.\n'
        f'Diagnosis: {diagnosis.get("condition","?")} | Urgency: {diagnosis.get("urgency","routine")} | '
        f'Specialty: {diagnosis.get("specialty_needed","GP")}\n\n'
        f'Hospitals:\n{hosp_text}\n\n'
        'Return ONLY valid JSON:\n'
        '{"recommended_index":0,"ranking_reason":"reason","urgency_note":"note",'
        '"questions_to_ask":["q1","q2","q3"],"what_to_bring":["item1","item2"],'
        '"transport_tip":"tip","ranked_order":[0,1,2]}'
    )
    try:
        r = json.loads(_nova(prompt))
        rec_idx = max(0, min(r.get('recommended_index',0), len(hospitals)-1))
        ranked_list = [hospitals[i] for i in r.get('ranked_order',[]) if i < len(hospitals)]
        if not ranked_list: ranked_list = hospitals[:5]
        return {
            'recommended_hospital': hospitals[rec_idx],
            'ranked_list': ranked_list,
            'ranking_reason': r.get('ranking_reason',''),
            'visit_prep': {
                'urgency_note':     r.get('urgency_note',''),
                'questions_to_ask': r.get('questions_to_ask', diagnosis.get('questions_for_doctor',[])),
                'what_to_bring':    r.get('what_to_bring',['Government ID','Previous reports']),
                'transport_tip':    r.get('transport_tip',''),
            },
        }
    except Exception as e:
        print(f'[rank] {e}')
        return {
            'recommended_hospital': hospitals[0], 'ranked_list': hospitals[:5],
            'ranking_reason': 'Nearest hospital selected.',
            'visit_prep': {
                'urgency_note': diagnosis.get('urgency_reason',''),
                'questions_to_ask': diagnosis.get('questions_for_doctor',[]),
                'what_to_bring': ['Government ID (Aadhaar)','Previous prescriptions','Insurance card'],
                'transport_tip': '',
            },
        }

# ── DynamoDB ──────────────────────────────────────────────────────────────────

def get_past(user_id):
    try:
        from boto3.dynamodb.conditions import Key
        return _dynamo().query(
            KeyConditionExpression=Key('userId').eq(user_id) & Key('recordId').begins_with('consult#'),
            ScanIndexForward=False, Limit=5,
        ).get('Items', [])
    except: return []

def save_consult(user_id, symptoms, diagnosis, rec_hosp, lang):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        item = {
            'userId': user_id, 'recordId': f'consult#{ts}', 'timestamp': ts,
            'symptoms': symptoms[:500], 'diagnosedCondition': diagnosis.get('condition',''),
            'specialtyNeeded': diagnosis.get('specialty_needed',''),
            'urgency': diagnosis.get('urgency','routine'), 'language': lang,
        }
        if rec_hosp:
            item.update({
                'recommendedHospital': rec_hosp.get('name',''),
                'hospitalPhone': rec_hosp.get('phone',''),
                'hospitalLat': str(rec_hosp.get('lat','')),
                'hospitalLng': str(rec_hosp.get('lng','')),
            })
        _dynamo().put_item(Item=item)
    except Exception as e:
        print(f'[save] {e}')

def check_return_visit(past, specialty):
    if not past or not specialty: return {'found': False}
    for p in past:
        if p.get('specialtyNeeded','').lower() != specialty.lower(): continue
        ts = p.get('timestamp','')
        days_ago = 999
        try:
            days_ago = (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace('Z','+00:00'))).days
        except: pass
        if days_ago <= 90:
            hosp = p.get('recommendedHospital','the same clinic')
            return {
                'found': True, 'hospital_name': hosp,
                'hospital_phone': p.get('hospitalPhone',''),
                'condition': p.get('diagnosedCondition','similar symptoms'),
                'days_ago': days_ago,
                'suggestion': f'You visited {hosp} {days_ago} days ago for {p.get("diagnosedCondition","similar symptoms")}. Return to same clinic?',
            }
    return {'found': False}

# ── Lambda handler ────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    method = (event.get('httpMethod') or
              event.get('requestContext',{}).get('http',{}).get('method','POST'))

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    if method == 'GET':
        uid = (event.get('queryStringParameters') or {}).get('userId','anonymous')
        past = get_past(uid)
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'consultations': json.loads(json.dumps(past, default=str))})}

    if method != 'POST':
        return {'statusCode': 405, 'headers': CORS, 'body': json.dumps({'error': 'Method not allowed'})}

    try:
        body = json.loads(event.get('body','{}'))
    except:
        return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Invalid JSON'})}

    symptoms        = (body.get('symptoms') or body.get('question') or '').strip()
    lat             = float(body.get('lat', 28.6139))
    lng             = float(body.get('lng', 77.2090))
    lang            = body.get('language', 'en')
    user_conditions = body.get('userConditions') or []
    user_id         = body.get('userId', 'anonymous')

    if not symptoms:
        return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Provide symptoms'})}

    print(f'[pipeline] START | symptoms={symptoms[:80]} | lat={lat} lng={lng}')

    # Step 1: Diagnose
    dx = diagnose(symptoms, lang, user_conditions)
    print(f'[pipeline] diagnose done: {dx.get("condition")} | specialty={dx.get("specialty_needed")} | urgency={dx.get("urgency")}')

    # Step 2: Find hospitals
    hosp_res = find_hospitals(dx.get('specialty_needed','General Physician'), lat, lng, dx.get('urgency','routine'))
    print(f'[pipeline] hospitals found: {hosp_res["count"]}')

    # Step 3: Rank
    ranked = rank_hospitals(hosp_res['hospitals'], dx, lang)
    print(f'[pipeline] ranked done: recommended={ranked.get("recommended_hospital",{}).get("name") if ranked.get("recommended_hospital") else "none"}')

    hospitals = hosp_res.get('hospitals', [])
    rec_hosp  = ranked.get('recommended_hospital')
    specialty = dx.get('specialty_needed', '')

    past       = get_past(user_id)
    past_visit = check_return_visit(past, specialty)
    save_consult(user_id, symptoms, dx, rec_hosp or {}, lang)

    lang_name = LANG_MAP.get(lang, 'English')
    urgency   = dx.get('urgency','routine')
    emergency_prefix = 'EMERGENCY: Call 112 immediately. ' if urgency == 'emergency' else ''
    if rec_hosp:
        hosp_part = 'Best hospital: ' + rec_hosp['name'] + ' (' + str(rec_hosp['distance_km']) + 'km away).'
    else:
        hosp_part = 'No nearby hospitals found.'
    summary = emergency_prefix + 'Diagnosed as ' + dx.get('condition', 'unknown condition') + ' (' + dx.get('severity', 'moderate') + ' severity). ' + hosp_part

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({
            'consultation_id': f'direct#{user_id}_{int(time.time())}',
            'orchestrator_summary': summary,
            'agent_type': 'direct_pipeline',
            'agents': {
                'diagnosis': {
                    'condition':        dx.get('condition',''),
                    'severity':         dx.get('severity','moderate'),
                    'specialty_needed': dx.get('specialty_needed','General Physician'),
                    'urgency':          dx.get('urgency','routine'),
                    'urgency_reason':   dx.get('urgency_reason',''),
                    'red_flags':        dx.get('red_flags',[]),
                    'action_steps':     dx.get('action_steps',[]),
                    'image_analysis':   '',
                },
                'hospital_finder': {
                    'count': len(hospitals),
                    'hospitals': hospitals[:10],
                    'specialty_searched': specialty,
                },
                'ranker': {
                    'recommended_hospital': rec_hosp,
                    'ranked_list':          ranked.get('ranked_list', hospitals[:5]),
                    'ranking_reason':       ranked.get('ranking_reason',''),
                    'visit_prep':           ranked.get('visit_prep',{}),
                },
            },
            'past_visit': past_visit,
            'memory': {
                'past_consultations_count': len(past),
                'return_visit_suggested':   past_visit.get('found', False),
            },
        }, default=str),
    }
