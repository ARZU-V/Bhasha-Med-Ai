import json
import boto3
import os
import urllib.parse

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

# Exotel terminal status → our (status, result) pair
STATUS_MAP = {
    'completed':  ('confirmed', 'confirmed'),   # clinic picked up, message played
    'busy':       ('failed',    'failed'),       # clinic line busy
    'failed':     ('failed',    'failed'),       # call failed
    'no-answer':  ('failed',    'failed'),       # clinic didn't pick up
    'canceled':   ('failed',    'failed'),
}


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        # callId is embedded as a query param in the callback URL we passed to Exotel
        query  = event.get('queryStringParameters') or {}
        call_id = query.get('callId', '')

        # Exotel sends form-encoded body: Status, CallSid, Duration, etc.
        body_raw     = event.get('body', '') or ''
        body         = urllib.parse.parse_qs(body_raw)
        exotel_status = body.get('Status', [''])[0].lower()
        exotel_sid    = body.get('CallSid', [''])[0]
        duration      = body.get('Duration', ['0'])[0]

        print(f'Exotel callback: callId={call_id} status={exotel_status} sid={exotel_sid} duration={duration}s')

        if not call_id:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'callId missing'})}

        our_status, our_result = STATUS_MAP.get(exotel_status, ('failed', 'failed'))

        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table    = dynamodb.Table(os.environ['DYNAMODB_CALL_STATUS_TABLE'])

        table.update_item(
            Key={'callId': call_id},
            UpdateExpression='SET #s = :status, #r = :result, exotelStatus = :es, callDuration = :dur',
            ExpressionAttributeNames={'#s': 'status', '#r': 'result'},
            ExpressionAttributeValues={
                ':status': our_status,
                ':result': our_result,
                ':es':     exotel_status,
                ':dur':    int(duration) if duration.isdigit() else 0,
            },
        )

        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    except Exception as e:
        print(f'Callback error: {e}')
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': str(e)})}
