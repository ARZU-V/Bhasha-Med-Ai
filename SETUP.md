# Bhasha AI — Setup Guide

## Project Structure
```
bhasha-med-ai/
├── bhasha-frontend/          ← React app (deploy to Vercel)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── config.ts
│   │   ├── components/
│   │   │   └── ProfileModal.tsx   ← NEW: first-launch profile setup
│   │   └── tabs/
│   │       ├── VoiceTab.tsx       ← auto dialect detection
│   │       ├── MedicationsTab.tsx ← + medicine checker
│   │       ├── HospitalTab.tsx    ← NEW: map + hospital finder
│   │       ├── AppointmentsTab.tsx
│   │       ├── EmergencyTab.tsx
│   │       └── TimelineTab.tsx
│   └── package.json
└── bhasha-backend/
    └── lambdas/              ← 13 Lambda functions (deploy to AWS)
        ├── voice_process/
        ├── voice_transcribe/     ← NEW: dialect auto-detection
        ├── medication_crud/
        ├── medicine_check/       ← NEW: medicine safety checker
        ├── medicine_scan/        ← NEW: prescription image scanner
        ├── book_appointment/
        ├── call_status/
        ├── connect_callback/
        ├── emergency_trigger/
        ├── emergency_cancel/
        ├── health_log/
        ├── hospital_finder/      ← NEW: AWS Location Service
        └── profile_crud/         ← NEW: user profile storage
```

## Step 1: Run Frontend Locally
```cmd
cd bhasha-frontend
npm install
cp .env.example .env
# Edit .env and set VITE_API_URL (or leave as localhost for now)
npm run dev
# Open: http://localhost:3000
```

## Step 2: AWS Setup (one-time)

### 2.1 DynamoDB Tables (create in ap-south-1)
- **BhashaAI_Main** — Partition key: `userId` (String), Sort key: `recordId` (String)
- **BhashaAI_Conversations** — Partition key: `sessionId` (String), Sort key: `timestamp` (String)
- **BhashaAI_CallStatus** — Partition key: `callId` (String)

### 2.2 S3 Bucket
- Name: `bhasha-ai-audio-YOURNAME` (must be globally unique)
- Enable public access (for audio URLs)
- Add bucket policy for public read on `/audio/*`
- Add lifecycle rule: delete `audio/transcriptions/*` after 1 day (temp transcription files)

### 2.3 Enable Bedrock
- Region: ap-south-1 (Mumbai)
- Request access to:
  - **Claude 3 Haiku** (`anthropic.claude-3-haiku-20240307-v1:0`) — voice chat + medicine check
  - **Claude 3.5 Sonnet** (`anthropic.claude-3-5-sonnet-20241022-v2:0`) — prescription vision scanning

### 2.4 AWS Location Service (for Hospital Finder)
1. Go to AWS Console → Amazon Location Service → Place indexes
2. Click **Create place index**
3. Name: `BhashaAI_PlaceIndex`
4. Data provider: **Esri** (has free tier)
5. Click Create

### 2.5 Lambda Functions (create 13 functions, Python 3.12)
Names:
- `voice-process`
- `voice-transcribe` *(NEW)*
- `medication-crud`
- `medicine-check` *(NEW)*
- `medicine-scan` *(NEW)*
- `book-appointment`
- `call-status`
- `connect-callback`
- `emergency-trigger`
- `emergency-cancel`
- `health-log`
- `hospital-finder` *(NEW)*
- `profile-crud` *(NEW)*

IAM Role needs permissions:
- AmazonBedrockFullAccess
- AmazonDynamoDBFullAccess
- AmazonS3FullAccess
- AmazonPollyFullAccess
- AmazonTranscribeFullAccess *(NEW — for dialect detection)*
- AmazonLocationFullAccess *(NEW — for hospital finder)*
- AmazonConnectFullAccess
- AmazonSNSFullAccess

