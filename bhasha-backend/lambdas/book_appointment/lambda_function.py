import json
import boto3
import os
import uuid
import urllib.request
import urllib.parse
import base64
from datetime import datetime

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body', '{}'))
        user_id        = body.get('userId', 'demo-user')
        doctor_name    = body.get('doctorName', 'Doctor')
        clinic_phone   = body.get('clinicPhone', '')
        preferred_time = body.get('preferredTime', 'at their earliest convenience')
        patient_name   = body.get('patientName', 'Patient')
        patient_phone  = body.get('patientPhone', '')
        symptoms       = body.get('symptoms', '')

        if not clinic_phone:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'clinicPhone is required'}),
            }

        booking_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        # ── 1. Save to DynamoDB ────────────────────────────────────────────────
        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table = dynamodb.Table(os.environ['DYNAMODB_CALL_STATUS_TABLE'])

        table.put_item(Item={
            'callId':        booking_id,
            'userId':        user_id,
            'doctorName':    doctor_name,
            'clinicPhone':   clinic_phone,
            'preferredTime': preferred_time,
            'patientName':   patient_name,
            'patientPhone':  patient_phone,
            'symptoms':      symptoms,
            'status':        'initiating',
            'result':        None,
            'createdAt':     now,
        })

        # ── 2. Exotel outbound call ────────────────────────────────────────────
        api_base      = os.environ['API_BASE_URL'].rstrip('/')
        applet_url    = f'{api_base}/appointments/exoml/{booking_id}'
        callback_url  = f'{api_base}/appointments/callback?callId={booking_id}'

        exotel_resp = exotel_call(clinic_phone, applet_url, callback_url)
        exotel_sid  = exotel_resp.get('Call', {}).get('Sid', '')

        # ── 3. Update DynamoDB with Exotel SID ────────────────────────────────
        table.update_item(
            Key={'callId': booking_id},
            UpdateExpression='SET #s = :status, exotelSid = :sid',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':status': 'calling', ':sid': exotel_sid},
        )

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'callId':  booking_id,
                'status':  'calling',
                'message': f"AI agent is calling {doctor_name}'s clinic on your behalf",
            }),
        }

    except Exception as e:
        print(f'Error: {e}')
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)}),
        }


def exotel_call(to_phone: str, applet_url: str, callback_url: str) -> dict:
    """Make an outbound call via Exotel. Exotel dials `to_phone`, and when
    answered, runs the ExoML applet at `applet_url`."""
    account_sid = os.environ['EXOTEL_ACCOUNT_SID']
    api_key     = os.environ['EXOTEL_API_KEY']
    api_token   = os.environ['EXOTEL_API_TOKEN']
    exophone    = os.environ['EXOTEL_PHONE']  # e.g. 08039XXXXXX

    data = urllib.parse.urlencode({
        'From':           to_phone,     # clinic's number (Exotel dials this)
        'CallerId':       exophone,     # your ExoPhone shown as caller ID
        'Url':            applet_url,   # ExoML played when clinic picks up
        'StatusCallback': callback_url, # webhook called when call ends
        'TimeLimit':      90,           # max call duration seconds
        'TimeOut':        30,           # ring timeout seconds
    }).encode('utf-8')

    credentials = base64.b64encode(f'{api_key}:{api_token}'.encode()).decode()

    req = urllib.request.Request(
        f'https://api.exotel.com/v1/Accounts/{account_sid}/Calls/connect',
        data=data,
        headers={
            'Authorization': f'Basic {credentials}',
            'Content-Type':  'application/x-www-form-urlencoded',
        },
        method='POST',
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())
