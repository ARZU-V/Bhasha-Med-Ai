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

MODEL_ID = 'us.amazon.nova-lite-v1:0'
# Bedrock is always called via us-east-1 (Nova cross-region inference requires US hub)
BEDROCK_REGION = 'us-east-1'

LANG_MAP = {
    'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil', 'en': 'English',
    'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
    'kn': 'Kannada', 'ml': 'Malayalam', 'pa': 'Punjabi',
}

GOOGLE_TTS_LANG_MAP = {
    'hi': 'hi-IN', 'en': 'en-IN', 'bn': 'bn-IN', 'ta': 'ta-IN',
    'te': 'te-IN', 'mr': 'mr-IN', 'gu': 'gu-IN', 'kn': 'kn-IN',
    'ml': 'ml-IN', 'pa': 'pa-IN',
}

# ── Hardcoded responses in 10 Indian languages ────────────────────────────────
RESP = {
    'hi': {
        'ask_duration': 'यह कितने समय से हो रहा है?',
        'ask_impact':   'क्या यह आपकी नींद या रोज़ के काम को प्रभावित कर रहा है?',
        'book':         'आपको {doctor} से मिलना चाहिए।',
        'nearby':       'नज़दीकी क्लिनिक का नक्शा दिखा रहा हूं।',
        'emergency':    'यह बहुत गंभीर है, अभी 112 पर कॉल करें।',
        'reminder':     '{med} का रिमाइंडर {time} के लिए सेट कर दिया।',
    },
    'en': {
        'ask_duration': 'How long has this been happening?',
        'ask_impact':   'Is this affecting your sleep or daily work?',
        'book':         'You should see a {doctor}.',
        'nearby':       'Showing nearby clinics on the map.',
        'emergency':    'This is very serious, call 112 right now.',
        'reminder':     '{med} reminder set for {time}.',
    },
    'te': {
        'ask_duration': 'ఇది ఎంత కాలంగా జరుగుతోంది?',
        'ask_impact':   'ఇది మీ నిద్రకు అడ్డుపడుతోందా?',
        'book':         'మీరు {doctor} ను కలవాలి.',
        'nearby':       'దగ్గరలో ఉన్న క్లినిక్ చూపిస్తున్నాను.',
        'emergency':    'అత్యవసరం! 112 కి కాల్ చేయండి.',
        'reminder':     '{med} రిమైండర్ {time} కు సెట్ చేశాను.',
    },
    'ta': {
        'ask_duration': 'இது எவ்வளவு நாளாக நடக்கிறது?',
        'ask_impact':   'இது உங்கள் தூக்கத்தை பாதிக்கிறதா?',
        'book':         'நீங்கள் {doctor} ஐ சந்திக்க வேண்டும்.',
        'nearby':       'அருகில் உள்ள கிளினிக் காட்டுகிறேன்.',
        'emergency':    'மிகவும் தீவிரம், இப்போதே 112 அழையுங்கள்.',
        'reminder':     '{med} க்கு {time} ரிமைண்டர்.',
    },
    'mr': {
        'ask_duration': 'हे किती दिवसांपासून होत आहे?',
        'ask_impact':   'हे तुमच्या झोपेवर परिणाम करत आहे का?',
        'book':         'तुम्हाला {doctor} ला भेटणे आवश्यक आहे.',
        'nearby':       'जवळच्या क्लिनिकचा नकाशा दाखवत आहे.',
        'emergency':    'खूप गंभीर! आत्ताच 112 कॉल करा.',
        'reminder':     '{med} साठी {time} स्मरणपत्र.',
    },
    'bn': {
        'ask_duration': 'এটি কতদিন ধরে হচ্ছে?',
        'ask_impact':   'এটি আপনার ঘুমকে প্রভাবিত করছে?',
        'book':         'আপনার {doctor} দেখা উচিত.',
        'nearby':       'কাছাকাছি ক্লিনিক দেখাচ্ছি.',
        'emergency':    'খুব গুরুতর! এখনই 112 কল করুন.',
        'reminder':     '{med} এর জন্য {time} রিমাইন্ডার.',
    },
    'gu': {
        'ask_duration': 'આ કેટલા સમયથી છે?',
        'ask_impact':   'આ ઊંઘ પર અસર કરે છે?',
        'book':         'તમારે {doctor} ને મળવું જોઈએ.',
        'nearby':       'નજીકની ક્લિનિક નક્શો.',
        'emergency':    'ખૂબ ગંભીર! 112 કૉલ કરો.',
        'reminder':     '{med} {time} રિમાઇન્ડર.',
    },
    'kn': {
        'ask_duration': 'ಇದು ಎಷ್ಟು ದಿನಗಳಿಂದ ಆಗುತ್ತಿದೆ?',
        'ask_impact':   'ನಿದ್ರೆ ತೊಂದರೆ ಆಗುತ್ತಿದೆಯೇ?',
        'book':         '{doctor} ಅನ್ನು ಭೇಟಿ ಮಾಡಿ.',
        'nearby':       'ಹತ್ತಿರದ ಕ್ಲಿನಿಕ್ ನಕ್ಷೆ ತೋರಿಸುತ್ತಿದ್ದೇನೆ.',
        'emergency':    'ತೀವ್ರ! 112 ಕರೆ ಮಾಡಿ.',
        'reminder':     '{med} {time} ರಿಮೈಂಡರ್.',
    },
    'ml': {
        'ask_duration': 'ഇത് എത്ര ദിവസമായി?',
        'ask_impact':   'ഉറക്കം ബാധിക്കുന്നുണ്ടോ?',
        'book':         '{doctor} നെ കാണണം.',
        'nearby':       'അടുത്ത ക്ലിനിക് ഭൂപടം.',
        'emergency':    'ഗുരുതരം! 112 വിളിക്കുക.',
        'reminder':     '{med} {time} റിമൈൻഡർ.',
    },
    'pa': {
        'ask_duration': 'ਇਹ ਕਿੰਨੇ ਸਮੇਂ ਤੋਂ ਹੈ?',
        'ask_impact':   'ਨੀਂਦ ਪ੍ਰਭਾਵਿਤ ਹੋ ਰਹੀ ਹੈ?',
        'book':         '{doctor} ਨੂੰ ਮਿਲੋ.',
        'nearby':       'ਨੇੜੇ ਕਲੀਨਿਕ ਨਕਸ਼ਾ.',
        'emergency':    'ਗੰਭੀਰ! 112 ਕਾਲ ਕਰੋ.',
        'reminder':     '{med} {time} ਰੀਮਾਈਂਡਰ.',
    },
}


