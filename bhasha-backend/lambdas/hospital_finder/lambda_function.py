import json
import math
import urllib.request
import urllib.parse
import os

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
}

EMERGENCY_KEYWORDS = ['emergency', 'trauma', 'casualty', 'critical care', 'icu', 'accident']

# Condition keyword → specialty mapping (ranked by first match)
CONDITION_TO_SPECIALTY = {
    'bone': 'Orthopedic', 'fracture': 'Orthopedic', 'joint': 'Orthopedic',
    'knee': 'Orthopedic', 'shoulder': 'Orthopedic', 'hip': 'Orthopedic',
    'spine': 'Orthopedic', 'back pain': 'Orthopedic', 'leg pain': 'Orthopedic',
    'arm pain': 'Orthopedic', 'wrist': 'Orthopedic', 'ankle': 'Orthopedic',
    'heart': 'Cardiologist', 'chest pain': 'Cardiologist', 'cardiac': 'Cardiologist',
    'blood pressure': 'Cardiologist', 'hypertension': 'Cardiologist', 'palpitation': 'Cardiologist',
    'brain': 'Neurologist', 'seizure': 'Neurologist', 'epilepsy': 'Neurologist',
    'migraine': 'Neurologist', 'paralysis': 'Neurologist', 'stroke': 'Neurologist',
    'nerve': 'Neurologist', 'numbness': 'Neurologist',
    'eye': 'Ophthalmologist', 'vision': 'Ophthalmologist', 'cataract': 'Ophthalmologist',
    'skin': 'Dermatologist', 'rash': 'Dermatologist', 'eczema': 'Dermatologist',
    'acne': 'Dermatologist', 'psoriasis': 'Dermatologist',
    'lung': 'Pulmonologist', 'breath': 'Pulmonologist', 'asthma': 'Pulmonologist',
    'cough': 'Pulmonologist', 'tb': 'Pulmonologist', 'tuberculosis': 'Pulmonologist',
    'stomach': 'Gastroenterologist', 'liver': 'Gastroenterologist', 'gut': 'Gastroenterologist',
    'digestion': 'Gastroenterologist', 'acidity': 'Gastroenterologist', 'ibs': 'Gastroenterologist',
    'kidney': 'Nephrologist', 'urine': 'Nephrologist', 'dialysis': 'Nephrologist',
    'mental': 'Psychiatrist', 'depression': 'Psychiatrist', 'anxiety': 'Psychiatrist',
    'stress': 'Psychiatrist', 'insomnia': 'Psychiatrist', 'schizophrenia': 'Psychiatrist',
    'child': 'Pediatrician', 'baby': 'Pediatrician', 'infant': 'Pediatrician',
    'ear': 'ENT Specialist', 'nose': 'ENT Specialist', 'throat': 'ENT Specialist',
    'tonsil': 'ENT Specialist', 'hearing': 'ENT Specialist',
    'diabetes': 'Endocrinologist', 'thyroid': 'Endocrinologist', 'sugar': 'Endocrinologist',
    'hormone': 'Endocrinologist',
    'cancer': 'Oncologist', 'tumor': 'Oncologist', 'chemotherapy': 'Oncologist',
    'teeth': 'Dentist', 'dental': 'Dentist', 'gum': 'Dentist',
    'pregnancy': 'Gynecologist', 'period': 'Gynecologist', 'ovary': 'Gynecologist',
    'urology': 'Urologist', 'prostate': 'Urologist',
    'blood': 'Hematologist', 'anemia': 'Hematologist',
    'allergy': 'Allergist', 'immune': 'Immunologist',
    'physiotherapy': 'Physiotherapist', 'rehabilitation': 'Physiotherapist',
}


def detect_specialty(condition: str) -> str:
    """Map a free-text condition/symptom to a medical specialty."""
    text = condition.lower()
    # Longest-match first (multi-word phrases take priority)
    sorted_keys = sorted(CONDITION_TO_SPECIALTY.keys(), key=len, reverse=True)
    for kw in sorted_keys:
        if kw in text:
            return CONDITION_TO_SPECIALTY[kw]
    return ''
GOVT_KEYWORDS = ['government', 'govt', 'aiims', 'civil', 'district', 'primary health',
                 'phc', 'chc', 'taluk', 'municipal', 'safdarjung', 'lnjp', 'rml', 'nimhans', 'pgimer']
