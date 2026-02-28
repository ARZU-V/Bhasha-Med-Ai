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

        radius_m = int(radius_km * 1000)
        hospitals = fetch_from_overpass(lat, lng, radius_m)

        # Filter
        if filter_type == 'emergency':
            hospitals = [h for h in hospitals if h['emergency']]
        elif filter_type == 'clinic':
            hospitals = [h for h in hospitals if h['type'] == 'clinic']
        elif filter_type == 'government':
            hospitals = [h for h in hospitals if h['type'] == 'government']

        # Rank: emergency first, then nearest
        hospitals.sort(key=lambda h: (0 if h['emergency'] else 1, h['distance_km']))

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'hospitals': hospitals[:30],  # cap at 30 results
                'count': len(hospitals),
                'searchLocation': {'lat': lat, 'lng': lng},
                'radiusKm': radius_km,
            })
        }

    except Exception as e:
        print(f"Error: {e}")
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': str(e)})}


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
