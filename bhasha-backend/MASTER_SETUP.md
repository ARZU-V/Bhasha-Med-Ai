# Bhasha AI — Master Setup Guide

> **Account:** 039612849658 | **App region:** ap-south-1 | **AI region:** us-east-1
> **API Gateway:** `https://4zu47eekcg.execute-api.ap-south-1.amazonaws.com/Prod`

---

## Prerequisites

```bash
aws --version          # AWS CLI v2
python3 --version      # 3.12+
node --version         # 18+
aws configure          # must be set up with your IAM user keys
```

---

## Step 1 — Run Automated Infrastructure Setup

Creates: IAM role, DynamoDB tables, S3 lifecycle rule.

```bash
cd bhasha-backend
bash scripts/setup_infra.sh
```

**What it creates:**

| Resource | Name |
|----------|------|
| IAM Role | `bhasha-lambda-role` |
| DynamoDB | `BhashaAI_Main` (pk: userId, sk: recordType) |
| DynamoDB | `BhashaAI_Conversations` (pk: sessionId, sk: timestamp) |
| DynamoDB | `BhashaAI_CallStatus` (pk: callId) |
| S3 lifecycle | Delete `audio/transcriptions/*` after 1 day |

---

## Step 2 — Manual AWS Console Steps

These cannot be automated via CLI. Do them in order.

### 2A. Enable Bedrock Model Access
> Console → **us-east-1** region → Bedrock → Model access → Manage model access

Request access to all of these:
- `anthropic.claude-3-5-sonnet-20241022-v2:0` (Deep Analysis + Vision)
- `amazon.nova-lite-v1:0` (Quick voice chat)
- `amazon.nova-micro-v1:0` (Medicine check)
- `amazon.titan-embed-text-v2:0` (Knowledge Base embeddings)

Wait for status = **Access granted** (usually instant for Claude, <1 min for others).

---

### 2B. SNS SMS — Verify Your Phone Number
> Console → **ap-south-1** → SNS → Text messaging (SMS) → Sandbox

1. Click **Add phone number**
2. Enter your number in E.164 format: `+91XXXXXXXXXX`
3. Enter the OTP received via SMS
4. Repeat for any test numbers (emergency contacts)

> **Note:** Sandbox = can only send to verified numbers. For production, request "Move out of sandbox" — AWS typically approves within 24h.

---

### 2C. Location Service — Create Place Index
> Console → **ap-south-1** → Location Service → Place indexes → Create place index

| Field | Value |
|-------|-------|
| Name | `BhashaAI_PlaceIndex` |
| Data provider | **Esri** (free tier available) |
| Intended use | Single use |

Click **Create place index**. Done.

---

### 2D. Bedrock Knowledge Base — RAG Pipeline

This is the most important step for Deep Analysis mode.

#### 2D-1. Upload medical documents to S3

**Option A — MedRAG textbook dataset (125k chunks, recommended):**
```bash
cd bhasha-backend
pip install datasets boto3 tqdm
python scripts/prepare_kb_docs.py \
  --bucket bhasha-ai-audio-arjit \
  --prefix kb-docs/
# Takes ~30 min. Uploads chunks from Gray's Anatomy, Harrison's, Robbins, etc.
```

**Option B — Your own PDFs (quick demo, 5 min):**
```bash
# Upload any medical PDFs manually
aws s3 cp path/to/your-medical.pdf \
  s3://bhasha-ai-audio-arjit/kb-docs/
```

**Best PDFs to use for hackathon demo** (all free downloads):
- WHO disease fact sheets: who.int/publications → search any disease → PDF
- NHS conditions: nhs.uk/conditions → save page as PDF
- ICMR treatment guidelines: icmr.gov.in

#### 2D-2. Create Knowledge Base in Console
> Console → **us-east-1** → Bedrock → Knowledge Bases → Create knowledge base

| Step | Setting |
|------|---------|
| Name | `BhashaAI_MedKB` |
| IAM role | `bhasha-lambda-role` |
| Embedding model | `amazon.titan-embed-text-v2:0` |
| Data source | Amazon S3 |
| S3 URI | `s3://bhasha-ai-audio-arjit/kb-docs/` |
| Vector store | **OpenSearch Serverless** (auto-create) |
| Chunking | Fixed size — **512 tokens**, 10% overlap |

Click **Create** → wait ~3 min for creation.

#### 2D-3. Sync the Knowledge Base
On the KB detail page → **Data source** → Select your S3 source → **Sync**

Wait for sync to complete (green checkmark). Time depends on doc count:
- ~50 PDFs: 2-5 min
- 125k MedRAG chunks: 15-20 min

#### 2D-4. Copy the Knowledge Base ID
On the KB detail page, copy the **Knowledge base ID** (format: `XXXXXXXXXX`).

---

## Step 3 — Fill in Secrets

```bash
cd bhasha-backend
cp .env.deploy.example .env.deploy
# Edit .env.deploy with your actual values:
```

```env
EXOTEL_ACCOUNT_SID=your_sid
EXOTEL_API_KEY=your_key
EXOTEL_API_TOKEN=your_token
EXOTEL_PHONE=08039XXXXXX
GOOGLE_MAPS_API_KEY=           # optional
KNOWLEDGE_BASE_ID=XXXXXXXXXX   # from step 2D-4
```

---

## Step 4 — Deploy All 15 Lambdas

```bash
cd bhasha-backend
bash deploy.sh
```

Deploys and configures env vars for all 15 functions:

