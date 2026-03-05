"""
multi_agent/lambda_function.py

Multi-agent health consultation pipeline using Claude tool_use orchestration.

Agents:
  1. DiagnosisAgent  — Comprehend Medical + Nova Pro structured analysis + optional image
  2. HospitalAgent   — Google Places / OpenStreetMap specialty search by location
  3. RankerAgent     — Nova Pro ranks hospitals + full visit prep guide

Memory Layer (DynamoDB):
  - Saves every consultation (condition, specialty, recommended hospital, timestamp)
  - On new query: checks last 5 consultations for same specialty → suggests return visit

Routes:
  POST /multi-agent         — run full pipeline
  GET  /multi-agent/history — past consultations (?userId=)

POST body:
{
  userId:         str,
  symptoms:       str,          # free text in any language
  image:          str | null,   # optional base64 encoded image
  lat:            float,
  lng:            float,
  language:       str,          # en/hi/te/ta/mr/bn/gu/kn/ml/pa
  userConditions: str[],        # from user profile
}

Env vars:
  DYNAMODB_MAIN_TABLE  — defaults to BhashaAIMain
  APP_REGION           — defaults to ap-south-1
  BEDROCK_REGION       — defaults to us-east-1
  GOOGLE_MAPS_API_KEY  — optional, improves hospital search
"""

import json
import boto3
import os
import base64
import math
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

# ── Config ─────────────────────────────────────────────────────────────────────

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

APP_REGION      = os.environ.get('APP_REGION',           'ap-south-1')
BEDROCK_REGION  = os.environ.get('BEDROCK_REGION',        'us-east-1')
TABLE_NAME      = os.environ.get('DYNAMODB_MAIN_TABLE',   'BhashaAIMain')
GOOGLE_KEY      = os.environ.get('GOOGLE_MAPS_API_KEY',   '')

# Claude Sonnet 3.5 for tool_use orchestration (most capable for agentic tasks)
ORCHESTRATOR_MODEL = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
# Nova Pro for diagnosis synthesis + ranking (fast, cheap, good at JSON)
SYNTHESIS_MODEL    = 'us.amazon.nova-pro-v1:0'
# Nova Lite for image analysis (vision capable, economical)
VISION_MODEL       = 'us.amazon.nova-lite-v1:0'

MAX_AGENT_TURNS = 12  # Safety cap on agentic loop iterations

LANG_MAP = {
    'hi': 'Hindi',   'te': 'Telugu',  'ta': 'Tamil',    'en': 'English',
    'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
    'kn': 'Kannada', 'ml': 'Malayalam','pa': 'Punjabi',
}


# ── AWS clients ────────────────────────────────────────────────────────────────

def _bedrock():
    return boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)

def _comprehend():
    return boto3.client('comprehendmedical', region_name=BEDROCK_REGION)

def _dynamo():
    return boto3.resource('dynamodb', region_name=APP_REGION).Table(TABLE_NAME)


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 1 — Diagnosis
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_agent(symptoms: str, user_conditions: list,
                   image_b64: str = None, lang: str = 'en') -> dict:
    """
    Runs Comprehend Medical NER + optional image analysis + Nova Pro structured
    clinical reasoning.
    Returns: condition, severity, specialty_needed, urgency, red_flags,
             action_steps, questions_for_doctor, entities, image_context
    """
    # Step A: Comprehend Medical NER
    entities = {'symptoms': [], 'conditions': [], 'medications': [], 'body_parts': []}
    try:
        resp = _comprehend().detect_entities_v2(Text=symptoms[:20000])
        for e in resp.get('Entities', []):
            if e.get('Score', 0) < 0.6:
                continue
            cat, val = e.get('Category', ''), e.get('Text', '')
            if   cat == 'SIGN_OR_SYMPTOM':    entities['symptoms'].append(val)
            elif cat == 'MEDICAL_CONDITION':  entities['conditions'].append(val)
            elif cat == 'MEDICATION':         entities['medications'].append(val)
            elif cat == 'ANATOMY':            entities['body_parts'].append(val)
        # Deduplicate
        for k in entities:
            entities[k] = list(dict.fromkeys(entities[k]))
    except Exception as e:
        print(f'[comprehend] error (non-fatal): {e}')

    # Step B: Image analysis if provided
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

    # Step C: Nova Pro structured clinical reasoning
    lang_name  = LANG_MAP.get(lang, 'English')
    entity_ctx = ''
    if entities['symptoms']:    entity_ctx += f"\nNLP-detected symptoms: {', '.join(entities['symptoms'])}"
    if entities['body_parts']: entity_ctx += f"\nAffected areas: {', '.join(entities['body_parts'])}"
    if entities['medications']:entity_ctx += f"\nCurrent medications: {', '.join(entities['medications'])}"
    if user_conditions:        entity_ctx += f"\nKnown conditions: {', '.join(user_conditions)}"
    if image_context:          entity_ctx += f"\nImage findings: {image_context}"

    prompt = (
        f'You are a senior clinical decision support system. Reply in {lang_name}.\n'
        f'Patient reports: "{symptoms}"{entity_ctx}\n\n'
        'Return ONLY valid JSON — no markdown, no explanation:\n'
        '{\n'
        '  "condition": "Most likely condition name",\n'
        '  "severity": "mild|moderate|severe",\n'
        '  "specialty_needed": "Required doctor specialty",\n'
        '  "urgency": "emergency|urgent|routine",\n'
        '  "urgency_reason": "Brief clinical reason for urgency rating",\n'
        '  "red_flags": ["Symptom that means go to ER immediately"],\n'
        '  "action_steps": ["Step 1", "Step 2", "Step 3"],\n'
        '  "questions_for_doctor": ["Specific Q1", "Specific Q2", "Specific Q3"]\n'
        '}'
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
        print(f'[diagnose_agent] error: {e} | raw: {raw[:200]}')
        return {
            'condition':            'Requires doctor evaluation',
            'severity':             'moderate',
            'specialty_needed':     'General Physician',
            'urgency':              'routine',
            'urgency_reason':       'Unable to fully analyse — please consult a doctor.',
            'red_flags':            [],
            'action_steps':         ['Consult a General Physician for proper evaluation.'],
            'questions_for_doctor': ['What is my diagnosis?', 'What tests do I need?'],
            'entities':             entities,
            'image_context':        image_context,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 2 — Hospital Finder
# ═══════════════════════════════════════════════════════════════════════════════

CONDITION_TO_SPECIALTY = {
    'bone': 'Orthopedic',        'fracture': 'Orthopedic',    'joint': 'Orthopedic',
    'knee': 'Orthopedic',        'shoulder': 'Orthopedic',    'back pain': 'Orthopedic',
    'spine': 'Orthopedic',       'ankle': 'Orthopedic',       'wrist': 'Orthopedic',
    'heart': 'Cardiologist',     'chest pain': 'Cardiologist','cardiac': 'Cardiologist',
    'blood pressure': 'Cardiologist', 'hypertension': 'Cardiologist',
    'palpitation': 'Cardiologist',
    'brain': 'Neurologist',      'seizure': 'Neurologist',    'migraine': 'Neurologist',
    'stroke': 'Neurologist',     'numbness': 'Neurologist',   'nerve': 'Neurologist',
    'eye': 'Ophthalmologist',    'vision': 'Ophthalmologist', 'cataract': 'Ophthalmologist',
    'skin': 'Dermatologist',     'rash': 'Dermatologist',     'eczema': 'Dermatologist',
    'lung': 'Pulmonologist',     'breathing': 'Pulmonologist','asthma': 'Pulmonologist',
    'cough': 'Pulmonologist',    'tuberculosis': 'Pulmonologist',
    'stomach': 'Gastroenterologist', 'liver': 'Gastroenterologist',
    'digestion': 'Gastroenterologist', 'acidity': 'Gastroenterologist',
    'kidney': 'Nephrologist',    'urine': 'Nephrologist',     'dialysis': 'Nephrologist',
    'mental': 'Psychiatrist',    'depression': 'Psychiatrist','anxiety': 'Psychiatrist',
    'insomnia': 'Psychiatrist',  'stress': 'Psychiatrist',
    'child': 'Pediatrician',     'baby': 'Pediatrician',      'infant': 'Pediatrician',
    'ear': 'ENT Specialist',     'throat': 'ENT Specialist',  'nose': 'ENT Specialist',
    'tonsil': 'ENT Specialist',
    'diabetes': 'Endocrinologist','thyroid': 'Endocrinologist','sugar': 'Endocrinologist',
    'hormone': 'Endocrinologist',
    'cancer': 'Oncologist',      'tumor': 'Oncologist',
    'teeth': 'Dentist',          'dental': 'Dentist',         'gum': 'Dentist',
    'pregnancy': 'Gynecologist', 'period': 'Gynecologist',    'ovary': 'Gynecologist',
    'allergy': 'Allergist',      'immune': 'Immunologist',
    'blood': 'Hematologist',     'anemia': 'Hematologist',
}


def hospital_agent(specialty: str, lat: float, lng: float, urgency: str = 'routine') -> dict:
    """
    Searches for hospitals/clinics matching the given specialty near the user.
    Emergency cases use a tighter radius (5km) to find the fastest option.
    Returns: { hospitals: [...], specialty, count, radius_km }
    """
    radius_m = 5000 if urgency == 'emergency' else 10000
    hospitals = []

    # Try Google Places if key available — better quality, includes ratings + phone
    if GOOGLE_KEY:
        hospitals = _google_search(lat, lng, radius_m, specialty)

    # Fallback: OpenStreetMap Overpass
    if not hospitals:
        hospitals = _overpass_search(lat, lng, radius_m)

    # For emergency: prioritise 24/7 hospitals
    if urgency == 'emergency':
        emerg  = [h for h in hospitals if h.get('emergency')]
        others = [h for h in hospitals if not h.get('emergency')]
        hospitals = emerg + others

    return {
        'hospitals':  hospitals[:10],
        'specialty':  specialty,
        'count':      len(hospitals),
        'radius_km':  radius_m / 1000,
    }


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
            'id':            pid,
            'name':          place.get('name', 'Clinic'),
            'address':       place.get('vicinity', ''),
            'distance_km':   round(_haversine(lat, lng, plat, plng), 2),
            'lat':           plat,
            'lng':           plng,
            'type':          'hospital',
            'emergency':     False,
            'phone':         phone,
            'rating':        place.get('rating', 0),
            'total_ratings': place.get('user_ratings_total', 0),
            'specialty':     specialty,
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
            'id':          str(el.get('id', key)),
            'name':        name,
            'address':     tags.get('addr:street', '') or tags.get('addr:suburb', '') or '',
            'distance_km': round(_haversine(lat, lng, plat, plng), 2),
            'lat':         plat,
            'lng':         plng,
            'type':        'clinic' if ('clinic' in tlow or 'doctors' in tlow) else 'hospital',
            'emergency':   'hospital' in tlow and 'clinic' not in tlow,
            'phone':       tags.get('phone') or tags.get('contact:phone') or '',
            'rating':      0,
            'total_ratings': 0,
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
# AGENT 3 — Hospital Ranker + Visit Prep
# ═══════════════════════════════════════════════════════════════════════════════

def ranker_agent(hospitals: list, diagnosis: dict,
                 past_visit: dict, lang: str = 'en') -> dict:
    """
    Uses Nova Pro to intelligently rank hospitals for the patient's specific
    condition and generate a tailored visit preparation guide.
    Returns: { recommended_hospital, ranked_list, ranking_reason, visit_prep }
    """
    if not hospitals:
        return {
            'recommended_hospital': None,
            'ranked_list': [],
            'ranking_reason': 'No hospitals found nearby.',
            'visit_prep': {
                'urgency_note':     diagnosis.get('urgency_reason', ''),
                'questions_to_ask': diagnosis.get('questions_for_doctor', []),
                'what_to_bring':    ['Government ID', 'Previous reports', 'Insurance card'],
                'transport_tip':    '',
            },
        }

    hosp_text = '\n'.join(
        f'{i+1}. {h["name"]} | {h["distance_km"]}km'
        f'{" | ⭐" + str(h["rating"]) if h.get("rating") else ""}'
        f'{" | Rated by " + str(h.get("total_ratings",0)) + " people" if h.get("total_ratings") else ""}'
        f'{" | 🚨 24/7 Emergency" if h.get("emergency") else ""}'
        f'{" | Phone: " + h["phone"] if h.get("phone") else ""}'
        for i, h in enumerate(hospitals[:8])
    )

    past_ctx = ''
    if past_visit and past_visit.get('found'):
        past_ctx = (
            f'\n[Memory] Patient previously visited {past_visit["hospital_name"]} '
            f'{past_visit.get("days_ago", "?")} days ago for {past_visit.get("condition", "similar symptoms")}. '
            f'Consider this when ranking — returning to same facility is often better for continuity of care.'
        )

    lang_name = LANG_MAP.get(lang, 'English')
    prompt = (
        f'You are a hospital recommendation engine. Reply in {lang_name}.\n\n'
        f'Patient diagnosis: {diagnosis.get("condition", "Unknown")}\n'
        f'Severity: {diagnosis.get("severity", "moderate")}\n'
        f'Urgency: {diagnosis.get("urgency", "routine")}\n'
        f'Specialty needed: {diagnosis.get("specialty_needed", "General Physician")}\n'
        f'{past_ctx}\n\n'
        f'Available hospitals (sorted by distance):\n{hosp_text}\n\n'
        'Return ONLY valid JSON:\n'
        '{\n'
        '  "recommended_index": 0,\n'
        '  "ranking_reason": "Why this hospital is best for this specific patient and condition",\n'
        '  "urgency_note": "Specific timing advice based on urgency level",\n'
        '  "questions_to_ask": ["5 very specific questions for this specialty/condition"],\n'
        '  "what_to_bring": ["Specific items for this condition — reports, cards, etc."],\n'
        '  "transport_tip": "Best way to get there given urgency and distance",\n'
        '  "ranked_order": [0, 1, 2]\n'
        '}'
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
            'ranked_list':          ranked_list,
            'ranking_reason':       r.get('ranking_reason', ''),
            'visit_prep': {
                'urgency_note':     r.get('urgency_note', ''),
                'questions_to_ask': r.get('questions_to_ask', diagnosis.get('questions_for_doctor', [])),
                'what_to_bring':    r.get('what_to_bring', ['Government ID', 'Previous reports']),
                'transport_tip':    r.get('transport_tip', ''),
            },
        }
    except Exception as e:
        print(f'[ranker_agent] error: {e} | raw: {raw[:200]}')
        return {
            'recommended_hospital': hospitals[0],
            'ranked_list':          hospitals[:5],
            'ranking_reason':       'Closest available hospital for your condition.',
            'visit_prep': {
                'urgency_note':     diagnosis.get('urgency_reason', ''),
                'questions_to_ask': diagnosis.get('questions_for_doctor', []),
                'what_to_bring':    ['Government ID (Aadhaar)', 'Previous prescriptions', 'Insurance card'],
                'transport_tip':    '',
            },
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Memory Layer — DynamoDB
# ═══════════════════════════════════════════════════════════════════════════════

def get_past_consultations(user_id: str, limit: int = 5) -> list:
    try:
        resp = _dynamo().query(
            KeyConditionExpression=Key('userId').eq(user_id) & Key('recordId').begins_with('consult#'),
            ScanIndexForward=False,   # newest first
            Limit=limit,
        )
        return resp.get('Items', [])
    except Exception as e:
        print(f'[get_past_consultations] error: {e}')
        return []


def find_return_visit(past: list, specialty: str) -> dict:
    """
    Check if user saw the same specialty recently (within 90 days).
    Returns suggestion dict if found, else {'found': False}.
    """
    if not past or not specialty:
        return {'found': False}
    for p in past:
        if p.get('specialtyNeeded', '').lower() != specialty.lower():
            continue
        ts = p.get('timestamp', '')
        days_ago = 999
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                days_ago = (datetime.now(timezone.utc) - dt).days
            except Exception:
                pass
        if days_ago <= 90:
            hosp = p.get('recommendedHospital', 'the same clinic')
            return {
                'found':          True,
                'hospital_name':  hosp,
                'hospital_phone': p.get('hospitalPhone', ''),
                'hospital_lat':   p.get('hospitalLat', ''),
                'hospital_lng':   p.get('hospitalLng', ''),
                'condition':      p.get('diagnosedCondition', 'similar symptoms'),
                'specialty':      p.get('specialtyNeeded', specialty),
                'days_ago':       days_ago,
                'suggestion': (
                    f'You visited {hosp} {days_ago} days ago for '
                    f'{p.get("diagnosedCondition", "similar symptoms")}. '
                    f'Would you like to go back to the same {specialty}? '
                    f'Continuity of care helps your doctor track your progress.'
                ),
            }
    return {'found': False}


def save_consultation(user_id: str, symptoms: str, diagnosis: dict,
                      recommended_hospital: dict, lang: str):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        item = {
            'userId':              user_id,
            'recordId':            f'consult#{ts}',
            'timestamp':           ts,
            'symptoms':            symptoms[:500],
            'diagnosedCondition':  diagnosis.get('condition', ''),
            'specialtyNeeded':     diagnosis.get('specialty_needed', ''),
            'urgency':             diagnosis.get('urgency', 'routine'),
            'language':            lang,
            'consultType':         'multi_agent',
        }
        if recommended_hospital:
            item['recommendedHospital'] = recommended_hospital.get('name', '')
            item['hospitalPhone']       = recommended_hospital.get('phone', '')
            item['hospitalLat']         = str(recommended_hospital.get('lat', ''))
            item['hospitalLng']         = str(recommended_hospital.get('lng', ''))
        _dynamo().put_item(Item=item)
    except Exception as e:
        print(f'[save_consultation] error (non-fatal): {e}')


# ═══════════════════════════════════════════════════════════════════════════════
# Orchestrator — Claude tool_use agentic loop
# ═══════════════════════════════════════════════════════════════════════════════

TOOLS = [
    {
        'toolSpec': {
            'name': 'diagnose_symptoms',
            'description': (
                'Analyze patient symptoms using medical AI (Comprehend Medical NER + '
                'Nova Pro clinical reasoning + optional image analysis). '
                'Returns: condition, severity, specialty_needed, urgency, red_flags, '
                'action_steps, questions_for_doctor. '
                'ALWAYS call this FIRST before finding hospitals.'
            ),
            'inputSchema': {'json': {
                'type': 'object',
                'properties': {
                    'symptoms':        {'type': 'string',  'description': 'Patient symptom description'},
                    'user_conditions': {'type': 'array',   'items': {'type': 'string'},
                                        'description': 'Known medical conditions from profile'},
                },
                'required': ['symptoms'],
            }},
        },
    },
    {
        'toolSpec': {
            'name': 'find_hospitals',
            'description': (
                'Find nearby hospitals/clinics for a given medical specialty and urgency level. '
                'Uses Google Places (if available) or OpenStreetMap. '
                'Call this SECOND after diagnose_symptoms. '
                'Use the specialty_needed from the diagnosis result.'
            ),
            'inputSchema': {'json': {
                'type': 'object',
                'properties': {
                    'specialty': {'type': 'string', 'description': 'Medical specialty (e.g. Cardiologist, General Physician)'},
                    'urgency':   {'type': 'string', 'description': 'emergency|urgent|routine — affects search radius'},
                },
                'required': ['specialty'],
            }},
        },
    },
    {
        'toolSpec': {
            'name': 'rank_hospitals',
            'description': (
                'Rank the found hospitals for this specific patient condition and '
                'generate a tailored visit preparation guide (questions to ask, what to bring, '
                'transport advice, timing). '
                'Call this LAST after find_hospitals. '
                'Returns the best hospital recommendation and full prep guide.'
            ),
            'inputSchema': {'json': {
                'type': 'object',
                'properties': {
                    'hospitals': {'type': 'array',  'description': 'Hospital list from find_hospitals tool'},
                    'condition': {'type': 'string', 'description': 'Diagnosed condition'},
                    'severity':  {'type': 'string', 'description': 'mild|moderate|severe'},
                    'urgency':   {'type': 'string', 'description': 'emergency|urgent|routine'},
                    'specialty': {'type': 'string', 'description': 'Medical specialty needed'},
                },
                'required': ['hospitals', 'condition'],
            }},
        },
    },
]


def run_orchestrator(symptoms: str, image_b64, lat: float, lng: float,
                     lang: str, user_conditions: list,
                     past_consultations: list) -> dict:
    """
    Claude Sonnet tool_use agentic loop.
    Claude decides which agents to call and in what order, interprets
    results, and synthesizes a warm, empathetic final response.
    """
    lang_name = LANG_MAP.get(lang, 'English')

    # Shared state populated as tools execute
    state = {
        'diagnosis': None,
        'hospitals': [],
        'ranked':    None,
        'past_visit': {'found': False},
        'orchestrator_summary': '',
    }

    # Build memory context for Claude
    memory_ctx = ''
    if past_consultations:
        recent = past_consultations[0]
        try:
            dt = datetime.fromisoformat(recent['timestamp'].replace('Z', '+00:00'))
            days = (datetime.now(timezone.utc) - dt).days
            memory_ctx = (
                f'\n[Patient Memory] Last consultation: {recent.get("diagnosedCondition", "unknown")} '
                f'at {recent.get("recommendedHospital", "unknown clinic")} ({days} days ago).'
            )
        except Exception:
            pass

    system = (
        f'You are a compassionate medical AI orchestrator. Reply in {lang_name}.\n\n'
        'Your job: help the patient find the right doctor for their symptoms.\n\n'
        'Follow this sequence STRICTLY:\n'
        '1. Call diagnose_symptoms → analyze what the patient has\n'
        '2. Call find_hospitals → search for the right specialist nearby\n'
        '3. Call rank_hospitals → pick the best option and prepare the patient\n\n'
        'After all 3 tools complete, write a warm, clear 2-3 sentence summary '
        'telling the patient what you found and what they should do next.\n'
        'Be empathetic. Avoid medical jargon. Mention urgency clearly if needed.'
    )

    messages = [{
        'role':    'user',
        'content': [{'text': f'Patient symptoms: {symptoms}{memory_ctx}'}],
    }]

    turns = 0
    while turns < MAX_AGENT_TURNS:
        turns += 1
        resp = _bedrock().converse(
            modelId=ORCHESTRATOR_MODEL,
            system=[{'text': system}],
            tools=TOOLS,
            messages=messages,
            inferenceConfig={'maxTokens': 1200, 'temperature': 0.2},
        )

        stop_reason = resp['stopReason']
        out_msg     = resp['output']['message']
        messages.append({'role': 'assistant', 'content': out_msg['content']})

        if stop_reason == 'end_turn':
            state['orchestrator_summary'] = ' '.join(
                b.get('text', '') for b in out_msg['content']
                if b.get('type') == 'text'
            ).strip()
            break

        if stop_reason == 'tool_use':
            tool_results = []
            for block in out_msg['content']:
                if block.get('type') != 'toolUse':
                    continue
                name, inp, use_id = block['name'], block['input'], block['toolUseId']

                # ── Execute agent ──────────────────────────────────────────
                if name == 'diagnose_symptoms':
                    diag = diagnose_agent(
                        inp.get('symptoms', symptoms),
                        inp.get('user_conditions', user_conditions),
                        image_b64,
                        lang,
                    )
                    state['diagnosis'] = diag
                    # Check memory for return visit after we know the specialty
                    state['past_visit'] = find_return_visit(
                        past_consultations, diag.get('specialty_needed', '')
                    )
                    tool_output = {
                        'condition':        diag.get('condition'),
                        'severity':         diag.get('severity'),
                        'specialty_needed': diag.get('specialty_needed'),
                        'urgency':          diag.get('urgency'),
                        'urgency_reason':   diag.get('urgency_reason'),
                        'red_flags':        diag.get('red_flags', []),
                    }

                elif name == 'find_hospitals':
                    diag = state['diagnosis'] or {}
                    result = hospital_agent(
                        inp.get('specialty', diag.get('specialty_needed', 'General Physician')),
                        lat, lng,
                        inp.get('urgency', diag.get('urgency', 'routine')),
                    )
                    state['hospitals'] = result.get('hospitals', [])
                    tool_output = {
                        'hospitals_found': len(state['hospitals']),
                        'top_3': [
                            {
                                'name':        h['name'],
                                'distance_km': h['distance_km'],
                                'rating':      h.get('rating', 0),
                                'emergency':   h.get('emergency', False),
                                'phone':       h.get('phone', ''),
                            }
                            for h in state['hospitals'][:3]
                        ],
                    }

                elif name == 'rank_hospitals':
                    diag   = state['diagnosis'] or {}
                    hosps  = inp.get('hospitals', state['hospitals']) or state['hospitals']
                    ranked = ranker_agent(hosps, {
                        'condition':            inp.get('condition', diag.get('condition', '')),
                        'severity':             inp.get('severity',  diag.get('severity', 'moderate')),
                        'urgency':              inp.get('urgency',   diag.get('urgency', 'routine')),
                        'specialty_needed':     inp.get('specialty', diag.get('specialty_needed', '')),
                        'questions_for_doctor': diag.get('questions_for_doctor', []),
                        'urgency_reason':       diag.get('urgency_reason', ''),
                    }, state['past_visit'], lang)
                    state['ranked'] = ranked
                    rec = ranked.get('recommended_hospital') or {}
                    tool_output = {
                        'recommended_hospital': rec.get('name'),
                        'ranking_reason':       ranked.get('ranking_reason', ''),
                        'urgency_note':         ranked.get('visit_prep', {}).get('urgency_note', ''),
                    }
                else:
                    tool_output = {'error': f'Unknown tool: {name}'}

                tool_results.append({
                    'toolResult': {
                        'toolUseId': use_id,
                        'content':   [{'json': tool_output}],
                    }
                })

            messages.append({'role': 'user', 'content': tool_results})

    return state


# ═══════════════════════════════════════════════════════════════════════════════
# Lambda handler
# ═══════════════════════════════════════════════════════════════════════════════

def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'POST')
    params = event.get('queryStringParameters') or {}

    # GET /multi-agent/history
    if method == 'GET':
        user_id = params.get('userId', 'anonymous')
        past    = get_past_consultations(user_id, limit=10)
        # Serialize Decimal values from DynamoDB
        clean = json.loads(json.dumps(past, default=str))
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'consultations': clean})}

    if method != 'POST':
        return {'statusCode': 405, 'headers': CORS,
                'body': json.dumps({'error': 'Method not allowed'})}

    try:
        body = json.loads(event.get('body', '{}'))
    except json.JSONDecodeError:
        return {'statusCode': 400, 'headers': CORS,
                'body': json.dumps({'error': 'Invalid JSON body'})}

    symptoms        = (body.get('symptoms') or body.get('question') or '').strip()
    image_b64       = body.get('image')
    lat             = float(body.get('lat', 28.6139))
    lng             = float(body.get('lng', 77.2090))
    lang            = body.get('language', 'en')
    user_conditions = body.get('userConditions') or []
    user_id         = body.get('userId', 'anonymous')

    if not symptoms and not image_b64:
        return {'statusCode': 400, 'headers': CORS,
                'body': json.dumps({'error': 'Provide symptoms text or an image'})}

    # 1. Load memory (non-blocking — past consultations for return-visit detection)
    past_consultations = get_past_consultations(user_id)

    # 2. Run agentic orchestration
    state = run_orchestrator(
        symptoms, image_b64, lat, lng, lang, user_conditions, past_consultations
    )

    diagnosis = state.get('diagnosis') or {}
    ranked    = state.get('ranked')    or {}
    past_v    = state.get('past_visit', {'found': False})
    hospitals = state.get('hospitals', [])
    rec_hosp  = ranked.get('recommended_hospital')

    # 3. Persist this consultation to memory
    save_consultation(user_id, symptoms, diagnosis, rec_hosp or {}, lang)

    # 4. Build clean response
    response = {
        'consultation_id': f'consult#{datetime.now(timezone.utc).isoformat()}',
        'orchestrator_summary': state.get('orchestrator_summary', ''),
        'agents': {
            'diagnosis': {
                'condition':        diagnosis.get('condition', ''),
                'severity':         diagnosis.get('severity', 'moderate'),
                'specialty_needed': diagnosis.get('specialty_needed', 'General Physician'),
                'urgency':          diagnosis.get('urgency', 'routine'),
                'urgency_reason':   diagnosis.get('urgency_reason', ''),
                'red_flags':        diagnosis.get('red_flags', []),
                'action_steps':     diagnosis.get('action_steps', []),
                'image_analysis':   diagnosis.get('image_context', ''),
            },
            'hospital_finder': {
                'count':             len(hospitals),
                'hospitals':         hospitals[:10],
                'specialty_searched': diagnosis.get('specialty_needed', ''),
            },
            'ranker': {
                'recommended_hospital': rec_hosp,
                'ranked_list':          ranked.get('ranked_list', hospitals[:5]),
                'ranking_reason':       ranked.get('ranking_reason', ''),
                'visit_prep':           ranked.get('visit_prep', {}),
            },
        },
        'past_visit':  past_v,
        'memory': {
            'past_consultations_count': len(past_consultations),
            'return_visit_suggested':   past_v.get('found', False),
        },
    }

    return {
        'statusCode': 200,
        'headers':    CORS,
        'body':       json.dumps(response, default=str),
    }
