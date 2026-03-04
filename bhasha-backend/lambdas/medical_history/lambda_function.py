"""
medical_history/lambda_function.py

Medical history CRUD + AI doctor summary.

Routes:
  GET  /history?userId=xxx                → fetch timeline
  POST /history                           → add entry (+ optional doc upload)
  POST /history/summary?userId=xxx        → generate doctor-ready AI summary
  DELETE /history?userId=xxx&ts=xxx       → remove one entry

POST /history body:
{
  userId:     str,
  condition:  str,          # "knee pain", "fever", etc.
  year:       str,          # "2022" or "2-3 years back"
  doctorName: str,          # optional
  hospital:   str,          # optional
  notes:      str,          # optional free text
  docBase64:  str,          # optional base64 encoded image/PDF
  docName:    str,          # filename e.g. "report.pdf"
}

Env vars:
  DYNAMODB_MAIN_TABLE   — defaults to BhashaAiMain
  S3_BUCKET             — defaults to bhasha-ai-audio-arjit
  BEDROCK_REGION        — defaults to us-east-1
"""

import json
import re
import boto3
import os
import base64
import uuid
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
}

TABLE_NAME     = os.environ.get('DYNAMODB_MAIN_TABLE', 'BhashaAIMain')
S3_BUCKET      = os.environ.get('S3_BUCKET', 'bhasha-ai-audio-arjit')
APP_REGION     = os.environ.get('APP_REGION', 'ap-south-1')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'us-east-1')
SUMMARY_MODEL  = 'us.amazon.nova-pro-v1:0'


def _dynamo():
    return boto3.resource('dynamodb', region_name=APP_REGION).Table(TABLE_NAME)

def _s3():
    return boto3.client('s3', region_name=APP_REGION)

def _bedrock():
    return boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)


# ── GET /history ───────────────────────────────────────────────────────────────

def get_history(user_id: str) -> list:
    table = _dynamo()
    resp  = table.query(
        KeyConditionExpression=Key('userId').eq(user_id) & Key('recordId').begins_with('history#'),
    )
    items = resp.get('Items', [])
    # Sort newest first
    items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return items


# ── Voice field extraction ─────────────────────────────────────────────────────

def extract_voice_fields(condition_raw, year_raw, doctor_raw, hospital_raw, notes_raw) -> dict:
    """
    When voice input is detected (long natural sentences), use Bedrock to extract
    clean concise field values. Falls back to raw values on any error.
    """
    # Only call Bedrock if at least one field looks like natural speech (>50 chars)
    is_voice = any(len((v or '').strip()) > 50 for v in [condition_raw, year_raw, doctor_raw, hospital_raw])
    if not is_voice:
        return {'condition': condition_raw, 'year': year_raw,
                'doctorName': doctor_raw, 'hospital': hospital_raw, 'notes': notes_raw}

    prompt = (
        'Extract clean, concise medical record fields from this voice input. '
        'Return ONLY valid JSON — no explanation.\n\n'
        f'Condition/Disease spoken: {condition_raw}\n'
        f'When it happened: {year_raw}\n'
        f'Doctor name spoken: {doctor_raw}\n'
        f'Hospital spoken: {hospital_raw}\n'
        f'Extra notes: {notes_raw}\n\n'
        'Return JSON:\n'
        '{\n'
        '  "condition": "short condition name only, e.g. Type 2 Diabetes, Hypertension",\n'
        '  "year": "year or short timeframe only, e.g. 2018 or 6 years ago",\n'
        '  "doctorName": "doctor name only, e.g. Dr. Rajesh Sharma, or empty string",\n'
        '  "hospital": "hospital/clinic name only, e.g. Apollo Lucknow, or empty string",\n'
        '  "notes": "any extra medical details as brief notes, or empty string"\n'
        '}'
    )
    try:
        resp = _bedrock().converse(
            modelId=SUMMARY_MODEL,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 250, 'temperature': 0.0},
        )
        text = resp['output']['message']['content'][0]['text'].strip()
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            ex = json.loads(m.group())
            return {
                'condition':  (ex.get('condition')  or condition_raw)[:200],
                'year':       (ex.get('year')        or year_raw)[:50],
                'doctorName': (ex.get('doctorName')  or doctor_raw)[:100],
                'hospital':   (ex.get('hospital')    or hospital_raw)[:100],
                'notes':      (ex.get('notes')       or notes_raw)[:1000],
            }
    except Exception as e:
        print(f'[extract_voice_fields] error: {e}')
    return {'condition': condition_raw, 'year': year_raw,
            'doctorName': doctor_raw, 'hospital': hospital_raw, 'notes': notes_raw}


