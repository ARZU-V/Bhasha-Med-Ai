import json
import boto3
import os
import base64

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

# Nova Lite supports vision (images); Nova Micro is text-only
MODEL_ID = 'us.amazon.nova-lite-v1:0'

VISION_SYSTEM_PROMPT = """You are a medical prescription reader assistant. Analyze the provided image of a prescription or medicine strip/blister pack.

Extract ALL medicine information visible in the image. Respond ONLY with valid JSON in this exact structure:

{
  "medicines": [
    {
      "name": "Medicine name as written",
      "generic_name": "Generic/chemical name if visible or known",
      "dosage": "e.g. 500mg, 10mg/5ml",
      "frequency": "e.g. twice daily, as needed",
      "duration": "e.g. 7 days, ongoing",
      "instructions": "e.g. after meals, with water"
    }
  ],
  "raw_text": "All readable text extracted from image",
  "doctor_name": "Doctor name if visible, else null",
  "patient_name": "Patient name if visible, else null",
  "date": "Prescription date if visible, else null",
  "confidence": "high|medium|low based on image clarity",
  "notes": "Any important warnings or notes from the prescription"
}

If the image is not a prescription or medicine, return: {"error": "Not a prescription or medicine image", "medicines": []}"""


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    if event.get('httpMethod') != 'POST':
        return {
            'statusCode': 405,
            'headers': CORS,
            'body': json.dumps({'error': 'Method not allowed'})
        }

    try:
        body = json.loads(event.get('body', '{}'))
        image_b64 = body.get('image')
        image_type = body.get('imageType', 'image/jpeg')
        user_conditions = body.get('userConditions', [])

        if not image_b64:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'image field required (base64 encoded)'})
            }

        return scan_prescription(image_b64, image_type, user_conditions)

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def scan_prescription(image_b64: str, image_type: str, user_conditions: list):
    bedrock_region = os.environ.get('BEDROCK_REGION', 'us-east-1')
    bedrock = boto3.client('bedrock-runtime', region_name=bedrock_region)

    # Nova Converse API expects raw bytes for images, not base64 string
    image_bytes = base64.b64decode(image_b64)

    # Map MIME type to Nova accepted format
    format_map = {
        'image/jpeg': 'jpeg',
        'image/jpg': 'jpeg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
    }
    img_format = format_map.get(image_type.lower(), 'jpeg')

    conditions_note = (
        f"\n\nUser's medical conditions: {', '.join(user_conditions)}"
        if user_conditions else ''
    )

    response = bedrock.converse(
        modelId=MODEL_ID,
        system=[{'text': VISION_SYSTEM_PROMPT}],
        messages=[
            {
                'role': 'user',
                'content': [
                    {
                        'image': {
                            'format': img_format,
                            'source': {'bytes': image_bytes}
                        }
                    },
                    {
                        'text': f'Please extract all medicine information from this prescription/medicine image.{conditions_note}'
                    }
                ]
            }
        ],
        inferenceConfig={
            'maxTokens': 1500,
            'temperature': 0.2,
        }
    )

    raw_text = response['output']['message']['content'][0]['text'].strip()

    # Parse JSON from response
    if '```json' in raw_text:
        raw_text = raw_text.split('```json')[1].split('```')[0].strip()
    elif '```' in raw_text:
        raw_text = raw_text.split('```')[1].split('```')[0].strip()

    try:
        scan_result = json.loads(raw_text)
    except json.JSONDecodeError:
        scan_result = {
            'medicines': [],
            'raw_text': raw_text,
            'confidence': 'low',
            'notes': 'Could not parse structured data from image'
        }

    medicines = scan_result.get('medicines', [])
    if medicines and user_conditions:
        scan_result['conditionWarning'] = (
            f"You have {', '.join(user_conditions)}. Please confirm with your doctor "
            f"that all these medicines are safe for your conditions."
        )

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({
            'scan': scan_result,
            'medicineCount': len(medicines),
            'userConditions': user_conditions,
            'disclaimer': 'This scan is for reference only. Always verify with your doctor or pharmacist.'
        })
    }
