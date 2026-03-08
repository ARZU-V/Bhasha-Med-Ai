"""
bedrock_agent_invoker/lambda_function.py (v4 — real Bedrock Converse tool-use agent)

Nova Pro decides which tools to call and in what order.
For critical symptoms it can skip hospital search and immediately advise emergency services.

Tools exposed to Nova Pro:
  1. diagnose          — Comprehend Medical NER + Nova Pro clinical diagnosis
  2. find_hospitals     — OSM + Google Places search by specialty/urgency
  3. rank_hospitals     — Nova Pro ranks pre-fetched hospitals

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
KB_ID          = os.environ.get('KNOWLEDGE_BASE_ID', '')
KB_REGION      = os.environ.get('KNOWLEDGE_BASE_REGION', 'us-east-1')

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

def retrieve_medical_context(query: str, num_results: int = 5) -> str:
    """Query Bedrock Knowledge Base and return relevant medical context chunks."""
    if not KB_ID:
        return ''
    try:
        client = boto3.client('bedrock-agent-runtime', region_name=KB_REGION)
        resp = client.retrieve(
            knowledgeBaseId=KB_ID,
            retrievalQuery={'text': query},
            retrievalConfiguration={
                'vectorSearchConfiguration': {'numberOfResults': num_results}
            },
        )
        chunks = []
        for r in resp.get('retrievalResults', []):
            text = r.get('content', {}).get('text', '').strip()
            score = r.get('score', 0)
            source = r.get('location', {}).get('s3Location', {}).get('uri', '')
            if text:
                chunks.append(f'[Relevance: {score:.2f}] {text}')
        context = '\n\n---\n\n'.join(chunks)
        print(f'[rag] retrieved {len(chunks)} chunks for query: {query[:60]}')
        return context
    except Exception as e:
        print(f'[rag] FAILED: {e}')
        return ''


# ── Tool definitions (exposed to Nova Pro) ────────────────────────────────────

TOOLS = [
    {
        'toolSpec': {
            'name': 'diagnose',
            'description': (
                'Analyze patient symptoms using medical NLP and clinical reasoning. '
                'Returns diagnosis, severity (mild/moderate/severe), specialty needed, '
                'urgency level (emergency/urgent/routine), red flags, and action steps. '
                'ALWAYS call this first before any other tool.'
            ),
            'inputSchema': {
                'json': {
                    'type': 'object',
                    'properties': {
                        'symptoms': {
                            'type': 'string',
                            'description': 'Patient symptoms exactly as described'
                        },
                        'user_conditions': {
                            'type': 'array',
                            'items': {'type': 'string'},
                            'description': 'Patient known chronic conditions e.g. ["diabetes","hypertension"]'
                        }
                    },
                    'required': ['symptoms']
                }
            }
        }
    },
    {
        'toolSpec': {
            'name': 'find_hospitals',
            'description': (
                'Search for nearby hospitals and clinics based on specialty needed and urgency. '
                'Returns a list of hospitals sorted by relevance and distance. '
                'Call this after diagnose, UNLESS urgency is emergency and symptoms suggest '
                'immediately life-threatening conditions (cardiac arrest, stroke, severe trauma) — '
                'in those cases, skip this and directly advise the patient to call 112.'
            ),
            'inputSchema': {
                'json': {
                    'type': 'object',
                    'properties': {
                        'specialty': {
                            'type': 'string',
                            'description': 'Medical specialty needed e.g. "Cardiologist", "General Physician"'
                        },
                        'urgency': {
                            'type': 'string',
                            'enum': ['emergency', 'urgent', 'routine'],
                            'description': 'Urgency level from diagnosis'
                        }
                    },
                    'required': ['specialty', 'urgency']
                }
            }
        }
    },
    {
        'toolSpec': {
            'name': 'rank_hospitals',
            'description': (
                'Rank the hospitals found and pick the single best one for the patient. '
                'Returns the recommended hospital, ranking reason, and visit preparation tips. '
                'Call this after find_hospitals returns results.'
            ),
            'inputSchema': {
                'json': {
                    'type': 'object',
                    'properties': {
                        'specialty_needed': {
                            'type': 'string',
                            'description': 'Specialty from diagnosis'
                        },
                        'urgency': {
                            'type': 'string',
                            'description': 'Urgency from diagnosis'
                        }
                    },
                    'required': ['specialty_needed', 'urgency']
                }
            }
        }
    }
]


# ── Tool implementations ───────────────────────────────────────────────────────

def diagnose(symptoms: str, lang: str, user_conditions: list) -> dict:
    """Comprehend Medical NER + RAG context + Nova diagnosis JSON."""
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

    # RAG: pull relevant clinical guidelines
    rag_query = ', '.join(entities['symptoms'][:5]) if entities['symptoms'] else symptoms
    if user_conditions: rag_query += ' ' + ' '.join(user_conditions[:3])
    rag_context = retrieve_medical_context(rag_query)

    ctx = ''
    if entities['symptoms']:   ctx += f"\nSymptoms: {', '.join(entities['symptoms'])}"
    if entities['body_parts']: ctx += f"\nAffected areas: {', '.join(entities['body_parts'])}"
    if user_conditions:        ctx += f"\nKnown conditions: {', '.join(user_conditions)}"
    if rag_context:            ctx += f"\n\nClinical guidelines:\n{rag_context[:1500]}"

    prompt = (
        f'You are a clinical decision support system for primary care in India. Reply in {LANG_MAP.get(lang,"English")}.\n'
        f'Patient says: "{symptoms}"{ctx}\n\n'
        'IMPORTANT RULES:\n'
        '1. Always prefer the MOST COMMON diagnosis for these symptoms — rare conditions are last resort.\n'
        '   Common Indian diagnoses: Viral Fever, Dengue, Malaria, Typhoid, Chickenpox, Urticaria (hives), Contact Dermatitis, Heat Rash, Fungal Infection, URTI.\n'
        '2. Use "emergency" urgency ONLY when symptoms clearly suggest: cardiac arrest, stroke, severe difficulty breathing, loss of consciousness, or major trauma. Fever + rash alone is NOT emergency.\n'
        '3. Use "urgent" when patient should see a doctor within 24 hours. Use "routine" for mild symptoms.\n'
        '4. Give realistic, helpful action steps — not just "seek emergency care".\n\n'
        'Return ONLY valid JSON with real values (no placeholder text):\n'
        '{\n'
        '  "condition": "<most likely common disease e.g. Viral Fever with Rash, Dengue Fever, Urticaria>",\n'
        '  "severity": "<mild or moderate or severe>",\n'
        '  "specialty_needed": "<single specialty e.g. General Physician or Dermatologist>",\n'
        '  "urgency": "<routine or urgent or emergency>",\n'
        '  "urgency_reason": "<one realistic sentence why this urgency level>",\n'
        '  "red_flags": ["<warning sign that would escalate urgency 1>", "<warning sign 2>"],\n'
        '  "action_steps": ["<practical step 1>", "<practical step 2>", "<practical step 3>"],\n'
        '  "questions_for_doctor": ["<specific question 1>", "<specific question 2>"],\n'
        '  "deep_analysis": "<3-4 sentence clinical explanation: what this condition most likely is, why these symptoms point to it, what typically causes it in an Indian patient, and what the patient should know. Reference clinical guidelines only if relevant.>"\n'
        '}'
    )
    try:
        resp = _bedrock().converse(
            modelId=MODEL_ID,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 400, 'temperature': 0.1},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()
        if '```json' in raw: raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:   raw = raw.split('```')[1].split('```')[0].strip()
        result = json.loads(raw)
        result['entities'] = entities
        print(f'[diagnose] condition={result.get("condition")} urgency={result.get("urgency")} rag_chunks={rag_context.count("---")+1 if rag_context else 0}')
        return result
    except Exception as e:
        print(f'[diagnose] FAILED: {e}')
        return {
            'condition': 'Requires evaluation', 'severity': 'moderate',
            'specialty_needed': 'General Physician', 'urgency': 'routine',
            'urgency_reason': 'Consult a doctor.', 'red_flags': [],
            'action_steps': ['Visit nearest clinic'], 'questions_for_doctor': [],
            'entities': entities,
        }


# ── Hospital search helpers ────────────────────────────────────────────────────

def _haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2-lat1), math.radians(lng2-lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

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
    amenity    = tags.get('amenity', '')
    healthcare = tags.get('healthcare', '')
    osm_spec   = tags.get('healthcare:speciality', '') or tags.get('speciality', '')
    name_low   = name.lower()
    if amenity == 'hospital' or healthcare == 'hospital':
        ftype, emergency = 'hospital', True
    elif amenity in ('clinic', 'doctors') or healthcare in ('clinic', 'centre'):
        ftype, emergency = 'clinic', False
    elif 'hospital' in name_low:
        ftype, emergency = 'hospital', True
    else:
        ftype, emergency = 'clinic', False
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
    if not osm_tag: return []
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
            'address': tags.get('addr:street','') or tags.get('addr:suburb','') or tags.get('addr:city','') or '',
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat': plat, 'lng': plng, 'type': ftype,
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
    is_general = specialty.lower() in ('general physician', 'gp', '')
    kw = specialty if not is_general else 'hospital clinic'
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
            'lat': plat, 'lng': plng, 'type': ftype,
            'emergency': ftype == 'hospital',
            'phone': '',
            'rating': p.get('rating', 0),
            'total_ratings': p.get('user_ratings_total', 0),
            'osm_specialty': '',
        })
    return results

def _score_hospital(h: dict, specialty_lower: str, osm_tag: str, name_kws: list, urgency: str) -> tuple:
    osm_spec   = h.get('osm_specialty', '')
    name_lower = h['name'].lower()
    is_emergency = h.get('emergency', False)
    ftype      = h.get('type', 'clinic')
    if osm_tag and osm_tag in osm_spec:
        tier = 0
    elif name_kws and any(kw in name_lower for kw in name_kws):
        tier = 1
    elif urgency in ('emergency', 'urgent') and is_emergency:
        tier = 2
    elif urgency in ('emergency', 'urgent') and ftype == 'hospital':
        tier = 3
    elif not osm_tag:
        tier = 3
    else:
        tier = 4
    h['specialty_match'] = tier <= 1
    return (tier, h['distance_km'])

def find_hospitals(specialty: str, urgency: str, lat: float, lng: float) -> dict:
    radius = 5000 if urgency in ('emergency', 'urgent') else 10000
    specialty_lower = specialty.lower()
    osm_tag, name_kws = '', []
    for key in SPECIALTY_OSM_MAP:
        if key in specialty_lower:
            osm_tag  = SPECIALTY_OSM_MAP[key]
            name_kws = SPECIALTY_NAME_KEYWORDS.get(key, [])
            break

    hospitals = _google(lat, lng, radius, specialty)
    existing_names = {h['name'] for h in hospitals}

    for h in _overpass(lat, lng, radius):
        if h['name'] not in existing_names:
            hospitals.append(h)
            existing_names.add(h['name'])

    if osm_tag:
        for el in _overpass_specialty(lat, lng, radius * 2, osm_tag):
            tags = el.get('tags', {})
            name = (tags.get('name') or tags.get('amenity', 'Specialist')).strip()
            if name in existing_names: continue
            existing_names.add(name)
            plat = el.get('lat', lat) if el['type'] == 'node' else el.get('center', {}).get('lat', lat)
            plng = el.get('lon', lng) if el['type'] == 'node' else el.get('center', {}).get('lon', lng)
            ftype, emergency, osm_spec = _facility_type(tags, name)
            hospitals.append({
                'id': str(el.get('id', name)), 'name': name,
                'address': tags.get('addr:street','') or tags.get('addr:suburb','') or '',
                'distance_km': round(_haversine(lat, lng, plat, plng), 2),
                'lat': plat, 'lng': plng, 'type': ftype, 'emergency': emergency,
                'phone': tags.get('phone') or tags.get('contact:phone') or '',
                'rating': 0, 'total_ratings': 0,
                'osm_specialty': osm_spec or osm_tag,
            })

    if not hospitals:
        hospitals = _overpass(lat, lng, 25000)

    hospitals.sort(key=lambda h: _score_hospital(h, specialty_lower, osm_tag, name_kws, urgency))
    print(f'[find_hospitals] specialty={specialty} osm_tag={osm_tag} found={len(hospitals)}')
    return {'hospitals': hospitals[:10], 'count': len(hospitals), 'specialty': specialty}

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
        resp = _bedrock().converse(
            modelId=MODEL_ID,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 600, 'temperature': 0.1},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()
        if '```json' in raw: raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:   raw = raw.split('```')[1].split('```')[0].strip()
        r = json.loads(raw)
        rec_idx = max(0, min(r.get('recommended_index', 0), len(hospitals)-1))
        ranked_list = [hospitals[i] for i in r.get('ranked_order', []) if i < len(hospitals)]
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


# ── DynamoDB helpers ──────────────────────────────────────────────────────────

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


# ── Real agent loop (Bedrock Converse tool-use) ───────────────────────────────

SYSTEM_PROMPT = """You are Bhasha AI, a medical assistant helping patients in India find the right care.