# ── POST /history ──────────────────────────────────────────────────────────────

def add_entry(body: dict) -> dict:
    user_id   = body.get('userId', 'anonymous')
    condition = (body.get('condition') or '').strip()
    year      = (body.get('year') or '').strip()
    doctor    = (body.get('doctorName') or '').strip()
    hospital  = (body.get('hospital') or '').strip()
    notes     = (body.get('notes') or '').strip()

    # Clean up voice transcripts into structured fields
    extracted = extract_voice_fields(condition, year, doctor, hospital, notes)
    condition = extracted['condition']
    year      = extracted['year']
    doctor    = extracted['doctorName']
    hospital  = extracted['hospital']
    notes     = extracted['notes']
    doc_b64   = body.get('docBase64', '')
    doc_name  = body.get('docName', 'document')
    lang      = body.get('language', 'en')

    ts = datetime.now(timezone.utc).isoformat()

    # Upload document to S3 if provided
    doc_s3_key = ''
    doc_url    = ''
    if doc_b64:
        try:
            # Strip data URL prefix if present
            if ',' in doc_b64:
                doc_b64 = doc_b64.split(',', 1)[1]
            doc_bytes  = base64.b64decode(doc_b64)
            safe_name  = doc_name.replace(' ', '_')
            doc_s3_key = f'history/{user_id}/{uuid.uuid4().hex[:8]}_{safe_name}'
            _s3().put_object(
                Bucket=S3_BUCKET,
                Key=doc_s3_key,
                Body=doc_bytes,
                ContentType='application/octet-stream',
            )
            doc_url = f's3://{S3_BUCKET}/{doc_s3_key}'
        except Exception as e:
            print(f'[s3_upload] error (non-fatal): {e}')

    # Generate brief AI summary for this entry
    ai_summary = generate_entry_summary(condition, year, doctor, hospital, notes, lang)

    item = {
        'userId':     user_id,
        'recordId':   f'history#{ts}',
        'timestamp':  ts,
        'condition':  condition,
        'year':       year,
        'doctorName': doctor,
        'hospital':   hospital,
        'notes':      notes[:1000],
        'docS3Key':   doc_s3_key,
        'docUrl':     doc_url,
        'aiSummary':  ai_summary,
        'language':   lang,
    }

    _dynamo().put_item(Item=item)
    return item


def generate_entry_summary(condition, year, doctor, hospital, notes, lang='en') -> str:
    """Generate a 1-2 sentence AI summary for a single history entry."""
    lang_name = {'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil', 'en': 'English',
                 'mr': 'Marathi', 'bn': 'Bengali'}.get(lang, 'English')
    prompt = (
        f'Summarise this health event in 1-2 sentences for a medical record. Reply in {lang_name}.\n'
        f'Condition: {condition}\nYear: {year}\n'
        f'Doctor: {doctor or "unknown"}\nHospital: {hospital or "unknown"}\n'
        f'Notes: {notes or "none"}\n'
        'Be concise and clinical. No disclaimers.'
    )
    try:
        resp = _bedrock().converse(
            modelId=SUMMARY_MODEL,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 120, 'temperature': 0.1},
        )
        return resp['output']['message']['content'][0]['text'].strip()
    except Exception as e:
        print(f'[entry_summary] error: {e}')
        parts = [condition]
        if year:   parts.append(f'({year})')
        if doctor: parts.append(f'— Dr. {doctor}')
        return ' '.join(parts)


# ── POST /history/summary ─────────────────────────────────────────────────────