def _resp(lang, key, **kw):
    d = RESP.get(lang, RESP['hi'])
    template = d.get(key, RESP['hi'].get(key, ''))
    return template.format(**kw) if kw else template


def _conv_state(history):
    """Detect where we are in the symptom flow from the last assistant message."""
    for msg in reversed(history):
        if msg['role'] != 'assistant':
            continue
        t = msg['content'][0]['text'].lower()
        # Asked about impact?
        if any(k in t for k in ['नींद', 'neend', 'sleep', 'daily', 'roz', 'affect',
                                  'प्रभावित', 'ঘুম', 'నిద్ర', 'தூக்க', 'झोप', 'ਨੀਂਦ',
                                  'ഉറക്ക', 'ನಿದ್ರ', 'ઊંઘ', 'kaam ko']):
            return 'asked_impact'
        # Asked about duration?
        if any(k in t for k in ['कितने', 'kitne', 'how long', 'since', 'कब से',
                                  'समय से', 'ఎంత కాలం', 'எவ்வளவு', 'किती',
                                  'কতদিন', 'ਕਿੰਨੇ', 'എത്ര', 'ಎಷ್ಟು', 'કેટલા']):
            return 'asked_duration'
    return 'fresh'


def _ask_model(bedrock, question):
    """Tiny YES/NO model call. Reliable for simple binary questions."""
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{'role': 'user', 'content': [{'text': f'{question}\nReply with ONLY: YES or NO'}]}],
        inferenceConfig={'maxTokens': 5, 'temperature': 0},
    )
    return 'YES' in resp['output']['message']['content'][0]['text'].upper()


