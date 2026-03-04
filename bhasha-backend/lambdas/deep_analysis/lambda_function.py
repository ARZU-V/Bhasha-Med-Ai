"""
deep_analysis/lambda_function.py

Full deep-analysis pipeline:
  1. Amazon Comprehend Medical  → extract symptoms / ICD-10 codes
  2. Amazon Bedrock KB          → RAG over medical textbooks (optional)
  3. Amazon Nova Pro (Bedrock)  → structured clinical JSON
  4. Amazon DynamoDB            → save health log per user
  5. Amazon SNS                 → SMS summary to user's phone

POST /deep-analysis
Body: {
  question:       str,
  language:       str  (hi/en/te/ta/mr/bn/gu/kn/ml/pa),
  userConditions: str[],
  userId:         str,
  phone:          str  (optional, +91XXXXXXXXXX),
  image:          str  (optional, base64 — Nova Lite vision)
}

Env vars:
  KNOWLEDGE_BASE_ID     — Bedrock KB ID (optional; enables RAG mode)
  DYNAMODB_MAIN_TABLE   — defaults to BhashaAiMain
  BEDROCK_REGION        — defaults to us-east-1
"""

import json
import boto3
import os
import base64
from datetime import datetime, timezone

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

APP_REGION     = os.environ.get('APP_REGION', 'ap-south-1')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'us-east-1')

SYNTHESIS_MODEL = 'us.amazon.nova-pro-v1:0'       # Amazon Nova Pro — structured reasoning
VISION_MODEL    = 'us.amazon.nova-lite-v1:0'      # Nova Lite — image analysis
KB_MODEL_ARN    = (
    'arn:aws:bedrock:us-east-1::foundation-model/'
    'amazon.nova-pro-v1:0'
)

LANG_MAP = {
    'hi': 'Hindi',   'te': 'Telugu',  'ta': 'Tamil',    'en': 'English',
    'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
    'kn': 'Kannada', 'ml': 'Malayalam','pa': 'Punjabi',
}


# ── AWS clients ────────────────────────────────────────────────────────────────

def _clients():
    bedrock       = boto3.client('bedrock-runtime',       region_name=BEDROCK_REGION)
    bedrock_agent = boto3.client('bedrock-agent-runtime', region_name=BEDROCK_REGION)
    comprehend    = boto3.client('comprehendmedical',     region_name=BEDROCK_REGION)
    dynamo        = boto3.resource('dynamodb',            region_name=APP_REGION)
    sns           = boto3.client('sns',                   region_name=APP_REGION)
    return bedrock, bedrock_agent, comprehend, dynamo, sns


# ── Step 1: Comprehend Medical ─────────────────────────────────────────────────

def extract_medical_entities(comprehend, text: str) -> dict:
    try:
        result   = comprehend.detect_entities_v2(Text=text[:20000])
        entities = result.get('Entities', [])

        symptoms, conditions, medications, body_parts, durations = [], [], [], [], []

        for e in entities:
            if e.get('Score', 0) < 0.6:
                continue
            cat = e.get('Category', '')
            val = e.get('Text', '')
            if cat == 'SIGN_OR_SYMPTOM':    symptoms.append(val)
            elif cat == 'MEDICAL_CONDITION': conditions.append(val)
            elif cat == 'MEDICATION':        medications.append(val)
            elif cat == 'ANATOMY':           body_parts.append(val)
            elif cat == 'TIME_EXPRESSION':   durations.append(val)

        icd_map = {}
        if conditions:
            try:
                icd_resp = comprehend.infer_icd10_cm(Text=text[:10000])
                for entity in icd_resp.get('Entities', []):
                    if entity.get('Score', 0) > 0.7 and entity.get('ICD10CMConcepts'):
                        icd_map[entity['Text']] = {
                            'code': entity['ICD10CMConcepts'][0]['Code'],
                            'description': entity['ICD10CMConcepts'][0]['Description'],
                        }
            except Exception:
                pass

        return {
            'symptoms':    list(dict.fromkeys(symptoms)),
            'conditions':  list(dict.fromkeys(conditions)),
            'medications': list(dict.fromkeys(medications)),
            'body_parts':  list(dict.fromkeys(body_parts)),
            'durations':   list(dict.fromkeys(durations)),
            'icd_map':     icd_map,
        }
    except Exception as e:
        print(f'[comprehend_medical] error: {e}')
        return {'symptoms': [], 'conditions': [], 'medications': [],
                'body_parts': [], 'durations': [], 'icd_map': {}}


