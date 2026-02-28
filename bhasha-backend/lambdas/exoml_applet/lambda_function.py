import json
import boto3
import os

# Exotel fetches this URL when the clinic picks up the call.
# We read the booking details from DynamoDB and return ExoML XML
# that instructs Exotel to play a TTS message to the receptionist.


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {'Content-Type': 'text/xml'}, 'body': ''}

    try:
        path_params = event.get('pathParameters') or {}
        call_id = path_params.get('callId', '')

        if not call_id:
            return _error_exoml('Booking ID missing')

        # Read booking from DynamoDB
        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table    = dynamodb.Table(os.environ['DYNAMODB_CALL_STATUS_TABLE'])
        resp     = table.get_item(Key={'callId': call_id})
        item     = resp.get('Item')

        if not item:
            return _error_exoml('Booking not found')

        patient_name   = item.get('patientName', 'a patient')
        doctor_name    = item.get('doctorName', 'the doctor')
        preferred_time = item.get('preferredTime', 'at their earliest convenience')
        patient_phone  = item.get('patientPhone', '')
        symptoms       = item.get('symptoms', '')

        # Build spoken message
        symptoms_part  = f' The patient is experiencing: {symptoms}.' if symptoms else ''
        callback_part  = (
            f' Please call the patient back at {patient_phone} to confirm the appointment.'
            if patient_phone else
            ' Please call the patient back to confirm the appointment.'
        )

        message = (
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

        # Sanitise: XML-escape angle brackets and ampersands in user content
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

        # Mark call as in_progress now that clinic picked up
        try:
            table.update_item(
                Key={'callId': call_id},
                UpdateExpression='SET #s = :status',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':status': 'in_progress'},
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