def _get_doctor(bedrock, symptom_text):
    """Classify doctor type from symptom. Returns doctor name string."""
    DOCTORS = ['Neurologist', 'Cardiologist', 'Gastroenterologist', 'Orthopedic',
               'Dermatologist', 'Ophthalmologist', 'Pediatrician', 'Psychiatrist',
               'Gynecologist', 'General Physician']
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{'role': 'user', 'content': [{'text': (
            f'Symptom: "{symptom_text}". Which doctor type? '
            f'Reply with ONLY one: {" / ".join(DOCTORS)}'
        )}]}],
        inferenceConfig={'maxTokens': 10, 'temperature': 0},
    )
    text = resp['output']['message']['content'][0]['text'].strip()
    for d in DOCTORS:
        if d.lower() in text.lower():
            return d
    return 'General Physician'


def _extract_medicine(bedrock, text):
    """Extract medicine name from user message. Returns name or empty string."""
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{'role': 'user', 'content': [{'text': (
            f'Extract the medicine/tablet name from: "{text}". '
            f'Reply with ONLY the medicine name. If none, reply: NONE'
        )}]}],
        inferenceConfig={'maxTokens': 15, 'temperature': 0},
    )
    name = resp['output']['message']['content'][0]['text'].strip()
    return '' if name.upper() == 'NONE' else name