# ── Step 2: Bedrock Knowledge Base (RAG) ──────────────────────────────────────

def query_knowledge_base(bedrock_agent, kb_id: str, question: str,
                          entities: dict, lang_name: str,
                          user_conditions: list) -> dict:
    enriched = question
    if entities['symptoms']:
        enriched += '. Symptoms: ' + ', '.join(entities['symptoms'])
    if entities['body_parts']:
        enriched += '. Affected areas: ' + ', '.join(entities['body_parts'])
    if user_conditions:
        enriched += '. Patient history: ' + ', '.join(user_conditions)

    conditions_ctx = (
        f'Patient has: {", ".join(user_conditions)}. ' if user_conditions else ''
    )

    prompt_template = (
        f'You are a clinical assistant. Always reply in {lang_name}. {conditions_ctx}'
        'Use ONLY the retrieved medical documents. Cite sources. '
        "End with: '⚠️ Always consult a qualified doctor.'\n\n"
        'Retrieved context:\n$search_results$\n\nPatient: $query$'
    )

    try:
        resp = bedrock_agent.retrieve_and_generate(
            input={'text': enriched},
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': kb_id,
                    'modelArn': KB_MODEL_ARN,
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {'numberOfResults': 6},
                    },
                    'generationConfiguration': {
                        'promptTemplate': {'textPromptTemplate': prompt_template},
                        'inferenceConfig': {
                            'textInferenceConfig': {'maxTokens': 1500, 'temperature': 0.2}
                        },
                    },
                },
            },
        )

        sources = []
        for citation in resp.get('citations', []):
            for ref in citation.get('retrievedReferences', []):
                uri = ref.get('location', {}).get('s3Location', {}).get('uri', '')
                if uri:
                    fname = uri.split('/')[-1].replace('.txt', '').replace('_', ' ')
                    if fname not in sources:
                        sources.append(fname)

        return {'text': resp['output']['text'], 'sources': sources}
    except Exception as e:
        print(f'[kb_query] error: {e}')
        return {'text': '', 'sources': []}


# ── Step 3: Claude 3.5 Sonnet structured synthesis ────────────────────────────

def synthesize_analysis(bedrock, question: str, entities: dict,
                         kb_text: str, lang_name: str, user_conditions: list) -> dict:
    entity_ctx = ''
    if entities['symptoms']:
        entity_ctx += f"\nDetected symptoms: {', '.join(entities['symptoms'])}"
    if entities['body_parts']:
        entity_ctx += f"\nAffected areas: {', '.join(entities['body_parts'])}"
    if entities['durations']:
        entity_ctx += f"\nDuration: {', '.join(entities['durations'])}"
    if entities['medications']:
        entity_ctx += f"\nCurrent medications: {', '.join(entities['medications'])}"
    if user_conditions:
        entity_ctx += f"\nKnown conditions: {', '.join(user_conditions)}"

    kb_section = f'\n\nMedical reference:\n{kb_text[:2500]}' if kb_text else ''

    system_prompt = f"""You are a senior clinical decision support system. Reply in {lang_name}.

Produce ONLY valid JSON. No markdown, no explanation, just the JSON object.

Required structure:
{{
  "summary": "One clear sentence summarising the clinical picture",
  "possible_conditions": [
    {{"name": "Condition", "likelihood": "high|moderate|low", "brief": "One sentence why"}}
  ],
  "urgency": "emergency|urgent|routine",
  "urgency_reason": "Brief reason",
  "doctor_roadmap": {{
    "see_first": "Doctor type",
    "timeframe": "e.g. Within 24 hours",
    "if_referred": "Specialist if needed"
  }},
  "action_steps": ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"],
  "tests_to_ask": ["Test name"],
  "red_flags": ["Call 112 if you notice this"],
  "self_care": ["Safe home care step"],
  "questions_for_doctor": ["Question to ask"]
}}

Rules:
- possible_conditions: 2-4 entries ordered by likelihood
- urgency=emergency: life-threatening right now
- urgency=urgent: doctor within 24-48h
- urgency=routine: can wait a few days
- Output ONLY the JSON object"""

    user_msg = f'Patient says: "{question}"{entity_ctx}{kb_section}'

    raw = ''
    try:
        resp = bedrock.converse(
            modelId=SYNTHESIS_MODEL,
            system=[{'text': system_prompt}],
            messages=[{'role': 'user', 'content': [{'text': user_msg}]}],
            inferenceConfig={'maxTokens': 1800, 'temperature': 0.2},
        )
        raw = resp['output']['message']['content'][0]['text'].strip()

        # Strip markdown fences if present
        if '```json' in raw:
            raw = raw.split('```json')[1].split('```')[0].strip()
        elif '```' in raw:
            raw = raw.split('```')[1].split('```')[0].strip()

        # Extract first complete JSON object
        if raw and raw[0] == '{':
            depth = 0
            for i, ch in enumerate(raw):
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        raw = raw[:i+1]
                        break

        return json.loads(raw)

    except Exception as e:
        print(f'[nova_synthesis] error: {e} | raw: {raw[:300]}')
        return {
            'summary': question[:200],
            'possible_conditions': [],
            'urgency': 'routine',
            'urgency_reason': 'Could not analyse — please consult a doctor.',
            'doctor_roadmap': {
                'see_first': 'General Physician',
                'timeframe': 'At your convenience',
                'if_referred': '',
            },
            'action_steps': ['Please consult a General Physician for proper evaluation.'],
            'tests_to_ask': [],
            'red_flags': [],
            'self_care': [],
            'questions_for_doctor': [],
        }


