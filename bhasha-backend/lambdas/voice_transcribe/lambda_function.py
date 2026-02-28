import json
import boto3
import os
import uuid
import time
import base64

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

# Amazon Transcribe language codes for Indian languages
INDIAN_LANGUAGES = [
    'hi-IN',   # Hindi
    'en-IN',   # Indian English
    'te-IN',   # Telugu
    'ta-IN',   # Tamil
    'mr-IN',   # Marathi
    'bn-IN',   # Bengali
    'gu-IN',   # Gujarati
    'kn-IN',   # Kannada
    'ml-IN',   # Malayalam
    'pa-IN',   # Punjabi
]

LANG_DISPLAY = {
    'hi-IN': 'Hindi (हिंदी)',
    'en-IN': 'English (India)',
    'te-IN': 'Telugu (తెలుగు)',
    'ta-IN': 'Tamil (தமிழ்)',
    'mr-IN': 'Marathi (मराठी)',
    'bn-IN': 'Bengali (বাংলা)',
    'gu-IN': 'Gujarati (ગુજરાતી)',
    'kn-IN': 'Kannada (ಕನ್ನಡ)',
    'ml-IN': 'Malayalam (മലയാളം)',
    'pa-IN': 'Punjabi (ਪੰਜਾਬੀ)',
}


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'POST')

    if method != 'POST':
        return {
            'statusCode': 405,
            'headers': CORS,
            'body': json.dumps({'error': 'Method not allowed'})
        }

    try:
        body = json.loads(event.get('body', '{}'))
        audio_b64 = body.get('audio')
        audio_format = body.get('format', 'webm')  # webm, mp3, wav, ogg

        if not audio_b64:
            return {
                'statusCode': 400,
                'headers': CORS,
                'body': json.dumps({'error': 'audio field required (base64 encoded)'})
            }

        return transcribe_audio(audio_b64, audio_format)

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }


def transcribe_audio(audio_b64: str, audio_format: str):
    region = os.environ['AWS_REGION_NAME']
    s3_region = os.environ.get('S3_REGION', region)
    bucket = os.environ['S3_BUCKET']

    s3 = boto3.client('s3', region_name=s3_region)
    transcribe = boto3.client('transcribe', region_name=region)

    # Upload audio to S3
    job_id = str(uuid.uuid4())
    s3_key = f'audio/transcriptions/{job_id}.{audio_format}'

    audio_bytes = base64.b64decode(audio_b64)
    s3.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=audio_bytes,
        ContentType=f'audio/{audio_format}'
    )

    # Map format to Transcribe MediaFormat
    media_format_map = {
        'webm': 'webm',
        'ogg': 'ogg',
        'mp3': 'mp3',
        'mp4': 'mp4',
        'wav': 'wav',
        'flac': 'flac',
        'm4a': 'mp4',
        'amr': 'amr',
    }
    media_format = media_format_map.get(audio_format, 'webm')

    job_name = f'bhasha-{job_id}'
    s3_uri = f's3://{bucket}/{s3_key}'

    # Start transcription job with language auto-detection
    transcribe.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={'MediaFileUri': s3_uri},
        MediaFormat=media_format,
        IdentifyLanguage=True,
        LanguageOptions=INDIAN_LANGUAGES,
        Settings={
            'ShowSpeakerLabels': False,
            'ChannelIdentification': False,
        }
    )

    # Poll for completion (max 40 seconds for short clips)
    max_wait = 40
    poll_interval = 2
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval

        response = transcribe.get_transcription_job(TranscriptionJobName=job_name)
        job = response['TranscriptionJob']
        status = job['TranscriptionJobStatus']

        if status == 'COMPLETED':
            # Fetch transcript text from S3 (Transcribe writes results to S3)
            transcript_uri = job['Transcript']['TranscriptFileUri']
            detected_lang = job.get('LanguageCode', 'hi-IN')
            lang_confidence = job.get('IdentifiedLanguageScore', 0.0)

            # Download transcript JSON from the URI
            import urllib.request
            with urllib.request.urlopen(transcript_uri) as resp:
                transcript_data = json.loads(resp.read().decode('utf-8'))

            text = transcript_data['results']['transcripts'][0]['transcript']

            # Cleanup S3 audio file
            try:
                s3.delete_object(Bucket=bucket, Key=s3_key)
            except Exception:
                pass  # Non-fatal

            return {
                'statusCode': 200,
                'headers': CORS,
                'body': json.dumps({
                    'text': text,
                    'detectedLanguage': detected_lang,
                    'languageDisplay': LANG_DISPLAY.get(detected_lang, detected_lang),
                    'confidence': round(float(lang_confidence), 3),
                })
            }

        elif status == 'FAILED':
            reason = job.get('FailureReason', 'Unknown error')
            # Cleanup
            try:
                s3.delete_object(Bucket=bucket, Key=s3_key)
                transcribe.delete_transcription_job(TranscriptionJobName=job_name)
            except Exception:
                pass
            return {
                'statusCode': 500,
                'headers': CORS,
                'body': json.dumps({'error': f'Transcription failed: {reason}'})
            }

        # Still IN_PROGRESS, keep polling

    # Timeout — cleanup and return error
    try:
        s3.delete_object(Bucket=bucket, Key=s3_key)
        transcribe.delete_transcription_job(TranscriptionJobName=job_name)
    except Exception:
        pass

    return {
        'statusCode': 504,
        'headers': CORS,
        'body': json.dumps({'error': 'Transcription timed out after 40 seconds'})
    }
