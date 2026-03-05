"""
bedrock_agent_action/lambda_function.py

Action Group Lambda for the Bhasha AI Bedrock Agent.
Bedrock Agent calls this Lambda when it needs to execute a tool.

Tools:
  diagnose_symptoms  — Comprehend Medical NER + Nova Lite vision + Nova Pro reasoning
  find_hospitals     — Google Places / OpenStreetMap nearby search
  rank_hospitals     — Nova Pro ranking + visit prep guide

After each tool call, results are saved to DynamoDB (temp#agent#<sessionId>)
so the invoker Lambda can retrieve structured data after invoke_agent completes.

Event format (from Bedrock Agent):
  {
    "actionGroup": "HealthActions",
    "function": "diagnose_symptoms",
    "parameters": [{"name": "symptoms", "type": "string", "value": "..."}],
    "sessionId": "...",
    "sessionAttributes": {"lat": "28.6", "lng": "77.2", "lang": "en"},
    "promptSessionAttributes": {"userConditions": "diabetes,hypertension"}
  }
"""

import json
import boto3
import os
import base64
import math
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

# ── Config ─────────────────────────────────────────────────────────────────────

APP_REGION     = os.environ.get('APP_REGION',          'ap-south-1')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION',       'us-east-1')
TABLE_NAME     = os.environ.get('DYNAMODB_MAIN_TABLE',  'BhashaAIMain')
GOOGLE_KEY     = os.environ.get('GOOGLE_MAPS_API_KEY',  '')

SYNTHESIS_MODEL = 'us.amazon.nova-pro-v1:0'
VISION_MODEL    = 'us.amazon.nova-lite-v1:0'

LANG_MAP = {
    'hi': 'Hindi',   'te': 'Telugu',  'ta': 'Tamil',    'en': 'English',
    'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
    'kn': 'Kannada', 'ml': 'Malayalam', 'pa': 'Punjabi',
}

# ── AWS clients ────────────────────────────────────────────────────────────────

def _bedrock():
    return boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)

def _comprehend():
    return boto3.client('comprehendmedical', region_name=BEDROCK_REGION)

def _dynamo():
    return boto3.resource('dynamodb', region_name=APP_REGION).Table(TABLE_NAME)