def generate_doctor_summary(user_id: str, patient_name: str = '',
                              patient_age: str = '', known_conditions: list = None) -> str:
    """Generate a full doctor-ready medical history summary."""
    entries = get_history(user_id)
    if not entries:
        return 'No medical history recorded yet.'

    known_conditions = known_conditions or []

    # Build timeline text
    timeline_lines = []
    for e in reversed(entries):  # oldest first for chronological
        line = f"• {e.get('year', 'Unknown year')} — {e.get('condition', '')}"
        if e.get('doctorName'): line += f" | Dr. {e['doctorName']}"
        if e.get('hospital'):   line += f" @ {e['hospital']}"
        if e.get('notes'):      line += f"\n  Notes: {e['notes'][:200]}"
        if e.get('aiSummary'):  line += f"\n  Summary: {e['aiSummary']}"
        timeline_lines.append(line)

    timeline_text = '\n'.join(timeline_lines)

    patient_info = ''
    if patient_name: patient_info += f'Patient: {patient_name}\n'
    if patient_age:  patient_info += f'Age: {patient_age}\n'
    if known_conditions: patient_info += f'Known conditions: {", ".join(known_conditions)}\n'

    prompt = f"""You are a medical documentation assistant. Create a CONCISE doctor-ready summary in bullet points only — no long paragraphs.

{patient_info}
MEDICAL HISTORY (chronological):
{timeline_text}

Format EXACTLY like this — short bullets, no filler text:

**Patient:** [name, age, known conditions — one line]

**History Timeline:**
• [year] — [condition] [| Dr. name if known] [@ hospital if known]
(one bullet per event)

**Recurring Issues:**
• [condition seen more than once, or "None identified"]

**Recent Concerns:**
• [last 1–2 entries only, one bullet each]

**Recommended Follow-ups:**
• [1–3 specific actions based on history]

⚠️ AI-generated. Verify with patient before clinical use."""

    try:
        resp = _bedrock().converse(
            modelId=SUMMARY_MODEL,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 1200, 'temperature': 0.1},
        )
        return resp['output']['message']['content'][0]['text'].strip()
    except Exception as e:
        print(f'[doctor_summary] error: {e}')
        return f'Medical history for {patient_name or user_id}:\n\n{timeline_text}'


# ── DELETE /history ────────────────────────────────────────────────────────────

def delete_entry(user_id: str, record_id: str):
    _dynamo().delete_item(Key={'userId': user_id, 'recordId': record_id})


# ── Lambda handler ─────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path   = event.get('path', '/history')
    params = event.get('queryStringParameters') or {}

    try:
        # GET /history — fetch timeline
        if method == 'GET':
            user_id = params.get('userId', 'anonymous')
            items   = get_history(user_id)
            return {
                'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'entries': items, 'count': len(items)}),
            }

        # DELETE /history
        if method == 'DELETE':
            user_id   = params.get('userId', 'anonymous')
            record_id = params.get('recordId', '')
            if not record_id:
                return {'statusCode': 400, 'headers': CORS,
                        'body': json.dumps({'error': 'recordId required'})}
            delete_entry(user_id, record_id)
            return {'statusCode': 200, 'headers': CORS,
                    'body': json.dumps({'deleted': True})}

        # POST
        if method == 'POST':
            body = json.loads(event.get('body', '{}'))

            # POST /history/summary
            if path.endswith('/summary'):
                user_id    = params.get('userId') or body.get('userId', 'anonymous')
                name       = body.get('patientName', '')
                age        = body.get('patientAge', '')
                conditions = body.get('knownConditions', [])
                summary    = generate_doctor_summary(user_id, name, age, conditions)
                return {
                    'statusCode': 200, 'headers': CORS,
                    'body': json.dumps({'summary': summary}),
                }

            # POST /history — add entry
            entry = add_entry(body)
            return {
                'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'entry': entry}),
            }

        return {'statusCode': 405, 'headers': CORS,
                'body': json.dumps({'error': 'Method not allowed'})}

    except Exception as e:
        print(f'[history_handler] error: {e}')
        return {'statusCode': 500, 'headers': CORS,
                'body': json.dumps({'error': str(e)})}