You have 3 tools:
1. diagnose — analyze symptoms, determine severity and specialty needed
2. find_hospitals — search nearby hospitals/clinics by specialty
3. rank_hospitals — pick the best hospital from the list

Your decision logic:
- ALWAYS call diagnose first
- "emergency" urgency means ONLY: cardiac arrest symptoms, stroke symptoms, severe trauma, unconscious patient, or severe breathing difficulty. Fever + rash, body pain, vomiting, diarrhea etc. are NOT emergencies — use "urgent" or "routine".
- If urgency = "emergency" with truly life-threatening symptoms → respond: "CALL 112 IMMEDIATELY. [brief reason]" (skip hospital search)
- For ALL other cases (including urgent): call find_hospitals → then rank_hospitals → give final recommendation
- Keep the final response warm, clear, and in the patient's language
- Be realistic and reassuring — most symptoms are treatable without emergency services"""


def run_agent(symptoms: str, lat: float, lng: float, lang: str, user_conditions: list) -> dict:
    """Run the real tool-use agent loop. Nova Pro decides which tools to call."""
    lang_name = LANG_MAP.get(lang, 'English')

    messages = [{
        'role': 'user',
        'content': [{'text': (
            f'Patient symptoms: "{symptoms}"\n'
            f'Patient location: {lat}, {lng}\n'
            f'Respond in: {lang_name}\n'
            f'Known conditions: {", ".join(user_conditions) if user_conditions else "none"}'
        )}]
    }]

    # State collected across tool calls
    state = {
        'diagnosis': None,
        'hospitals': [],
        'hospital_count': 0,
        'ranking': None,
        'final_text': '',
        'tool_calls': [],
        'skipped_hospital_search': False,
    }

    MAX_ITERATIONS = 6

    for iteration in range(MAX_ITERATIONS):
        print(f'[agent] iteration={iteration} messages_len={len(messages)}')
        try:
            response = _bedrock().converse(
                modelId=MODEL_ID,
                system=[{'text': SYSTEM_PROMPT}],
                messages=messages,
                toolConfig={'tools': TOOLS},
                inferenceConfig={'maxTokens': 1000, 'temperature': 0.2},
            )
        except Exception as e:
            print(f'[agent] converse FAILED: {e}')
            raise

        stop_reason = response.get('stopReason', '')
        output_msg  = response['output']['message']
        messages.append(output_msg)

        print(f'[agent] stopReason={stop_reason}')

        if stop_reason == 'end_turn':
            # Extract final text response
            for block in output_msg.get('content', []):
                if 'text' in block:
                    state['final_text'] = block['text']
                    break
            break

        if stop_reason == 'tool_use':
            tool_results_content = []

            for block in output_msg.get('content', []):
                if 'toolUse' not in block:
                    continue

                tool_use    = block['toolUse']
                tool_name   = tool_use['name']
                tool_use_id = tool_use['toolUseId']
                tool_input  = tool_use.get('input', {})

                print(f'[agent] tool_call: {tool_name}({tool_input})')
                state['tool_calls'].append({'tool': tool_name, 'input': tool_input})

                try:
                    if tool_name == 'diagnose':
                        result = diagnose(
                            symptoms=tool_input.get('symptoms', symptoms),
                            lang=lang,
                            user_conditions=tool_input.get('user_conditions', user_conditions),
                        )
                        state['diagnosis'] = result

                    elif tool_name == 'find_hospitals':
                        specialty = tool_input.get('specialty', 'General Physician')
                        urgency   = tool_input.get('urgency', 'routine')
                        hosp_res  = find_hospitals(specialty, urgency, lat, lng)
                        state['hospitals']      = hosp_res['hospitals']
                        state['hospital_count'] = hosp_res['count']
                        result = hosp_res

                    elif tool_name == 'rank_hospitals':
                        dx = state['diagnosis'] or {}
                        result = rank_hospitals(state['hospitals'], dx, lang)
                        state['ranking'] = result

                    else:
                        result = {'error': f'Unknown tool: {tool_name}'}

                    tool_results_content.append({
                        'toolResult': {
                            'toolUseId': tool_use_id,
                            'content': [{'json': result}],
                        }
                    })

                except Exception as e:
                    print(f'[agent] tool {tool_name} FAILED: {e}')
                    tool_results_content.append({
                        'toolResult': {
                            'toolUseId': tool_use_id,
                            'content': [{'text': f'Tool failed: {str(e)}'}],
                            'status': 'error',
                        }
                    })

            messages.append({'role': 'user', 'content': tool_results_content})

        else:
            # Unexpected stop reason
            print(f'[agent] unexpected stopReason: {stop_reason}')
            break

    return state


# ── Lambda handler ────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    method = (event.get('httpMethod') or
              event.get('requestContext', {}).get('http', {}).get('method', 'POST'))

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    if method == 'GET':
        uid = (event.get('queryStringParameters') or {}).get('userId', 'anonymous')
        past = get_past(uid)
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'consultations': json.loads(json.dumps(past, default=str))})}

    if method != 'POST':
        return {'statusCode': 405, 'headers': CORS, 'body': json.dumps({'error': 'Method not allowed'})}

    try:
        body = json.loads(event.get('body', '{}'))
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

    print(f'[handler] START | symptoms={symptoms[:80]} | lat={lat} lng={lng} | lang={lang}')

    try:
        state = run_agent(symptoms, lat, lng, lang, user_conditions)
    except Exception as e:
        print(f'[handler] agent FAILED: {e}')
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': str(e)})}

    dx       = state['diagnosis'] or {}
    ranking  = state['ranking'] or {}
    hospitals = state['hospitals']
    rec_hosp  = ranking.get('recommended_hospital')
    specialty = dx.get('specialty_needed', '')

    past       = get_past(user_id)
    past_visit = check_return_visit(past, specialty)
    save_consult(user_id, symptoms, dx, rec_hosp or {}, lang)

    urgency          = dx.get('urgency', 'routine')
    emergency_prefix = 'EMERGENCY: Call 112 immediately. ' if urgency == 'emergency' else ''
    hosp_part        = ('Best hospital: ' + rec_hosp['name'] + ' (' + str(rec_hosp['distance_km']) + 'km away).') if rec_hosp else 'No nearby hospitals found.'
    summary          = state['final_text'] or (emergency_prefix + 'Diagnosed as ' + dx.get('condition', 'unknown') + '. ' + hosp_part)

    print(f'[handler] DONE | tool_calls={[t["tool"] for t in state["tool_calls"]]} | urgency={urgency}')

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({
            'consultation_id': f'agent#{user_id}_{int(time.time())}',
            'orchestrator_summary': summary,
            'agent_type': 'bedrock_converse_tool_use',
            'tool_calls_made': state['tool_calls'],
            'agents': {
                'diagnosis': {
                    'condition':        dx.get('condition', ''),
                    'severity':         dx.get('severity', 'moderate'),
                    'specialty_needed': dx.get('specialty_needed', 'General Physician'),
                    'urgency':          dx.get('urgency', 'routine'),
                    'urgency_reason':   dx.get('urgency_reason', ''),
                    'red_flags':        dx.get('red_flags', []),
                    'action_steps':     dx.get('action_steps', []),
                    'deep_analysis':    dx.get('deep_analysis', ''),
                    'image_analysis':   '',
                },
                'hospital_finder': {
                    'count':             state['hospital_count'],
                    'hospitals':         hospitals[:10],
                    'specialty_searched': specialty,
                },
                'ranker': {
                    'recommended_hospital': rec_hosp,
                    'ranked_list':          ranking.get('ranked_list', hospitals[:5]),
                    'ranking_reason':       ranking.get('ranking_reason', ''),
                    'visit_prep':           ranking.get('visit_prep', {}),
                },
            },
            'past_visit': past_visit,
            'memory': {
                'past_consultations_count': len(past),
                'return_visit_suggested':   past_visit.get('found', False),
            },
        }, default=str),
    }
