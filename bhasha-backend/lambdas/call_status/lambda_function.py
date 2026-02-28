import json
import boto3
import os

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
        path_params = event.get('pathParameters') or {}
        call_id = path_params.get('callId') or path_params.get('id')

        if not call_id:
            # Try to extract from path directly
            path = event.get('path', '')
            parts = path.rstrip('/').split('/')
            call_id = parts[-1] if parts else None

        if not call_id:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'callId is required'})
            }

        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        call_table = dynamodb.Table(os.environ['DYNAMODB_CALL_STATUS_TABLE'])

        response = call_table.get_item(Key={'callId': call_id})
        item = response.get('Item')

        if not item:
            return {
                'statusCode': 404,
                'headers': CORS,
                'body': json.dumps({'error': 'Call not found'})
            }

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'callId': call_id,
                'status': item.get('status', 'unknown'),
                'result': item.get('result'),
                'transcript': item.get('transcript', []),
                'doctorName': item.get('doctorName', ''),
                'preferredTime': item.get('preferredTime', ''),
                'createdAt': item.get('createdAt', ''),
            })
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }
