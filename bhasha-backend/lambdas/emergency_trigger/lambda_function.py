import json
import boto3
import os
import uuid
import urllib.request
import urllib.parse
import urllib.error
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
        body          = json.loads(event.get('body', '{}'))
        user_id       = body.get('userId', 'demo-user-123')
        symptoms      = body.get('symptoms', 'Emergency SOS')
        location      = body.get('location', {})
        contacts      = body.get('contacts', [])          # passed from frontend
        patient_name  = body.get('patientName', 'User')
        patient_phone = body.get('patientPhone', '')

        emergency_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        dynamodb   = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        main_table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])
        call_status_table_name = os.environ.get('DYNAMODB_CALL_STATUS_TABLE', '')
        call_table = dynamodb.Table(call_status_table_name) if call_status_table_name else None

        # ── Save emergency record ─────────────────────────────────────────────
        # Store location as a JSON string — boto3 DynamoDB doesn't support floats
        main_table.put_item(Item={
            'userId':      user_id,
            'recordId':    f"emergency#{emergency_id}",
            'recordType':  'emergency',
            'emergencyId': emergency_id,
            'symptoms':    symptoms,
            'location':    json.dumps(location),
            'status':      'active',
            'createdAt':   now,
        })

        # ── Build location text for messages ──────────────────────────────────
        location_text = location.get('address', 'Unknown location') if isinstance(location, dict) else 'Unknown location'
        lat = location.get('lat', '') if isinstance(location, dict) else ''
        lng = location.get('lng', '') if isinstance(location, dict) else ''
        maps_url = f"https://maps.google.com/?q={lat},{lng}" if lat and lng else ''

        # ── Make Exotel call to each contact ──────────────────────────────────
        api_base        = os.environ.get('API_BASE_URL', '').rstrip('/')
        calls_initiated = []

        for contact in contacts:
            phone = contact.get('phone', '').strip()
            name  = contact.get('name', 'Emergency Contact')
            if not phone:
                continue

            call_id = str(uuid.uuid4())

            # Store call record so exoml_applet can read it (only if table configured)
            if call_table:
                try:
                    call_table.put_item(Item={
                        'callId':       call_id,
                        'callType':     'emergency',
                        'emergencyId':  emergency_id,
                        'userId':       user_id,
                        'patientName':  patient_name,
                        'patientPhone': patient_phone,
                        'contactName':  name,
                        'contactPhone': phone,
                        'symptoms':     symptoms,
                        'location':     json.dumps(location),
                        'status':       'initiating',
                        'createdAt':    now,
                    })
                except Exception as db_err:
                    print(f'DynamoDB write warning for {phone}: {db_err}')

            # Trigger Exotel outbound call (only if all Exotel env vars are set)
            if api_base and os.environ.get('EXOTEL_ACCOUNT_SID'):
                applet_url   = f'{api_base}/appointments/exoml/{call_id}'
                callback_url = f'{api_base}/appointments/callback?callId={call_id}'
                try:
                    exotel_call(phone, applet_url, callback_url)
                    calls_initiated.append({'name': name, 'phone': phone, 'callId': call_id})
                except Exception as ex_err:
                    print(f'Exotel call failed for {phone}: {ex_err}')
                    _send_sms_fallback(phone, patient_name, location_text, maps_url, symptoms)
                    calls_initiated.append({'name': name, 'phone': phone, 'callId': call_id, 'via': 'sms'})
            else:
                # Exotel not configured — fall back to SMS
                _send_sms_fallback(phone, patient_name, location_text, maps_url, symptoms)
                calls_initiated.append({'name': name, 'phone': phone, 'callId': call_id, 'via': 'sms'})

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'emergencyId':    emergency_id,
                'status':         'active',
                'callsInitiated': len(calls_initiated),
                'calls':          calls_initiated,
                'helplines': [
                    {'name': 'National Emergency', 'number': '112'},
                    {'name': 'Ambulance',           'number': '108'},
                    {'name': 'Police',              'number': '100'},
                ],
                'message': (
                    f"Emergency alert sent — calling {len(calls_initiated)} contact(s). "
                    f"Please also call 112 for immediate help."
                ),
            }),
        }

    except Exception as e:
        print(f'Error: {str(e)}')
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)}),
        }


def exotel_call(to_phone: str, applet_url: str, callback_url: str) -> dict:
    account_sid = os.environ['EXOTEL_ACCOUNT_SID']
    api_key     = os.environ['EXOTEL_API_KEY']
    api_token   = os.environ['EXOTEL_API_TOKEN']
    exophone    = os.environ['EXOTEL_PHONE']

    data = urllib.parse.urlencode({
        'From':           to_phone,
        'CallerId':       exophone,
        'Url':            applet_url,
        'StatusCallback': callback_url,
        'TimeLimit':      90,
        'TimeOut':        30,
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

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode()
            print(f'Exotel response: {body}')
            return json.loads(body)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f'Exotel HTTP {e.code} error: {error_body}')
        raise Exception(f'Exotel {e.code}: {error_body}')


def _send_sms_fallback(phone: str, patient_name: str, location_text: str, maps_url: str, symptoms: str):
    """SNS SMS fallback when Exotel call fails."""
    try:
        msg = (
            f"EMERGENCY ALERT — Bhasha AI\n"
            f"{patient_name} needs immediate help!\n"
            f"Location: {location_text}\n"
            f"{f'Maps: {maps_url}' if maps_url else ''}\n"
            f"Please respond or call 112."
        )
        sns = boto3.client('sns', region_name=os.environ['AWS_REGION_NAME'])
        sns.publish(
            PhoneNumber=phone,
            Message=msg,
            MessageAttributes={
                'AWS.SNS.SMS.SMSType': {
                    'DataType': 'String',
                    'StringValue': 'Transactional',
                }
            },
        )
    except Exception as sms_err:
        print(f'SMS fallback also failed for {phone}: {sms_err}')