CLINIC_KEYWORDS = ['clinic', 'dispensary', 'nursing home', 'health center', 'polyclinic', 'maternity']


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    if event.get('httpMethod') != 'GET':
        return {'statusCode': 405, 'headers': CORS, 'body': json.dumps({'error': 'Method not allowed'})}

    try:
        params = event.get('queryStringParameters') or {}
        lat = float(params.get('lat', 28.6139))
        lng = float(params.get('lng', 77.2090))
        radius_km = float(params.get('radius', 10))
        filter_type = params.get('type', 'all')
        specialty = params.get('specialty', '').strip()  # e.g. "Cardiologist"
        condition = params.get('condition', '').strip()  # e.g. "knee pain" → auto-detects specialty
        lookup_name = params.get('name', '').strip()     # phone lookup by name

        # Auto-detect specialty from condition if specialty not explicitly set
        if condition and not specialty:
            specialty = detect_specialty(condition)

        radius_m = int(radius_km * 1000)

        google_api_key = os.environ.get('GOOGLE_MAPS_API_KEY', '')

        # ── Phone lookup by hospital name ─────────────────────────────────────
        if lookup_name and google_api_key:
            phone = find_phone_by_name(lookup_name, lat, lng, google_api_key)
            return {
                'statusCode': 200,
                'headers': CORS,
                'body': json.dumps({'phone': phone, 'name': lookup_name})
            }

        # ── Specialty search via Google Places ────────────────────────────────
        if specialty and google_api_key:
            hospitals = fetch_by_specialty(lat, lng, radius_m, specialty, google_api_key)
            hospitals.sort(key=lambda h: (-h.get('rating', 0), h['distance_km']))
            return {
                'statusCode': 200,
                'headers': CORS,
                'body': json.dumps({
                    'hospitals': hospitals[:10],
                    'count': len(hospitals),
                    'searchLocation': {'lat': lat, 'lng': lng},
                    'radiusKm': radius_km,
                    'specialty': specialty,
                    'detectedFrom': condition if condition else None,
                })
            }

        # ── General search via Overpass (OpenStreetMap) ───────────────────────
        hospitals = fetch_from_overpass(lat, lng, radius_m)

        if filter_type == 'emergency':
            hospitals = [h for h in hospitals if h['emergency']]
        elif filter_type == 'clinic':
            hospitals = [h for h in hospitals if h['type'] == 'clinic']
        elif filter_type == 'government':
            hospitals = [h for h in hospitals if h['type'] == 'government']

        hospitals.sort(key=lambda h: (0 if h['emergency'] else 1, h['distance_km']))
        top = hospitals[:30]

        # Enrich top 10 results with phone numbers from Google Places if missing
        if google_api_key:
            for h in top[:10]:
                if not h.get('phone'):
                    h['phone'] = find_phone_by_name(h['name'], h['lat'], h['lng'], google_api_key)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'hospitals': top,
                'count': len(hospitals),
                'searchLocation': {'lat': lat, 'lng': lng},
                'radiusKm': radius_km,
            })
        }

    except Exception as e:
        print(f"Error: {e}")
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': str(e)})}


def fetch_by_specialty(lat: float, lng: float, radius_m: int, specialty: str, api_key: str) -> list:
    """Search Google Places for a specific doctor specialty and return results with phone + rating."""
    keyword = urllib.parse.quote(f"{specialty} doctor clinic")
    url = (
        f"https://maps.googleapis.com/maps/api/place/nearbysearch/json"
        f"?location={lat},{lng}&radius={radius_m}&keyword={keyword}"
        f"&type=doctor|hospital&rankby=prominence&key={api_key}"
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"Google Places search failed: {e}")
        return []

    results = []
    for place in data.get('results', [])[:8]:
        place_lat = place['geometry']['location']['lat']
        place_lng = place['geometry']['location']['lng']
        dist = haversine_km(lat, lng, place_lat, place_lng)

        # Fetch phone number via Places Details
        phone = ''
        place_id = place.get('place_id', '')
        if place_id:
            phone = fetch_place_phone(place_id, api_key)

        results.append({
            'id': place_id,
            'name': place.get('name', 'Clinic'),
            'address': place.get('vicinity', 'Address not available'),
            'distance_km': round(dist, 2),
            'lat': place_lat,
            'lng': place_lng,
            'type': 'clinic',
            'emergency': False,
            'phone': phone,
            'rating': place.get('rating', 0),
            'total_ratings': place.get('user_ratings_total', 0),
            'specialty': specialty,
        })

    return results


