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

VISION_SYSTEM_PROMPT = """You are a medical prescription reader and pharmacology assistant. Analyze the provided image of a prescription or medicine strip/blister pack.

For EACH medicine found, extract its name from the image AND provide full medicine information.

Respond ONLY with valid JSON in this exact structure:

{
  "medicines": [
    {
      "name": "Medicine name as written on image",
      "dosage": "e.g. 500mg — from image or commonly known",
      "frequency": "e.g. twice daily — from image if visible",
      "instructions": "e.g. after meals — from image if visible",
      "what_it_is": "1-2 sentence description of what this medicine is and its drug class",
      "uses": "Common uses separated by bullet •",
      "side_effects": "Common side effects separated by bullet •",
      "interactions": "Important drug interactions to watch for",
      "safe_note": "Any safety note relevant to common conditions like diabetes, BP, heart disease"
    }
  ],
  "confidence": "high|medium|low based on image clarity",
  "disclaimer": "Always consult your doctor or pharmacist before taking any medicine."
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

    try:
        bedrock = boto3.client('bedrock-runtime', region_name=bedrock_region)

        # Nova Converse API expects raw bytes for images, not base64 string
        image_bytes = base64.b64decode(image_b64)

        # Map MIME type to Nova accepted format
        format_map = {
            'image/jpeg': 'jpeg',
            'image/jpg':  'jpeg',
            'image/png':  'png',
            'image/gif':  'gif',
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
                'maxTokens': 2500,
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

    except Exception as bedrock_err:
        print(f"Bedrock scan error (non-fatal): {bedrock_err}")
        scan_result = {
            'medicines': [],
            'raw_text': '',
            'confidence': 'low',
            'notes': f'AI scan unavailable: {str(bedrock_err)[:200]}. Please type the medicine name manually.',
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
