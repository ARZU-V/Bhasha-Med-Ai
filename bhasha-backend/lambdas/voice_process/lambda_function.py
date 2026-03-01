import json
import boto3
import os
import uuid
import urllib.request
from datetime import datetime
from boto3.dynamodb.conditions import Key

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

MODEL_ID = 'us.amazon.nova-micro-v1:0'

LANG_MAP = {
    'hi': 'Hindi',
    'te': 'Telugu',
    'ta': 'Tamil',
    'en': 'English',
    'mr': 'Marathi',
    'bn': 'Bengali',
    'gu': 'Gujarati',
    'kn': 'Kannada',
    'ml': 'Malayalam',
    'pa': 'Punjabi',
}

# Google Cloud TTS BCP-47 language codes for all 10 Indian languages
GOOGLE_TTS_LANG_MAP = {
    'hi': 'hi-IN',
    'en': 'en-IN',
    'bn': 'bn-IN',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'mr': 'mr-IN',
    'gu': 'gu-IN',
    'kn': 'kn-IN',
    'ml': 'ml-IN',
    'pa': 'pa-IN',
}


def google_tts(text: str, language: str, api_key: str) -> str | None:
    """Call Google Cloud TTS REST API. Returns base64-encoded MP3 or None on failure."""
    lang_code = GOOGLE_TTS_LANG_MAP.get(language, 'hi-IN')

    payload = json.dumps({
        'input': {'text': text},
        'voice': {
            'languageCode': lang_code,
            'ssmlGender': 'FEMALE',
        },
        'audioConfig': {
            'audioEncoding': 'MP3',
            'speakingRate': 0.95,
        },
    }).encode('utf-8')

    url = f'https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}'
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get('audioContent')  # base64-encoded MP3
    except Exception as e:
        print(f"Google TTS failed (non-fatal): {e}")
        return None


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body', '{}'))
        text = body.get('text', '')
        # Accept BCP-47 ('hi-IN') or short code ('hi') — normalize to short
        language_raw = body.get('language', 'en')
        language = language_raw.split('-')[0] if '-' in language_raw else language_raw
        user_id = body.get('userId', 'demo-user-123')
        session_id = body.get('sessionId', str(uuid.uuid4()))

        if not text:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'text is required'})
            }

        lang_name = LANG_MAP.get(language, 'English')

        # ── Amazon Nova Micro via Converse API ────────────────────────────────
        # Nova models are only available in us-east-1, not ap-south-1
        bedrock_region = os.environ.get('BEDROCK_REGION', 'us-east-1')
        bedrock = boto3.client('bedrock-runtime', region_name=bedrock_region)

        system_prompt = f"""You are Bhasha AI, a warm and caring AI health companion for Indian users.

LANGUAGE RULE: The user is speaking in {lang_name}. Reply ONLY in {lang_name}. Never switch languages.

CRITICAL RULES:
- Read the full conversation history before replying
- NEVER ask a question that was already asked and answered in this conversation
- Give direct, concrete advice once you have enough information — do not keep asking questions
- Keep replies to 2-3 short sentences — they are spoken aloud by voice
- Ask only ONE question per reply if you still need more information

SYMPTOMS (headache, fever, pain, etc.):
- If duration not yet known → ask how long they have had it
- If other symptoms not yet asked → ask if there are other symptoms
- Once you know duration AND other symptoms → give advice immediately:
  * 1-3 days, mild → suggest rest, fluids, paracetamol if needed, and say "if it continues beyond 3 days see a doctor"
  * 3+ days OR severe/worsening → say "Please see a doctor soon"
  * Do NOT ask the same question again if already answered

APPOINTMENTS (book/doctor/clinic/appointment):
- Step 1: Ask which type of doctor or clinic name (if not known)
- Step 2: Ask preferred date and time (if not known)
- Step 3: Ask their phone number for clinic confirmation (if not known)
- Step 4: Confirm and say "I am sending your appointment request now"

EMERGENCY — chest pain, breathing difficulty, unconscious, stroke:
Say: "Yeh bahut serious hai. Abhi 112 call karein ya turant hospital jayein."

Be warm and caring. Speak like a helpful friend, not a formal doctor."""

        # ── Load conversation history from DynamoDB ───────────────────────────
        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table = dynamodb.Table(os.environ['DYNAMODB_CONVERSATIONS_TABLE'])

        history_messages = []
        try:
            hist = table.query(
                KeyConditionExpression=Key('sessionId').eq(session_id),
                ScanIndexForward=True,
                Limit=10,  # last 5 turns (user + assistant pairs)
            )
            for item in hist.get('Items', []):
                role = item.get('role')
                item_text = item.get('text', '')
                if role in ('user', 'assistant') and item_text:
                    history_messages.append({'role': role, 'content': [{'text': item_text}]})
        except Exception as hist_err:
            print(f"History query failed (non-fatal): {hist_err}")

        # Bedrock Converse requires strictly alternating user/assistant, starting with user
        filtered = []
        for msg in history_messages:
            if not filtered or msg['role'] != filtered[-1]['role']:
                filtered.append(msg)
        if filtered and filtered[0]['role'] == 'assistant':
            filtered = filtered[1:]

        messages = filtered + [{'role': 'user', 'content': [{'text': text}]}]

        converse_response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{'text': system_prompt}],
            messages=messages,
            inferenceConfig={
                'maxTokens': 300,
                'temperature': 0.6,
            }
        )

        response_text = converse_response['output']['message']['content'][0]['text']

        # ── Intent detection ──────────────────────────────────────────────────
        intent = 'general'
        lower = text.lower()
        response_lower = response_text.lower()

        # English + Hindi/Indian language keywords for each intent
        booking_user = ['appointment', 'doctor', 'clinic', 'book', 'physician',
                        'अपॉइंटमेंट', 'डॉक्टर', 'क्लिनिक', 'बुक', 'চিকিৎসক', 'నేను']
        # Detect booking confirmation in AI's own response (works across all languages)
        booking_ai = ['appointment request', 'sending your appointment', 'book', 'appointment now',
                      'नोट कर लिया', 'अपॉइंटमेंट बुक', 'संपर्क करूंगा', 'बुक कर',
                      'appointment ke liye']

        med_user = ['medicine', 'tablet', 'pill', 'dose', 'remind',
                    'दवा', 'गोली', 'दवाई', 'टैबलेट', 'ওষুধ', 'మందు']
        emergency_user = ['emergency', 'chest pain', 'breathing', 'unconscious', 'stroke',
                          'छाती में दर्द', 'सांस', 'बेहोश']
        symptom_user = ['symptom', 'fever', 'headache', 'sick', 'feel', 'pain',
                        'बुखार', 'सिरदर्द', 'दर्द', 'बीमार', 'জ্বর', 'తలనొప్పి']

        if any(w in lower for w in booking_user) or any(w in response_lower for w in booking_ai):
            intent = 'booking'
        elif any(w in lower for w in med_user):
            intent = 'medication'
        elif any(w in lower for w in emergency_user):
            intent = 'emergency'
        elif any(w in lower for w in symptom_user):
            intent = 'symptom'

        # ── Google Cloud TTS ──────────────────────────────────────────────────
        # Supports all 10 Indian languages with natural neural voices.
        # Returns base64-encoded MP3 directly — no S3 needed.
        tts_text = (
            response_text
            .replace('—', ',')
            .replace('–', ',')
            .replace('*', '')
            .replace('#', '')
            [:1000]  # Google TTS limit: 5000 chars; keep short for voice UX
        )

        audio_content = None
        google_api_key = os.environ.get('GOOGLE_TTS_API_KEY', '')
        if google_api_key:
            audio_content = google_tts(tts_text, language, google_api_key)
        else:
            print("GOOGLE_TTS_API_KEY not set — text-only response")

        # ── Save conversation to DynamoDB ─────────────────────────────────────
        now = datetime.utcnow().isoformat()

        table.put_item(Item={
            'sessionId': session_id,
            'timestamp': now,
            'userId': user_id,
            'role': 'user',
            'text': text,
            'intent': intent,
        })
        table.put_item(Item={
            'sessionId': session_id,
            'timestamp': f"{now}_response",
            'userId': user_id,
            'role': 'assistant',
            'text': response_text,
            'hasAudio': audio_content is not None,
        })

        response_body = {
            'responseText': response_text,
            'audioContent': audio_content,
            'intent': intent,
            'sessionId': session_id,
        }
        # When booking confirmed, extract structured details from conversation
        if intent == 'booking':
            response_body['bookingData'] = _extract_booking_data(messages)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps(response_body)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def _extract_booking_data(messages: list) -> dict:
    """Scan conversation history for doctor name, preferred time, and phone number."""
    import re
    data = {'doctorName': '', 'preferredTime': '', 'patientPhone': ''}

    for msg in messages:
        if msg.get('role') != 'user':
            continue
        text = msg.get('content', [{}])[0].get('text', '') if isinstance(msg.get('content'), list) else ''

        # 10-digit Indian phone (with optional +91 prefix)
        phone = re.search(r'(?:\+?91[-\s]?)?([6-9]\d{4}[-\s]?\d{5})', text)
        if phone and not data['patientPhone']:
            data['patientPhone'] = re.sub(r'[-\s]', '', phone.group())

        # Doctor / clinic name after keyword
        doc = re.search(
            r'(?:doctor|dr\.?|डॉक्टर|clinic|अस्पताल)\s+([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]{1,30})',
            text, re.IGNORECASE
        )
        if doc and not data['doctorName']:
            data['doctorName'] = doc.group(1).strip()

        # Time / day expressions
        time_match = re.search(
            r'(tomorrow|today|kal|aaj|monday|tuesday|wednesday|thursday|friday|saturday|sunday'
            r'|कल|आज|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार'
            r'|\d{1,2}\s*(?:am|pm|बजे))',
            text, re.IGNORECASE
        )
        if time_match and not data['preferredTime']:
            data['preferredTime'] = time_match.group().strip()

    return data
