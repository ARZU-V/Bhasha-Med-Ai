import json
import boto3
import os

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

MODEL_ID = 'us.amazon.nova-micro-v1:0'

SYSTEM_PROMPT = """You are a clinical pharmacology assistant. When given a medicine name and a user's medical conditions, provide a structured JSON response.

IMPORTANT: Alwayas include a clear disclaimer that users must consult a doctor before taking or stopping any medicine.

Respond ONLY with valid JSON in this exact structure:
{
  "what_it_is": "Brief 1-2 sentence description of the medicine and its drug class",
  "uses": ["use 1", "use 2", "use 3"],
  "side_effects": ["common side effect 1", "common side effect 2", "common side effect 3"],
  "interactions": ["interaction warning 1", "interaction warning 2"],
  "safe_for_conditions": {
    "overall": "safe|caution|avoid|unknown",
    "notes": "Specific note about the user's conditions if relevant, otherwise null"
  },
  "dosage_note": "General dosage information (not a prescription)",
  "disclaimer": "Always consult your doctor or pharmacist before taking this medicine. This is not medical advice."
}"""


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'POST')

    try:
        if method == 'GET':
            query_params = event.get('queryStringParameters') or {}
            medicine_name = query_params.get('name', '').strip()
            user_conditions = query_params.get('conditions', '').split(',') if query_params.get('conditions') else []
        elif method == 'POST':
            body = json.loads(event.get('body', '{}'))
            medicine_name = body.get('medicineName', '').strip()
            user_conditions = body.get('userConditions', [])
        else:
            return {
                'statusCode': 405,
                'headers': CORS,
                'body': json.dumps({'error': 'Method not allowed'})
            }

        if not medicine_name:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'medicineName is required'})
            }

        return check_medicine(medicine_name, user_conditions)

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def check_medicine(medicine_name: str, user_conditions: list):
    bedrock_region = os.environ.get('BEDROCK_REGION', 'us-east-1')
    bedrock = boto3.client('bedrock-runtime', region_name=bedrock_region)

    conditions_text = ', '.join(user_conditions) if user_conditions else 'None specified'

    user_message = f"""Medicine: {medicine_name}
User's known medical conditions: {conditions_text}

Please provide the medicine information in the JSON format specified."""

    response = bedrock.converse(
        modelId=MODEL_ID,
        system=[{'text': SYSTEM_PROMPT}],
        messages=[
            {'role': 'user', 'content': [{'text': user_message}]}
        ],
        inferenceConfig={
            'maxTokens': 1000,
            'temperature': 0.3,
        }
    )

    raw_text = response['output']['message']['content'][0]['text'].strip()

    # Parse JSON from response (handle markdown code blocks if present)
    if '```json' in raw_text:
        raw_text = raw_text.split('```json')[1].split('```')[0].strip()
    elif '```' in raw_text:
        raw_text = raw_text.split('```')[1].split('```')[0].strip()

    try:
        medicine_info = json.loads(raw_text)
    except json.JSONDecodeError:
        medicine_info = {
            'what_it_is': raw_text[:200],
            'uses': [],
            'side_effects': [],
            'interactions': [],
            'safe_for_conditions': {'overall': 'unknown', 'notes': None},
            'dosage_note': 'Please consult a pharmacist.',
            'disclaimer': 'Always consult your doctor or pharmacist before taking this medicine. This is not medical advice.'
        }

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({
            'medicine': medicine_name,
            'info': medicine_info,
            'userConditions': user_conditions,
        })
    }