# ═══════════════════════════════════════════════════════════════════════════════
# Tool 1 — Diagnosis Agent
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_symptoms(symptoms: str, lang: str, user_conditions: list,
                      image_b64: str = None) -> dict:
    """
    Comprehend Medical NER + optional Nova Lite image analysis + Nova Pro
    structured clinical reasoning.
    """
    # Step A: Comprehend Medical NER
    entities = {'symptoms': [], 'conditions': [], 'medications': [], 'body_parts': []}
    try:
        resp = _comprehend().detect_entities_v2(Text=symptoms[:20000])
        for e in resp.get('Entities', []):
            if e.get('Score', 0) < 0.6:
                continue
            cat, val = e.get('Category', ''), e.get('Text', '')
            if   cat == 'SIGN_OR_SYMPTOM':   entities['symptoms'].append(val)
            elif cat == 'MEDICAL_CONDITION': entities['conditions'].append(val)
            elif cat == 'MEDICATION':        entities['medications'].append(val)
            elif cat == 'ANATOMY':           entities['body_parts'].append(val)
        for k in entities:
            entities[k] = list(dict.fromkeys(entities[k]))
    except Exception as e:
        print(f'[comprehend] error (non-fatal): {e}')

    # Step B: Image analysis (optional)
    image_context = ''
    if image_b64:
        try:
            img, fmt = image_b64, 'jpeg'
            if img.startswith('data:'):
                header, img = img.split(',', 1)
                if 'png' in header:  fmt = 'png'
                elif 'webp' in header: fmt = 'webp'
            resp = _bedrock().converse(
                modelId=VISION_MODEL,
                messages=[{'role': 'user', 'content': [
                    {'image': {'format': fmt, 'source': {'bytes': base64.b64decode(img)}}},
                    {'text': 'Analyze this medical image in 2-3 concise clinical sentences. Note any visible abnormalities, skin conditions, or relevant findings.'},
                ]}],
                inferenceConfig={'maxTokens': 350, 'temperature': 0.2},
            )
            image_context = resp['output']['message']['content'][0]['text']
        except Exception as e:
            print(f'[vision] error (non-fatal): {e}')

    # Step C: Nova Pro structured reasoning
    lang_name  = LANG_MAP.get(lang, 'English')
    entity_ctx = ''
    if entities['symptoms']:     entity_ctx += f"\nNLP symptoms: {', '.join(entities['symptoms'])}"
    if entities['body_parts']:   entity_ctx += f"\nAffected areas: {', '.join(entities['body_parts'])}"
    if entities['medications']:  entity_ctx += f"\nMedications: {', '.join(entities['medications'])}"
    if user_conditions:          entity_ctx += f"\nKnown conditions: {', '.join(user_conditions)}"
    if image_context:            entity_ctx += f"\nImage findings: {image_context}"

    prompt = (
        f'You are a senior clinical decision support system. Reply in {lang_name}.\n'
        f'Patient reports: "{symptoms}"{entity_ctx}\n\n'
        'Return ONLY valid JSON:\n'
        '{"condition":"Most likely condition","severity":"mild|moderate|severe",'
        '"specialty_needed":"Required specialty","urgency":"emergency|urgent|routine",'
        '"urgency_reason":"Brief reason","red_flags":["ER warning signs"],'
        '"action_steps":["Step 1","Step 2","Step 3"],'
        '"questions_for_doctor":["Q1","Q2","Q3"]}'
    )

    raw = ''
    try:
        resp = _bedrock().converse(
            modelId=SYNTHESIS_MODEL,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 700, 'temperature': 0.1},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()
        if '```json' in raw: raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:   raw = raw.split('```')[1].split('```')[0].strip()
        result = json.loads(raw)
        result['entities']      = entities
        result['image_context'] = image_context
        return result
    except Exception as e:
        print(f'[diagnose_symptoms] error: {e} | raw: {raw[:200]}')
        return {
            'condition': 'Requires doctor evaluation', 'severity': 'moderate',
            'specialty_needed': 'General Physician', 'urgency': 'routine',
            'urgency_reason': 'Unable to fully analyse — please consult a doctor.',
            'red_flags': [], 'action_steps': ['Consult a General Physician.'],
            'questions_for_doctor': ['What is my diagnosis?', 'What tests do I need?'],
            'entities': entities, 'image_context': image_context,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Tool 2 — Hospital Finder
# ═══════════════════════════════════════════════════════════════════════════════

def find_hospitals(specialty: str, lat: float, lng: float,
                   urgency: str = 'routine') -> dict:
    radius_m = 5000 if urgency == 'emergency' else 10000
    hospitals = []

    if GOOGLE_KEY:
        hospitals = _google_search(lat, lng, radius_m, specialty)
    if not hospitals:
        hospitals = _overpass_search(lat, lng, radius_m)
    if urgency == 'emergency':
        emerg  = [h for h in hospitals if h.get('emergency')]
        others = [h for h in hospitals if not h.get('emergency')]
        hospitals = emerg + others

    return {'hospitals': hospitals[:10], 'specialty': specialty,
            'count': len(hospitals), 'radius_km': radius_m / 1000}


def _google_search(lat, lng, radius_m, specialty):
    keyword = urllib.parse.quote(f'{specialty} doctor clinic hospital')
    url = (
        f'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
        f'?location={lat},{lng}&radius={radius_m}&keyword={keyword}'
        f'&type=doctor|hospital&rankby=prominence&key={GOOGLE_KEY}'
    )
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        print(f'[google_places] error: {e}')
        return []
    results = []
    for place in data.get('results', [])[:8]:
        plat = place['geometry']['location']['lat']
        plng = place['geometry']['location']['lng']
        pid  = place.get('place_id', '')
        phone = ''
        if pid:
            try:
                det = (
                    f'https://maps.googleapis.com/maps/api/place/details/json'
                    f'?place_id={pid}&fields=formatted_phone_number&key={GOOGLE_KEY}'
                )
                with urllib.request.urlopen(det, timeout=6) as r:
                    phone = json.loads(r.read().decode()).get('result', {}).get('formatted_phone_number', '')
            except Exception:
                pass
        results.append({
            'id': pid, 'name': place.get('name', 'Clinic'),
            'address': place.get('vicinity', ''),
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat': plat, 'lng': plng, 'type': 'hospital', 'emergency': False,
            'phone': phone, 'rating': place.get('rating', 0),
            'total_ratings': place.get('user_ratings_total', 0), 'specialty': specialty,
        })
    return results


def _overpass_search(lat, lng, radius_m):
    query = (
        f'[out:json][timeout:18];'
        f'(node["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat},{lng});'
        f'way["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat},{lng});'
        f'node["healthcare"~"^(hospital|clinic|centre|doctor)$"](around:{radius_m},{lat},{lng});'
        f');out center;'
    )
    try:
        enc = urllib.parse.urlencode({'data': query}).encode()
        req = urllib.request.Request(
            'https://overpass-api.de/api/interpreter', data=enc,
            headers={'User-Agent': 'BhashaAI/1.0'}, method='POST',
        )
        with urllib.request.urlopen(req, timeout=16) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        print(f'[overpass] error: {e}')
        return []
    results, seen = [], set()
    for el in data.get('elements', []):
        tags = el.get('tags', {})
        name = (tags.get('name') or tags.get('amenity', 'Medical Facility')).strip()
        if el['type'] == 'node':
            plat, plng = el.get('lat', lat), el.get('lon', lng)
        else:
            c = el.get('center', {})
            plat, plng = c.get('lat', lat), c.get('lon', lng)
        key = f'{name}_{round(plat,4)}_{round(plng,4)}'
        if key in seen:
            continue
        seen.add(key)
        tlow = (name + ' ' + tags.get('amenity', '')).lower()
        results.append({
            'id': str(el.get('id', key)), 'name': name,
            'address': tags.get('addr:street', '') or tags.get('addr:suburb', '') or '',
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat': plat, 'lng': plng,
            'type': 'clinic' if ('clinic' in tlow or 'doctors' in tlow) else 'hospital',
            'emergency': 'hospital' in tlow and 'clinic' not in tlow,
            'phone': tags.get('phone') or tags.get('contact:phone') or '',
            'rating': 0, 'total_ratings': 0,
        })
    results.sort(key=lambda h: h['distance_km'])
    return results


def _haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ═══════════════════════════════════════════════════════════════════════════════
# Tool 3 — Hospital Ranker + Visit Prep
# ═══════════════════════════════════════════════════════════════════════════════

def rank_hospitals(hospitals: list, diagnosis: dict, lang: str = 'en') -> dict:
    if not hospitals:
        return {
            'recommended_hospital': None, 'ranked_list': [],
            'ranking_reason': 'No hospitals found nearby.',
            'visit_prep': {
                'urgency_note': diagnosis.get('urgency_reason', ''),
                'questions_to_ask': diagnosis.get('questions_for_doctor', []),
                'what_to_bring': ['Government ID', 'Previous reports', 'Insurance card'],
                'transport_tip': '',
            },
        }

    hosp_text = '\n'.join(
        f'{i+1}. {h["name"]} | {h["distance_km"]}km'
        f'{" | ⭐" + str(h["rating"]) if h.get("rating") else ""}'
        f'{" | 24/7 Emergency" if h.get("emergency") else ""}'
        f'{" | Phone: " + h["phone"] if h.get("phone") else ""}'
        for i, h in enumerate(hospitals[:8])
    )

    lang_name = LANG_MAP.get(lang, 'English')
    prompt = (
        f'You are a hospital recommendation engine. Reply in {lang_name}.\n\n'
        f'Diagnosis: {diagnosis.get("condition","Unknown")} | '
        f'Severity: {diagnosis.get("severity","moderate")} | '
        f'Urgency: {diagnosis.get("urgency","routine")} | '
        f'Specialty: {diagnosis.get("specialty_needed","General Physician")}\n\n'
        f'Available hospitals:\n{hosp_text}\n\n'
        'Return ONLY valid JSON:\n'
        '{"recommended_index":0,"ranking_reason":"Why this hospital is best",'
        '"urgency_note":"Timing advice","questions_to_ask":["Q1","Q2","Q3","Q4","Q5"],'
        '"what_to_bring":["Item1","Item2","Item3"],'
        '"transport_tip":"Best transport option","ranked_order":[0,1,2]}'
    )

    raw = ''
    try:
        resp = _bedrock().converse(
            modelId=SYNTHESIS_MODEL,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 700, 'temperature': 0.1},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()
        if '```json' in raw: raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:   raw = raw.split('```')[1].split('```')[0].strip()
        r = json.loads(raw)
        rec_idx = max(0, min(r.get('recommended_index', 0), len(hospitals) - 1))
        ranked_indices = r.get('ranked_order', list(range(len(hospitals))))
        ranked_list = [hospitals[i] for i in ranked_indices if i < len(hospitals)]
        return {
            'recommended_hospital': hospitals[rec_idx],
            'ranked_list': ranked_list,
            'ranking_reason': r.get('ranking_reason', ''),
            'visit_prep': {
                'urgency_note':     r.get('urgency_note', ''),
                'questions_to_ask': r.get('questions_to_ask', diagnosis.get('questions_for_doctor', [])),
                'what_to_bring':    r.get('what_to_bring', ['Government ID', 'Previous reports']),
                'transport_tip':    r.get('transport_tip', ''),
            },
        }
    except Exception as e:
        print(f'[rank_hospitals] error: {e} | raw: {raw[:200]}')
        return {
            'recommended_hospital': hospitals[0], 'ranked_list': hospitals[:5],
            'ranking_reason': 'Closest available hospital for your condition.',
            'visit_prep': {
                'urgency_note':     diagnosis.get('urgency_reason', ''),
                'questions_to_ask': diagnosis.get('questions_for_doctor', []),
                'what_to_bring':    ['Government ID (Aadhaar)', 'Previous prescriptions', 'Insurance card'],
                'transport_tip':    '',
            },
        }


# ═══════════════════════════════════════════════════════════════════════════════
# DynamoDB State Store — saves tool results for invoker Lambda to read
# ═══════════════════════════════════════════════════════════════════════════════

def save_tool_result(session_id: str, tool_name: str, result: dict):
    """
    Save tool result to DynamoDB so the invoker Lambda can retrieve structured
    data after invoke_agent completes.
    TTL: 1 hour from now.
    """
    try:
        ttl = int(time.time()) + 3600
        _dynamo().put_item(Item={
            'userId':   f'temp#agent#{session_id}',
            'recordId': tool_name,
            'result':   json.dumps(result, default=str),
            'ttl':      ttl,
        })
    except Exception as e:
        print(f'[save_tool_result] error (non-fatal): {e}')


# ═══════════════════════════════════════════════════════════════════════════════
# Lambda Handler — Bedrock Agent calls this
# ═══════════════════════════════════════════════════════════════════════════════

def lambda_handler(event, context):
    print(f'[bedrock_agent_action] event keys: {list(event.keys())}')

    action_group = event.get('actionGroup', 'HealthActions')
    function     = event.get('function', '')
    parameters   = event.get('parameters', [])
    session_id   = event.get('sessionId', 'default')

    # Extract session context
    session_attrs  = event.get('sessionAttributes', {})
    prompt_attrs   = event.get('promptSessionAttributes', {})

    lat  = float(session_attrs.get('lat', 28.6139))
    lng  = float(session_attrs.get('lng', 77.2090))
    lang = session_attrs.get('lang', prompt_attrs.get('lang', 'en'))

    user_conditions_str = prompt_attrs.get('userConditions', '')
    user_conditions = [c.strip() for c in user_conditions_str.split(',') if c.strip()]

    # Convert parameters list → dict
    params = {p['name']: p['value'] for p in parameters}

    # ── Dispatch to the correct tool ───────────────────────────────────────────

    if function == 'diagnose_symptoms':
        symptoms  = params.get('symptoms', '')
        image_b64 = session_attrs.get('image_b64', '')
        result    = diagnose_symptoms(symptoms, lang, user_conditions, image_b64 or None)
        save_tool_result(session_id, 'diagnosis', result)

        # Return a concise summary for the agent to continue reasoning
        response_text = json.dumps({
            'condition':        result.get('condition'),
            'severity':         result.get('severity'),
            'specialty_needed': result.get('specialty_needed'),
            'urgency':          result.get('urgency'),
            'urgency_reason':   result.get('urgency_reason'),
            'red_flags':        result.get('red_flags', []),
        }, default=str)

    elif function == 'find_hospitals':
        specialty = params.get('specialty', 'General Physician')
        urgency   = params.get('urgency', 'routine')
        result    = find_hospitals(specialty, lat, lng, urgency)
        save_tool_result(session_id, 'hospitals', result)

        top3 = [
            {'name': h['name'], 'distance_km': h['distance_km'],
             'rating': h.get('rating', 0), 'emergency': h.get('emergency', False),
             'phone': h.get('phone', '')}
            for h in result.get('hospitals', [])[:3]
        ]
        response_text = json.dumps({'hospitals_found': result['count'], 'top_3': top3}, default=str)

    elif function == 'rank_hospitals':
        # Read diagnosis from DynamoDB state store (set by diagnose_symptoms call)
        diagnosis = {}
        try:
            resp = _dynamo().get_item(Key={
                'userId':   f'temp#agent#{session_id}',
                'recordId': 'diagnosis',
            })
            if 'Item' in resp:
                diagnosis = json.loads(resp['Item']['result'])
        except Exception as e:
            print(f'[rank_hospitals] could not load diagnosis: {e}')

        # Read hospitals from DynamoDB state store
        hospitals_data = {}
        try:
            resp = _dynamo().get_item(Key={
                'userId':   f'temp#agent#{session_id}',
                'recordId': 'hospitals',
            })
            if 'Item' in resp:
                hospitals_data = json.loads(resp['Item']['result'])
        except Exception as e:
            print(f'[rank_hospitals] could not load hospitals: {e}')

        hospitals = hospitals_data.get('hospitals', [])
        result = rank_hospitals(hospitals, diagnosis, lang)
        save_tool_result(session_id, 'ranked', result)

        rec = result.get('recommended_hospital') or {}
        response_text = json.dumps({
            'recommended_hospital': rec.get('name'),
            'ranking_reason':       result.get('ranking_reason', ''),
            'urgency_note':         result.get('visit_prep', {}).get('urgency_note', ''),
        }, default=str)

    else:
        response_text = json.dumps({'error': f'Unknown function: {function}'})

    # ── Bedrock Agent response format ──────────────────────────────────────────
    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': action_group,
            'function':    function,
            'functionResponse': {
                'responseBody': {
                    'TEXT': {'body': response_text}
                }
            }
        }
    }