# ── Step 4: Image analysis (Nova Lite vision) ─────────────────────────────────

def analyze_image(bedrock, image_b64: str, question: str, lang_name: str) -> str:
    fmt = 'jpeg'
    if image_b64.startswith('data:'):
        header, image_b64 = image_b64.split(',', 1)
        if 'png' in header:    fmt = 'png'
        elif 'webp' in header: fmt = 'webp'

    prompt = (
        f'Analyze this medical image. Reply in {lang_name}. '
        'If skin condition: describe, possible conditions, severity, first aid. '
        'If lab report: list tests, flag HIGH/LOW, plain-language meaning. '
        'If X-ray/scan: describe in lay terms, note unusual findings. '
        'If medicine strip/prescription: extract names, dosages, timings, purpose. '
        "End with: '⚠️ AI analysis only. Consult a doctor.' "
        f"User question: {question or 'Please analyse this image.'}"
    )

    resp = bedrock.converse(
        modelId=VISION_MODEL,
        messages=[{
            'role': 'user',
            'content': [
                {'image': {'format': fmt, 'source': {'bytes': base64.b64decode(image_b64)}}},
                {'text': prompt},
            ],
        }],
        inferenceConfig={'maxTokens': 1200, 'temperature': 0.3},
    )
    return resp['output']['message']['content'][0]['text']


# ── Step 5: DynamoDB health log ────────────────────────────────────────────────

def save_health_log(dynamo, user_id: str, question: str,
                     entities: dict, structured: dict, lang: str):
    try:
        table_name = os.environ.get('DYNAMODB_MAIN_TABLE', 'BhashaAiMain')
        table = dynamo.Table(table_name)
        ts    = datetime.now(timezone.utc).isoformat()
        table.put_item(Item={
            'userId':      user_id,
            'recordType':  f'health_log#{ts}',
            'timestamp':   ts,
            'language':    lang,
            'question':    question[:500],
            'symptoms':    entities.get('symptoms', []),
            'conditions':  entities.get('conditions', []),
            'medications': entities.get('medications', []),
            'urgency':     structured.get('urgency', 'routine'),
            'summary':     structured.get('summary', ''),
            'doctor':      structured.get('doctor_roadmap', {}).get('see_first', ''),
            'icd_map':     json.dumps(entities.get('icd_map', {})),
            'model':       'nova-pro',
        })
    except Exception as e:
        print(f'[dynamo_save] error (non-fatal): {e}')


# ── Step 6: SNS SMS ───────────────────────────────────────────────────────────

def send_sms(sns_client, phone: str, structured: dict, entities: dict):
    urgency   = structured.get('urgency', 'routine').upper()
    doctor    = structured.get('doctor_roadmap', {}).get('see_first', 'GP')
    timeframe = structured.get('doctor_roadmap', {}).get('timeframe', '')
    symptoms  = ', '.join(entities.get('symptoms', [])[:4]) or 'Not detected'
    steps     = structured.get('action_steps', [])
    step_text = '\n'.join(f'{i+1}. {s}' for i, s in enumerate(steps[:3]))

    sms = (
        f'Bhasha AI Health Summary\n'
        f'Urgency: {urgency}\n'
        f'Symptoms: {symptoms}\n'
        f'See: {doctor} — {timeframe}\n'
        f'Steps:\n{step_text}\n'
        f'⚠️ Not a diagnosis. Consult a doctor.'
    )[:1400]

    try:
        if not phone.startswith('+'):
            phone = '+91' + phone.lstrip('0')
        sns_client.publish(
            PhoneNumber=phone,
            Message=sms,
            MessageAttributes={
                'AWS.SNS.SMS.SMSType': {
                    'DataType': 'String', 'StringValue': 'Transactional',
                },
            },
        )
        return True
    except Exception as e:
        print(f'[sns_sms] error (non-fatal): {e}')
        return False


# ── Lambda handler ─────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body', '{}'))
    except json.JSONDecodeError:
        return {'statusCode': 400, 'headers': CORS,
                'body': json.dumps({'error': 'Invalid JSON body'})}

    question        = (body.get('question') or '').strip()
    lang_code       = body.get('language', 'en')
    image_b64       = body.get('image')
    user_conditions = body.get('userConditions') or []
    user_id         = body.get('userId', 'anonymous')
    phone           = (body.get('phone') or '').strip()

    if not question and not image_b64:
        return {'statusCode': 400, 'headers': CORS,
                'body': json.dumps({'error': 'Provide at least a question or an image'})}

    lang_name = LANG_MAP.get(lang_code, 'English')
    kb_id     = os.environ.get('KNOWLEDGE_BASE_ID', '').strip()

    bedrock, bedrock_agent, comprehend, dynamo, sns_client = _clients()

    result = {
        'language':          lang_name,
        'model':             'nova-pro',
        'answer':            None,
        'structured':        None,
        'symptoms_detected': [],
        'sources':           [],
        'imageAnalysis':     None,
        'mode':              None,
        'sms_sent':          False,
    }

    # ── Image branch ────────────────────────────────────────────────────────
    if image_b64:
        try:
            result['imageAnalysis'] = analyze_image(bedrock, image_b64, question, lang_name)
            if not question:
                result['answer'] = result['imageAnalysis']
                result['mode']   = 'vision'
        except Exception as e:
            print(f'[vision] error: {e}')

    # ── Text branch ─────────────────────────────────────────────────────────
    if question:
        # Step 1: Comprehend Medical
        entities = extract_medical_entities(comprehend, question)
        result['symptoms_detected'] = entities['symptoms']
        result['entities'] = {k: v for k, v in entities.items() if k != 'icd_map'}

        # Step 2: RAG (if KB configured)
        kb_text = ''
        if kb_id:
            kb_result         = query_knowledge_base(
                bedrock_agent, kb_id, question, entities, lang_name, user_conditions
            )
            kb_text           = kb_result['text']
            result['sources'] = kb_result['sources']
            result['mode']    = 'rag+claude'
        else:
            result['mode'] = 'claude-direct'

        # Step 3: Claude structured synthesis
        structured       = synthesize_analysis(
            bedrock, question, entities, kb_text, lang_name, user_conditions
        )
        result['structured'] = structured
        result['answer']     = kb_text or structured.get('summary', '')

        # Step 4: Save to DynamoDB
        save_health_log(dynamo, user_id, question, entities, structured, lang_name)

        # Step 5: SMS
        if phone:
            result['sms_sent'] = send_sms(sns_client, phone, structured, entities)

    if not result['answer'] and not result['imageAnalysis']:
        return {'statusCode': 500, 'headers': CORS,
                'body': json.dumps({'error': 'Analysis unavailable'})}

    return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(result)}
