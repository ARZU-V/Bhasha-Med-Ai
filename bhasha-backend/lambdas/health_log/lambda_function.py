import json
import boto3
import os
import uuid
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

    method = event.get('httpMethod', 'GET')

    try:
        if method == 'GET':
            query_params = event.get('queryStringParameters') or {}
            user_id = query_params.get('userId', 'demo-user-123')
            limit = int(query_params.get('limit', 50))
            return get_health_logs(user_id, limit)

        elif method == 'POST':
            body = json.loads(event.get('body', '{}'))
            return create_health_log(body)

        else:
            return {
                'statusCode': 405,
                'headers': CORS,
                'body': json.dumps({'error': 'Method not allowed'})
            }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def get_health_logs(user_id: str, limit: int = 50):
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

    from boto3.dynamodb.conditions import Attr
    response = table.scan(
        FilterExpression=Attr('userId').eq(user_id) & Attr('recordType').eq('health_log'),
        Limit=limit
    )

    logs = response.get('Items', [])

    # Sort by timestamp descending (newest first)
    logs.sort(key=lambda x: x.get('timestamp', ''), reverse=True)

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'logs': logs, 'count': len(logs)})
    }


def create_health_log(body: dict):
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

    log_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    user_id = body.get('userId', 'demo-user-123')

    severity = body.get('severity', 5)
    # Clamp severity between 1 and 10
    severity = max(1, min(10, int(severity)))

    item = {
        'userId': user_id,
        'recordId': f"log#{log_id}",
        'recordType': 'health_log',
        'logId': log_id,
        'type': body.get('type', 'symptom'),
        'description': body.get('description', ''),
        'severity': severity,
        'timestamp': now,
        'notes': body.get('notes', ''),
        'sessionId': body.get('sessionId', ''),
    }

    # Auto-flag high severity logs
    if severity >= 8:
        item['flagged'] = True
        item['flagReason'] = 'High severity symptom logged'

    table.put_item(Item=item)

    return {
        'statusCode': 201,
        'headers': CORS,
        'body': json.dumps({
            'message': 'Health log created',
            'logId': log_id,
            'log': item
        })
    }