def google_tts(text: str, language: str, api_key: str) -> str | None:
    lang_code = GOOGLE_TTS_LANG_MAP.get(language, 'hi-IN')
    payload = json.dumps({
        'input': {'text': text},
        'voice': {'languageCode': lang_code, 'ssmlGender': 'FEMALE'},
        'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': 0.95},
    }).encode('utf-8')
    url = f'https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}'
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode('utf-8')).get('audioContent')
    except Exception as e:
        print(f"Google TTS failed: {e}")
        return None


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body', '{}'))
        text          = body.get('text', '')
        language_raw  = body.get('language', 'en')
        language      = language_raw.split('-')[0] if '-' in language_raw else language_raw
        user_id       = body.get('userId', 'demo-user-123')
        session_id    = body.get('sessionId', str(uuid.uuid4()))
        user_profile  = body.get('userProfile', {})

        if not text:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'text is required'})}

        lang_name    = LANG_MAP.get(language, 'English')
        patient_name = user_profile.get('name', '')
        name_prefix  = f"{patient_name}, " if patient_name else ""

        # Build profile + history context strings (used in agent path + DynamoDB)
        profile_parts = []
        if user_profile.get('name'):       profile_parts.append(f"Name: {user_profile['name']}")
        if user_profile.get('age'):        profile_parts.append(f"Age: {user_profile['age']} years")
        if user_profile.get('conditions'): profile_parts.append(f"Conditions: {', '.join(user_profile['conditions'])}")
        profile_context = ('Patient: ' + ', '.join(profile_parts) + '.') if profile_parts else ''
        history_context = ''
        if user_profile.get('history', '').strip():
            history_context = f" History: {user_profile['history'].strip()}"

        bedrock_region = BEDROCK_REGION
        agent_id       = os.environ.get('BEDROCK_AGENT_ID', '')
        agent_alias_id = os.environ.get('BEDROCK_AGENT_ALIAS_ID', 'TSTALIASID')

        import re as _re
        intent    = 'general'
        specialty = ''
        med_data  = None

        # ── BEDROCK AGENT PATH ────────────────────────────────────────────────
        if agent_id:
            agent_client = boto3.client('bedrock-agent-runtime', region_name=bedrock_region)
            agent_resp = agent_client.invoke_agent(
                agentId=agent_id, agentAliasId=agent_alias_id, sessionId=session_id,
                inputText=text,
                sessionState={'sessionAttributes': {
                    'patientName': patient_name, 'language': lang_name,
                    'profile': profile_context, 'history': history_context,
                }},
            )
            response_text = ''
            for agent_event in agent_resp['completion']:
                if 'chunk' in agent_event:
                    response_text += agent_event['chunk']['bytes'].decode('utf-8')
                elif 'trace' in agent_event:
                    orch = agent_event['trace'].get('trace', {}).get('orchestrationTrace', {})
                    inv  = orch.get('invocationInput', {}).get('actionGroupInvocationInput', {})
                    fn   = inv.get('function', '')
                    params = {p['name']: p['value'] for p in inv.get('parameters', [])}
                    if fn == 'bookAppointment':
                        intent = 'booking'; specialty = params.get('doctorType', '')
                    elif fn == 'findNearbyClinic':
                        intent = 'find_nearby'; specialty = params.get('specialty', '')
                    elif fn == 'setMedicineReminder':
                        intent = 'medication'
                        med_name = params.get('medicineName', '')
                        tmap = {'morning': 'Morning (8 AM)', 'afternoon': 'Afternoon (2 PM)', 'night': 'Night (9 PM)'}
                        if med_name:
                            med_data = {'name': med_name, 'time': tmap.get(params.get('timeSlot','').lower(), 'Morning (8 AM)')}
            if any(k in response_text.lower() for k in ['112', 'emergency', 'ambulance']) and intent == 'general':
                intent = 'emergency'

        # ── STATE MACHINE PATH (no agent) ─────────────────────────────────────
        else:
            bedrock = boto3.client('bedrock-runtime', region_name=bedrock_region)

            # Load DynamoDB history
            dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
            table    = dynamodb.Table(os.environ['DYNAMODB_CONVERSATIONS_TABLE'])
            history_messages = []
            try:
                hist = table.query(
                    KeyConditionExpression=Key('sessionId').eq(session_id),
                    ScanIndexForward=True, Limit=10,
                )
                for item in hist.get('Items', []):
                    role, item_text = item.get('role'), item.get('text', '')
                    if role in ('user', 'assistant') and item_text:
                        history_messages.append({'role': role, 'content': [{'text': item_text}]})
            except Exception as e:
                print(f"History query failed: {e}")

            # Deduplicate consecutive same-role messages
            filtered = []
            for msg in history_messages:
                if not filtered or msg['role'] != filtered[-1]['role']:
                    filtered.append(msg)
            if filtered and filtered[0]['role'] == 'assistant':
                filtered = filtered[1:]

            state = _conv_state(filtered)
            text_lower = text.lower()

            # ── Priority 1: Emergency check ───────────────────────────────────
            EMERGENCY_KEYWORDS = ['chest pain', 'seene mein dard', 'सीने में दर्द',
                                   'can\'t breathe', 'saans', 'unconscious', 'stroke',
                                   'bleeding', 'paralysis', 'heart attack', 'दिल']
            is_emergency = any(k in text_lower for k in EMERGENCY_KEYWORDS)
            if not is_emergency and len(text) > 5:
                is_emergency = _ask_model(bedrock,
                    f'Is this a life-threatening emergency (chest pain/stroke/can\'t breathe/unconscious/severe bleeding)? '
                    f'Patient says: "{text}"'
                )

            if is_emergency:
                response_text = f"{name_prefix}{_resp(language, 'emergency')}"
                intent = 'emergency'

            # ── Priority 2: Medicine reminder ─────────────────────────────────
            elif any(k in text_lower for k in ['remind', 'reminder', 'tablet', 'medicine', 'दवाई',
                                                'दवा', 'याद दिला', 'tablet', 'capsule', 'pill']):
                med_name = _extract_medicine(bedrock, text)
                time_slot = 'Morning (8 AM)'
                if any(k in text_lower for k in ['night', 'raat', 'रात', 'evening']):
                    time_slot = 'Night (9 PM)'
                elif any(k in text_lower for k in ['afternoon', 'dopahar', 'दोपहर', 'lunch']):
                    time_slot = 'Afternoon (2 PM)'
                if med_name:
                    med_data = {'name': med_name, 'time': time_slot}
                    response_text = f"{name_prefix}{_resp(language, 'reminder', med=med_name, time=time_slot)}"
                    intent = 'medication'
                else:
                    response_text = f"{name_prefix}{_resp(language, 'ask_duration')}"

            # ── Priority 3: Find nearby ───────────────────────────────────────
            elif any(k in text_lower for k in ['nearby', 'naazdiki', 'नजदीकी', 'पास में',
                                                'hospital', 'clinic', 'show map', 'dhundho',
                                                'ढूंढो', 'कहाँ है', 'dikhao']):
                response_text = f"{name_prefix}{_resp(language, 'nearby')}"
                intent = 'find_nearby'
                specialty = 'General Physician'

            # ── Priority 4: Book appointment ──────────────────────────────────
            elif any(k in text_lower for k in ['book', 'appointment', 'apointment', 'बुक',
                                                'doctor se milna', 'milna hai']):
                first_symptom = next(
                    (m['content'][0]['text'] for m in filtered if m['role'] == 'user'), text
                )
                doctor = _get_doctor(bedrock, first_symptom)
                response_text = f"{name_prefix}{_resp(language, 'book', doctor=doctor)}"
                intent = 'booking'
                specialty = doctor

            # ── Priority 5: State machine symptom flow ────────────────────────
            elif state == 'fresh':
                response_text = f"{name_prefix}{_resp(language, 'ask_duration')}"

            elif state == 'asked_duration':
                response_text = f"{name_prefix}{_resp(language, 'ask_impact')}"

            elif state == 'asked_impact':
                impact_yes = _ask_model(bedrock,
                    f'User is answering "does this affect your sleep/work?". '
                    f'Did they say YES (it does affect / serious / haan / ha)? '
                    f'User said: "{text}"'
                )
                if impact_yes:
                    first_symptom = next(
                        (m['content'][0]['text'] for m in filtered if m['role'] == 'user'), text
                    )
                    doctor = _get_doctor(bedrock, first_symptom)
                    response_text = f"{name_prefix}{_resp(language, 'book', doctor=doctor)}"
                    intent = 'booking'
                    specialty = doctor
                else:
                    response_text = f"{name_prefix}{_resp(language, 'nearby')}"
                    intent = 'find_nearby'
                    specialty = 'General Physician'

            else:
                # Already routed — treat new message as a fresh symptom
                response_text = f"{name_prefix}{_resp(language, 'ask_duration')}"

        # ── DynamoDB save ─────────────────────────────────────────────────────
        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table    = dynamodb.Table(os.environ['DYNAMODB_CONVERSATIONS_TABLE'])
        now      = datetime.utcnow().isoformat()
        table.put_item(Item={'sessionId': session_id, 'timestamp': now,
                             'userId': user_id, 'role': 'user', 'text': text, 'intent': intent})
        table.put_item(Item={'sessionId': session_id, 'timestamp': f"{now}_response",
                             'userId': user_id, 'role': 'assistant', 'text': response_text})

        # ── Google TTS ────────────────────────────────────────────────────────
        tts_text = response_text.replace('—', ',').replace('–', ',').replace('*', '')[:1000]
        audio_content = None
        google_api_key = os.environ.get('GOOGLE_TTS_API_KEY', '')
        if google_api_key:
            audio_content = google_tts(tts_text, language, google_api_key)

        # ── Build response ────────────────────────────────────────────────────
        response_body = {
            'responseText': response_text,
            'audioContent': audio_content,
            'intent':       intent,
            'sessionId':    session_id,
            'specialty':    specialty,
        }
        if intent == 'booking':
            response_body['bookingData'] = {
                'doctorName': specialty, 'preferredTime': '', 'patientPhone': user_profile.get('phone', ''),
            }
        if intent == 'find_nearby':
            response_body['findNearby'] = {'specialty': specialty}
        if intent == 'medication' and med_data:
            response_body['medData'] = med_data

        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(response_body)}

    except Exception as e:
        print(f"Error: {str(e)}")
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': str(e)})}