Upload zip files from `bhasha-backend/lambdas/[folder]/lambda_function.py`
Set env vars from `bhasha-backend/env_vars.md`

### 2.6 API Gateway (REST API)
Create routes:
| Method | Path | Lambda |
|--------|------|--------|
| POST | /voice/process | voice-process |
| POST | /voice/transcribe | voice-transcribe *(NEW)* |
| POST | /medications | medication-crud |
| GET | /medications | medication-crud |
| PUT | /medications/{id}/taken | medication-crud |
| GET | /medicine/check | medicine-check *(NEW)* |
| POST | /medicine/check | medicine-check *(NEW)* |
| POST | /medicine/scan | medicine-scan *(NEW)* |
| GET | /hospitals/nearby | hospital-finder *(NEW)* |
| GET | /profile | profile-crud *(NEW)* |
| POST | /profile | profile-crud *(NEW)* |
| POST | /appointments/book | book-appointment |
| GET | /appointments/status/{callId} | call-status |
| POST | /appointments/callback | connect-callback |
| POST | /emergency/trigger | emergency-trigger |
| POST | /emergency/cancel | emergency-cancel |
| GET | /health/logs | health-log |
| POST | /health/logs | health-log |

Enable CORS on all routes. Deploy to stage: `prod`

## Step 3: Deploy Frontend to Vercel
```cmd
cd bhasha-frontend
npm run build

# Install Vercel CLI
npm i -g vercel
vercel login

# Deploy
vercel --prod
# When asked for VITE_API_URL, paste your API Gateway URL
```

## Step 4: Amazon Connect (Optional — for real calls)
1. Create Connect instance in ap-south-1
2. Claim a phone number
3. Create contact flows for booking & emergency
4. Add CONNECT_INSTANCE_ID and other vars to Lambda env

## Step 5: Lambda Timeouts
Increase timeout for these functions (AWS Console → Lambda → Configuration → General):
- **voice-transcribe**: 60 seconds (Transcribe batch polling)
- **medicine-scan**: 30 seconds (Bedrock Vision)
- All others: default 15 seconds is fine

## Features Overview

### Voice Chat with Dialect Detection
- User presses mic → records audio (webm)
- Audio sent as base64 to `/voice/transcribe`
- Amazon Transcribe detects language automatically from 10 Indian languages:
  Hindi, English, Telugu, Tamil, Marathi, Bengali, Gujarati, Kannada, Malayalam, Punjabi
- Detected language shown in UI as "Detected: हिंदी"
- Text sent to `/voice/process` with detected language
- AI responds in the same language via Amazon Polly

### Medicine Checker
- Type medicine name → `/medicine/check` → Claude 3 Haiku returns structured safety info
- Upload prescription photo → `/medicine/scan` → Claude 3.5 Sonnet Vision extracts medicine names
- Checks against user's known conditions from profile

### Hospital Finder
- Uses browser GPS or defaults to user's city
- Calls `/hospitals/nearby` → AWS Location Service (Esri place index)
- Results ranked: Emergency hospitals first, then by distance
- Interactive Leaflet map (OpenStreetMap tiles — free, no API key)
- Filter by: All | Emergency | Clinic | Government

### Profile Setup
- Shows automatically on first launch
- Saves: name, age, preferred language, known conditions
- Stored in localStorage (offline-first) + synced to DynamoDB via `/profile`
- Used by: voice chat (greeting), medicine checker (safety warnings), emergency (contacts)

## Cost Estimate (Hackathon scale)
| Service | Cost |
|---------|------|
| Lambda | Free tier covers ~1M requests |
| DynamoDB | Free tier |
| Bedrock Haiku | ~$0.001 per conversation |
| Bedrock Sonnet (vision) | ~$0.005 per image scan |
| Polly | ~$0.000004 per character |
| Transcribe | ~$0.024 per minute of audio |
| Location Service | Free tier: 10K requests/month |
| Amazon Connect | ~$0.018/min (only if using real calls) |
| **Total for demo** | **~$3-8** |