| # | Lambda | Purpose |
|---|--------|---------|
| 1 | `voice-process` | Quick mode AI chat |
| 2 | `medication-crud` | Medication reminders |
| 3 | `book-appointment` | Exotel appointment calls |
| 4 | `call-status` | Check call status |
| 5 | `connect-callback` | Exotel webhook |
| 6 | `exoml-applet` | Exotel TTS script |
| 7 | `emergency-trigger` | SOS alert + calling |
| 8 | `emergency-cancel` | Cancel SOS |
| 9 | `health-log` | Log health entries |
| 10 | `voice-transcribe` | Speech → text |
| 11 | `medicine-check` | Medicine info lookup |
| 12 | `medicine-scan` | Prescription image scan |
| 13 | `hospital-finder` | Nearby hospitals |
| 14 | `profile-crud` | User profile |
| 15 | `deep-analysis` | Deep AI + RAG + SMS |

---

## Step 5 — API Gateway Routes

> Console → API Gateway → `4zu47eekcg` → Resources

**Existing routes** (should already be there):

| Method | Path | Lambda |
|--------|------|--------|
| POST | /voice/process | voice-process |
| GET/POST | /medications | medication-crud |
| POST | /appointments/book | book-appointment |
| GET | /appointments/status/{callId} | call-status |
| POST | /appointments/callback | connect-callback |
| GET | /appointments/applet/{callId} | exoml-applet |
| POST | /emergency/trigger | emergency-trigger |
| POST | /emergency/cancel | emergency-cancel |
| GET/POST | /health-log | health-log |
| POST | /voice/transcribe | voice-transcribe |
| GET/POST | /medicine/check | medicine-check |
| POST | /medicine/scan | medicine-scan |
| GET | /hospitals/nearby | hospital-finder |
| GET/POST | /profile | profile-crud |

**Add this new route:**

| Method | Path | Lambda |
|--------|------|--------|
| POST | `/deep-analysis` | deep-analysis |

**How to add:**
1. Click root `/` → **Actions → Create Resource** → Resource name: `deep-analysis`
2. Select `/deep-analysis` → **Actions → Create Method** → POST
3. Lambda function: `deep-analysis` | Use Lambda proxy: ✅
4. Select `/deep-analysis` → **Actions → Enable CORS** → Yes
5. **Actions → Deploy API** → Stage: `Prod`

---

## Step 6 — Frontend Configuration

Create `bhasha-frontend/.env`:
```env
VITE_API_URL=https://4zu47eekcg.execute-api.ap-south-1.amazonaws.com/Prod
```

Then:
```bash
cd bhasha-frontend
npm install
npm run dev        # local
npm run build      # production build
```

---

## Step 7 — Test Checklist

| Test | How | Expected |
|------|-----|----------|
| Quick mode | Tap mic, say "mujhe sir dard ho raha hai" | Hindi response, navigates to hospitals |
| Deep mode | Toggle 🔬, type "chest pain for 2 days" | Structured card: urgency, conditions, steps |
| Deep + SMS | Click "Send to phone" | SMS received on verified number |
| Hospital finder | Go to Nearby tab, allow location | Map loads with hospital pins |
| Appointment | Go to Book tab, fill form | Exotel calls the clinic number |
| Emergency SOS | Tap SOS → trigger | Calls emergency contact |
| Medicine check | Type "Metformin" in Meds tab | Card with uses, side effects, interactions |
| Profile | Tap 👤 → set name + conditions | Persists on reload, AI uses your name |

---

## AWS Services Used (Full Stack)

| Service | Purpose | Region |
|---------|---------|--------|
| Amazon Bedrock (Claude 3.5 Sonnet) | Deep analysis, vision | us-east-1 |
| Amazon Bedrock (Nova Lite) | Quick voice chat | us-east-1 |
| Amazon Bedrock Knowledge Base | RAG over medical docs | us-east-1 |
| Amazon Comprehend Medical | Extract symptoms, ICD-10 codes | us-east-1 |
| Amazon Transcribe | Speech-to-text + language detection | ap-south-1 |
| Amazon Polly | Text-to-speech | ap-south-1 |
| Amazon DynamoDB | Chat history, profiles, health logs | ap-south-1 |
| Amazon S3 | Audio, medical documents | ap-south-1 |
| Amazon SNS | SMS health summaries | ap-south-1 |
| Amazon Location Service | Hospital/clinic finder | ap-south-1 |
| AWS Lambda (×15) | All backend logic | ap-south-1 |
| Amazon API Gateway | REST API | ap-south-1 |

**12 AWS services. Zero servers. 10 Indian languages.**

---

## Troubleshooting

**"ValidationException: model identifier invalid"**
→ Bedrock model not enabled in us-east-1. Go to Step 2A.

**"NoSuchBucket" in prepare_kb_docs.py**
→ Bucket name wrong. Bucket is `bhasha-ai-audio-arjit`.

**"ResourceNotFoundException" in deep-analysis**
→ `KNOWLEDGE_BASE_ID` not set. Either set it in `.env.deploy` and redeploy, or it runs in direct-Claude fallback mode (still works, just no RAG).

**SMS not received**
→ Phone not verified in SNS sandbox. Go to Step 2B.

**Hospital map empty**
→ Location permission denied in browser, or OpenStreetMap timeout. Try again.

**voice-process 500 error**
→ Check CloudWatch logs. Usually a Bedrock region issue — should use us-east-1.
