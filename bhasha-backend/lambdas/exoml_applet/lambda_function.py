import json
import boto3
import os

# Exotel fetches this URL when the called party picks up.
# We read the record from DynamoDB and return ExoML XML that
# instructs Exotel to play a TTS message (appointment or emergency).


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {'Content-Type': 'text/xml'}, 'body': ''}

    try:
        path_params = event.get('pathParameters') or {}
        call_id     = path_params.get('callId', '')

        if not call_id:
            return _error_exoml('Call ID missing')

        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table    = dynamodb.Table(os.environ['DYNAMODB_CALL_STATUS_TABLE'])
        resp     = table.get_item(Key={'callId': call_id})
        item     = resp.get('Item')

        if not item:
            return _error_exoml('Record not found')

        call_type = item.get('callType', 'appointment')

        if call_type == 'emergency':
            message = _build_emergency_message(item)
            new_status = 'in_progress'
        else:
            message = _build_appointment_message(item)
            new_status = 'in_progress'

        # Sanitise: strip XML special chars from user-supplied content
        message = (message
                   .replace('&', 'and')
                   .replace('<', '')
                   .replace('>', ''))

        exoml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'  <Say voice="woman">{message}</Say>\n'
            '</Response>'
        )

        # Mark call as in_progress now that recipient picked up
        try:
            table.update_item(
                Key={'callId': call_id},
                UpdateExpression='SET #s = :status',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':status': new_status},
            )
        except Exception as db_err:
            print(f'DynamoDB update warning: {db_err}')

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'text/xml; charset=utf-8'},
            'body': exoml,
        }

    except Exception as e:
        print(f'ExoML error: {e}')
        return _error_exoml('Internal error')


def _build_emergency_message(item: dict) -> str:
    patient_name  = item.get('patientName',  'someone')
    patient_phone = item.get('patientPhone', '')
    location_raw  = item.get('location', '{}')
    try:
        location = json.loads(location_raw) if isinstance(location_raw, str) else location_raw
    except Exception:
        location = {}
    location_text = location.get('address', 'an unknown location') if isinstance(location, dict) else 'an unknown location'

    callback_part = (
        f' Please call them back immediately at {patient_phone}.'
        if patient_phone else ''
    )

    msg = (
        f'URGENT EMERGENCY ALERT. This is an automated message from Bhasha AI. '
        f'{patient_name} is in an emergency situation and needs immediate help. '
        f'Their location is {location_text}.'
        f'{callback_part} '
        f'Please respond immediately or call one one two. '
        f'This message will now repeat. '
        f'URGENT EMERGENCY ALERT. This is an automated message from Bhasha AI. '
        f'{patient_name} is in an emergency situation and needs immediate help. '
        f'Their location is {location_text}.'
        f'{callback_part} '
        f'Please respond immediately or call one one two.'
    )
    return msg


def _build_appointment_message(item: dict) -> str:
    patient_name   = item.get('patientName',   'a patient')
    doctor_name    = item.get('doctorName',    'the doctor')
    preferred_time = item.get('preferredTime', 'at their earliest convenience')
    patient_phone  = item.get('patientPhone',  '')
    symptoms       = item.get('symptoms',      '')

    symptoms_part = f' The patient is experiencing: {symptoms}.' if symptoms else ''
    callback_part = (
        f' Please call the patient back at {patient_phone} to confirm the appointment.'
        if patient_phone else
        ' Please call the patient back to confirm the appointment.'
    )

    msg = (
        f'Hello. This is Bhasha AI, an automated medical assistant. '
        f'I am calling on behalf of {patient_name} '
        f'to request an appointment with {doctor_name}. '
        f'The preferred appointment time is {preferred_time}.'
        f'{symptoms_part}'
        f'{callback_part} '
        f'This message will now repeat. '
        f'Hello. This is Bhasha AI, an automated medical assistant. '
        f'I am calling on behalf of {patient_name} '
        f'to request an appointment with {doctor_name}. '
        f'The preferred appointment time is {preferred_time}.'
        f'{symptoms_part}'
        f'{callback_part} '
        f'Thank you and have a good day.'
    )
    return msg


def _error_exoml(msg: str) -> dict:
    exoml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Response>\n'
        f'  <Say voice="woman">Sorry, {msg}. Goodbye.</Say>\n'
        '</Response>'
    )
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'text/xml; charset=utf-8'},
        'body': exoml,
    }
