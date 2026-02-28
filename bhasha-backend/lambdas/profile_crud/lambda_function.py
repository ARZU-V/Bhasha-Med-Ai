import json
import boto3
import os
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
            return get_profile(user_id)

        elif method in ('POST', 'PUT'):
            body = json.loads(event.get('body', '{}'))
            return upsert_profile(body)

        elif method == 'DELETE':
            query_params = event.get('queryStringParameters') or {}
            user_id = query_params.get('userId', 'demo-user-123')
            return delete_profile(user_id)

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


def get_profile(user_id: str):
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

    response = table.get_item(
        Key={
            'userId': user_id,
            'recordId': 'profile#main',
        }
    )

    item = response.get('Item')
    if not item:
        return {
            'statusCode': 404,
            'headers': CORS,
            'body': json.dumps({'error': 'Profile not found'})
        }

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'profile': item})
    }


def upsert_profile(body: dict):
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

    user_id = body.get('userId', 'demo-user-123')
    now = datetime.utcnow().isoformat()

    # Build profile item
    item = {
        'userId': user_id,
        'recordId': 'profile#main',
        'recordType': 'profile',
        'name': body.get('name', ''),
        'age': str(body.get('age', '')),
        'language': body.get('language', 'hi-IN'),
        'conditions': body.get('conditions', []),
        'emergencyContacts': body.get('emergencyContacts', []),
        'updatedAt': now,
    }

    # Set createdAt only on first creation (use conditional write)
    response = table.get_item(
        Key={'userId': user_id, 'recordId': 'profile#main'}
    )
    if not response.get('Item'):
        item['createdAt'] = now

    table.put_item(Item=item)

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({
            'message': 'Profile saved',
            'profile': item
        })
    }


def delete_profile(user_id: str):
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
    table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

    table.delete_item(
        Key={
            'userId': user_id,
            'recordId': 'profile#main',
        }
    )

    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'message': 'Profile deleted'})
    }