def fetch_place_phone(place_id: str, api_key: str) -> str:
    """Fetch phone number for a place from Google Places Details API."""
    url = (
        f"https://maps.googleapis.com/maps/api/place/details/json"
        f"?place_id={place_id}&fields=formatted_phone_number&key={api_key}"
    )
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('result', {}).get('formatted_phone_number', '')
    except Exception as e:
        print(f"Place details failed for {place_id}: {e}")
        return ''


def find_phone_by_name(name: str, lat: float, lng: float, api_key: str) -> str:
    """Search Google Places by hospital name + location and return its phone number."""
    query = urllib.parse.quote(name)
    url = (
        f"https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
        f"?input={query}&inputtype=textquery"
        f"&locationbias=circle:2000@{lat},{lng}"
        f"&fields=place_id&key={api_key}"
    )
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        candidates = data.get('candidates', [])
        if not candidates:
            return ''
        place_id = candidates[0].get('place_id', '')
        return fetch_place_phone(place_id, api_key) if place_id else ''
    except Exception as e:
        print(f"find_phone_by_name failed for {name}: {e}")
        return ''


def fetch_from_overpass(lat: float, lng: float, radius_m: int) -> list:
    """Query OpenStreetMap Overpass API for hospitals/clinics within radius."""
    query = f"""
[out:json][timeout:20];
(
  node["amenity"~"^(hospital|clinic|doctors|pharmacy|health_post)$"](around:{radius_m},{lat},{lng});
  way["amenity"~"^(hospital|clinic|doctors|pharmacy|health_post)$"](around:{radius_m},{lat},{lng});
  node["healthcare"~"^(hospital|clinic|centre|doctor)$"](around:{radius_m},{lat},{lng});
  way["healthcare"~"^(hospital|clinic|centre|doctor)$"](around:{radius_m},{lat},{lng});
);
out center;
"""
    encoded = urllib.parse.urlencode({'data': query}).encode('utf-8')
    req = urllib.request.Request(
        'https://overpass-api.de/api/interpreter',
        data=encoded,
        headers={'User-Agent': 'BhashaAI-HealthApp/1.0'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"Overpass query failed: {e}")
        return []

    hospitals = []
    seen = set()

    for element in data.get('elements', []):
        tags = element.get('tags', {})
        name = tags.get('name') or tags.get('name:en') or tags.get('amenity', 'Medical Facility')
        name = name.strip()

        # Get coordinates — nodes have lat/lon directly, ways have center
        if element['type'] == 'node':
            place_lat, place_lng = element.get('lat', lat), element.get('lon', lng)
        else:
            center = element.get('center', {})
            place_lat = center.get('lat', lat)
            place_lng = center.get('lon', lng)

        # Deduplicate by name+coords
        key = f"{name}_{round(place_lat, 4)}_{round(place_lng, 4)}"
        if key in seen:
            continue
        seen.add(key)

        dist = haversine_km(lat, lng, place_lat, place_lng)

        classification = classify(name, tags)

        phone = tags.get('phone') or tags.get('contact:phone') or tags.get('contact:mobile')
        address_parts = [
            tags.get('addr:housenumber', ''),
            tags.get('addr:street', ''),
            tags.get('addr:suburb', ''),
            tags.get('addr:city', ''),
        ]
        address = ', '.join(p for p in address_parts if p) or 'Address not available'

        hospitals.append({
            'id': str(element.get('id', key)),
            'name': name,
            'address': address,
            'distance_km': round(dist, 2),
            'lat': place_lat,
            'lng': place_lng,
            'type': classification['type'],
            'emergency': classification['emergency'],
            'phone': phone,
        })

    return hospitals


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def classify(name: str, tags: dict) -> dict:
    text = (name + ' ' + tags.get('amenity', '') + ' ' + tags.get('healthcare', '')).lower()
    emergency = any(kw in text for kw in EMERGENCY_KEYWORDS) or tags.get('emergency') == 'yes'
    is_govt = any(kw in text for kw in GOVT_KEYWORDS)
    is_clinic = any(kw in text for kw in CLINIC_KEYWORDS) or tags.get('amenity') in ('clinic', 'doctors')

    if is_clinic:
        htype = 'clinic'
    elif is_govt:
        htype = 'government'
    else:
        htype = 'hospital'

    # hospitals always assumed to have emergency unless it's a clinic/pharmacy
    if htype == 'hospital' and not is_clinic:
        emergency = True

    return {'type': htype, 'emergency': emergency}
