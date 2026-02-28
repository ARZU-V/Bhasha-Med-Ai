import json
import boto3
import os
import uuid
from datetime import datetime, date

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}


def get_dynamodb_table():
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    return dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path = event.get('path', '')
    path_params = event.get('pathParameters') or {}

    try:
        # GET /medications?userId=xxx  → list all medications for user
        if method == 'GET' and '/medications' in path:
            query_params = event.get('queryStringParameters') or {}
            user_id = query_params.get('userId', 'demo-user-123')
            return list_medications(user_id)

        # POST /medications → create new medication
        elif method == 'POST' and path.endswith('/medications'):
            body = json.loads(event.get('body', '{}'))
            return create_medication(body)

        # PUT /medications/{id}/taken → mark medication as taken
        elif method == 'PUT' and '/taken' in path:
            med_id = path_params.get('id') or path.split('/')[-2]
            body = json.loads(event.get('body', '{}'))
            return mark_taken(med_id, body)

        # DELETE /medications/{id} → delete medication
        elif method == 'DELETE':
            med_id = path_params.get('id')
            body = json.loads(event.get('body', '{}'))
            user_id = body.get('userId', 'demo-user-123')
            return delete_medication(med_id, user_id)

        else:
            return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def list_medications(user_id: str):
    table = get_dynamodb_table()
    from boto3.dynamodb.conditions import Key, Attr

    response = table.scan(
        FilterExpression=Attr('userId').eq(user_id) & Attr('recordType').eq('medication')
    )

    medications = response.get('Items', [])
    today = date.today().isoformat()

    # Check if taken today
    for med in medications:
        taken_date = med.get('lastTakenDate', '')
        med['takenToday'] = taken_date == today

    # Sort by name
    medications.sort(key=lambda x: x.get('name', ''))

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'medications': medications})
    }


def create_medication(body: dict):
    table = get_dynamodb_table()

    med_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    item = {
        'userId': body.get('userId', 'demo-user-123'),
        'recordId': f"med#{med_id}",
        'recordType': 'medication',
        'medicationId': med_id,
        'name': body.get('name', ''),
        'dosage': body.get('dosage', ''),
        'times': body.get('times', []),
        'active': True,
        'createdAt': now,
        'lastTakenDate': None,
    }

    table.put_item(Item=item)

    return {
        'statusCode': 201,
        'headers': CORS,
        'body': json.dumps({
            'message': 'Medication added',
            'medicationId': med_id,
            'medication': item
        })
    }


def mark_taken(med_id: str, body: dict):
    table = get_dynamodb_table()
    user_id = body.get('userId', 'demo-user-123')
    taken_at = body.get('takenAt', datetime.utcnow().isoformat())
    today = date.today().isoformat()

    # Find the medication record
    from boto3.dynamodb.conditions import Attr
    response = table.scan(
        FilterExpression=Attr('medicationId').eq(med_id) & Attr('userId').eq(user_id)
    )

    items = response.get('Items', [])
    if not items:
        return {
            'statusCode': 404,
            'headers': CORS,
            'body': json.dumps({'error': 'Medication not found'})
        }

    item = items[0]

    # Update the record
    table.update_item(
        Key={'userId': item['userId'], 'recordId': item['recordId']},
        UpdateExpression='SET lastTakenDate = :today, lastTakenAt = :taken_at',
        ExpressionAttributeValues={':today': today, ':taken_at': taken_at}
    )

    # Log adherence
    adherence_table = boto3.resource(
        'dynamodb', region_name=os.environ['AWS_REGION_NAME']
    ).Table(os.environ['DYNAMODB_MAIN_TABLE'])

    adherence_table.put_item(Item={
        'userId': user_id,
        'recordId': f"adherence#{med_id}#{today}",
        'recordType': 'adherence',
        'medicationId': med_id,
        'status': 'taken',
        'takenAt': taken_at,
        'date': today,
    })

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'message': 'Marked as taken', 'date': today})
    }


def delete_medication(med_id: str, user_id: str):
    table = get_dynamodb_table()
    from boto3.dynamodb.conditions import Attr

    response = table.scan(
        FilterExpression=Attr('medicationId').eq(med_id) & Attr('userId').eq(user_id)
    )

    items = response.get('Items', [])
    if not items:
        return {
            'statusCode': 404,
            'headers': CORS,
            'body': json.dumps({'error': 'Medication not found'})
        }

    item = items[0]
    table.delete_item(Key={'userId': item['userId'], 'recordId': item['recordId']})

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'message': 'Medication deleted'})
    }
