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

    try:
        body = json.loads(event.get('body', '{}'))
        emergency_id = body.get('emergencyId')
        user_id = body.get('userId', 'demo-user-123')

        if not emergency_id:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'emergencyId is required'})
            }

        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

        # Mark as cancelled
        now = datetime.utcnow().isoformat()
        table.update_item(
            Key={
                'userId': user_id,
                'recordId': f"emergency#{emergency_id}",
            },
            UpdateExpression='SET #s = :cancelled, cancelledAt = :now',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':cancelled': 'cancelled',
                ':now': now,
            }
        )

        # If Amazon Connect calls are active, we can't easily stop them,
        # but we log the cancellation so the contact flow can check and stop.
        # The 30-second cancellation window on the frontend handles UX.

        # Notify contacts of cancellation via SNS
        from boto3.dynamodb.conditions import Attr
        contacts_response = table.scan(
            FilterExpression=Attr('userId').eq(user_id) & Attr('recordType').eq('emergency_contact')
        )
        contacts = contacts_response.get('Items', [])

        sns = boto3.client('sns', region_name=os.environ['AWS_REGION_NAME'])
        for contact in contacts:
            phone = contact.get('phone', '')
            if phone:
                try:
                    sns.publish(
                        PhoneNumber=phone,
                        Message=(
                            "✅ Bhasha AI: The emergency alert has been cancelled. "
                            "The user is safe. No action needed."
                        ),
                        MessageAttributes={
                            'AWS.SNS.SMS.SMSType': {
                                'DataType': 'String',
                                'StringValue': 'Transactional'
                            }
                        }
                    )
                except Exception as sms_err:
                    print(f"Cancellation SMS failed for {phone}: {sms_err}")

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'emergencyId': emergency_id,
                'status': 'cancelled',
                'cancelledAt': now,
                'message': 'Emergency cancelled successfully',
            })
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }
