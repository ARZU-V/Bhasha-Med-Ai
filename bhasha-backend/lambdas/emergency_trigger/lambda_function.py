import json
import boto3
import os
import uuid
from datetime import datetime
from boto3.dynamodb.conditions import Attr

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
        user_id = body.get('userId', 'demo-user-123')
        symptoms = body.get('symptoms', 'Emergency SOS')
        location = body.get('location', {})

        emergency_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table = dynamodb.Table(os.environ['DYNAMODB_MAIN_TABLE'])

        # ── Save emergency record ─────────────────────────────────────────────
        table.put_item(Item={
            'userId': user_id,
            'recordId': f"emergency#{emergency_id}",
            'recordType': 'emergency',
            'emergencyId': emergency_id,
            'symptoms': symptoms,
            'location': location,
            'status': 'active',
            'createdAt': now,
            'cancelledAt': None,
        })

        # ── Fetch emergency contacts for this user ────────────────────────────
        contacts_response = table.scan(
            FilterExpression=Attr('userId').eq(user_id) & Attr('recordType').eq('emergency_contact')
        )
        contacts = contacts_response.get('Items', [])

        # ── Build SMS message ─────────────────────────────────────────────────
        location_text = location.get('address', 'Unknown location')
        lat = location.get('lat', '')
        lng = location.get('lng', '')
        maps_url = f"https://maps.google.com/?q={lat},{lng}" if lat and lng else ''

        alert_message = (
            f"🚨 EMERGENCY ALERT — Bhasha AI\n\n"
            f"Someone needs immediate help!\n"
            f"Symptoms: {symptoms}\n"
            f"Location: {location_text}\n"
            f"{f'Maps: {maps_url}' if maps_url else ''}\n\n"
            f"Please respond immediately or call 112."
        )

        # ── Send SMS to all emergency contacts via SNS ────────────────────────
        sns = boto3.client('sns', region_name=os.environ['AWS_REGION_NAME'])
        sms_sent = []

        for contact in contacts:
            phone = contact.get('phone', '')
            name = contact.get('name', 'Contact')
            if phone:
                try:
                    sns.publish(
                        PhoneNumber=phone,
                        Message=alert_message,
                        MessageAttributes={
                            'AWS.SNS.SMS.SMSType': {
                                'DataType': 'String',
                                'StringValue': 'Transactional'
                            }
                        }
                    )
                    sms_sent.append({'name': name, 'phone': phone})
                except Exception as sms_err:
                    print(f"SMS failed for {phone}: {sms_err}")

        # ── Also send to national emergency helpline as notification ──────────
        # Helpline reminders shown in response for user to act on
        helplines = [
            {'name': 'National Emergency', 'number': '112'},
            {'name': 'Ambulance', 'number': '108'},
            {'name': 'Police', 'number': '100'},
        ]

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'emergencyId': emergency_id,
                'status': 'active',
                'contactsNotified': len(sms_sent),
                'smsSent': sms_sent,
                'helplines': helplines,
                'message': (
                    f"Emergency alert sent to {len(sms_sent)} contact(s) via SMS. "
                    f"Please also call 112 for immediate help."
                )
            })
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }
