#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Bhasha AI — One-time AWS Infrastructure Setup
# Run this ONCE before deploying any Lambdas.
# Run from: bhasha-backend/   →   bash scripts/setup_infra.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

ACCOUNT_ID="039612849658"
REGION="ap-south-1"
ROLE_NAME="bhasha-lambda-role"
BUCKET="bhasha-ai-audio-arjit"
SKIP_IAM=false

# Parse flags
for arg in "$@"; do
  case $arg in
    --skip-iam) SKIP_IAM=true ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       Bhasha AI — Infrastructure Setup           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Account : $ACCOUNT_ID"
echo "Region  : $REGION"
echo "Role    : $ROLE_NAME"
echo "Bucket  : $BUCKET"
if $SKIP_IAM; then
  echo "IAM     : SKIPPED (--skip-iam flag)"
fi
echo ""

# ── 1. IAM Role ───────────────────────────────────────────────────────────────

echo "▶ Step 1/4 — IAM Role"

if $SKIP_IAM; then
  echo "  ⏭  Skipping IAM (--skip-iam). Assuming role '$ROLE_NAME' already exists."
  ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
  echo "  Role ARN: $ROLE_ARN"
else

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}'

if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  echo "  ✅ Role $ROLE_NAME already exists — skipping create"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Execution role for all Bhasha AI Lambda functions" \
    > /dev/null
  echo "  ✅ Created role $ROLE_NAME"
fi

# Full permissions policy
POLICY_JSON=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Sid": "DynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/BhashaAI_*"
      ]
    },
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::$BUCKET",
        "arn:aws:s3:::$BUCKET/*"
      ]
    },
    {
      "Sid": "Bedrock",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BedrockAgentRuntime",
      "Effect": "Allow",
      "Action": [
        "bedrock-agent-runtime:RetrieveAndGenerate",
        "bedrock-agent-runtime:Retrieve",
        "bedrock-agent-runtime:InvokeAgent"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ComprehendMedical",
      "Effect": "Allow",
      "Action": [
        "comprehendmedical:DetectEntitiesV2",
        "comprehendmedical:InferICD10CM",
        "comprehendmedical:InferRxNorm"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Polly",
      "Effect": "Allow",
      "Action": ["polly:SynthesizeSpeech"],
      "Resource": "*"
    },
    {
      "Sid": "Transcribe",
      "Effect": "Allow",
      "Action": [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:DeleteTranscriptionJob"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SNS",
      "Effect": "Allow",
      "Action": ["sns:Publish"],
      "Resource": "*"
    },
    {
      "Sid": "SageMaker",
      "Effect": "Allow",
      "Action": [
        "sagemaker:InvokeEndpoint",
        "sagemaker:InvokeEndpointAsync"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Location",
      "Effect": "Allow",
      "Action": [
        "geo:SearchPlaceIndexForText",
        "geo:SearchPlaceIndexForPosition",
        "geo:SearchPlaceIndexForSuggestions"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "BhashaAI-Lambda-Policy" \
  --policy-document "$POLICY_JSON"
echo "  ✅ Attached permissions policy"

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "  Role ARN: $ROLE_ARN"
fi  # end --skip-iam check

# ── 2. DynamoDB Tables ────────────────────────────────────────────────────────

echo ""
echo "▶ Step 2/4 — DynamoDB Tables"

create_table_if_missing() {
  local TABLE=$1
  local PK=$2
  local SK=$3

  if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" > /dev/null 2>&1; then
    echo "  ✅ Table $TABLE already exists"
  else
    if [ -z "$SK" ]; then
      aws dynamodb create-table \
        --table-name "$TABLE" \
        --attribute-definitions AttributeName="$PK",AttributeType=S \
        --key-schema AttributeName="$PK",KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION" > /dev/null
    else
      aws dynamodb create-table \
        --table-name "$TABLE" \
        --attribute-definitions \
          AttributeName="$PK",AttributeType=S \
          AttributeName="$SK",AttributeType=S \
        --key-schema \
          AttributeName="$PK",KeyType=HASH \
          AttributeName="$SK",KeyType=RANGE \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION" > /dev/null
    fi
    echo "  ✅ Created table $TABLE"
  fi
}

create_table_if_missing "BhashaAI_Main"          "userId"    "recordType"
create_table_if_missing "BhashaAI_Conversations"  "sessionId" "timestamp"
create_table_if_missing "BhashaAI_CallStatus"     "callId"    ""

# ── 3. S3 Lifecycle Rule ──────────────────────────────────────────────────────

echo ""
echo "▶ Step 3/4 — S3 Lifecycle Rule (auto-delete temp audio after 1 day)"

LIFECYCLE_CONFIG='{
  "Rules": [
    {
      "ID": "delete-transcription-audio",
      "Filter": { "Prefix": "audio/transcriptions/" },
      "Status": "Enabled",
      "Expiration": { "Days": 1 }
    }
  ]
}'

aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration "$LIFECYCLE_CONFIG" 2>/dev/null && \
  echo "  ✅ Lifecycle rule set on $BUCKET" || \
  echo "  ⚠️  Lifecycle rule failed (check bucket permissions)"

# ── 4. Write role ARN to file for deploy.sh ───────────────────────────────────

echo ""
echo "▶ Step 4/4 — Saving role ARN"
echo "LAMBDA_ROLE_ARN=$ROLE_ARN" > scripts/.role_arn
echo "  ✅ Saved to scripts/.role_arn"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          Infrastructure setup complete!          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Role ARN: $ROLE_ARN"
echo ""
echo "NEXT STEPS (manual — cannot be scripted):"
echo ""
echo "  1. Enable Bedrock model access in us-east-1 console:"
echo "     → anthropic.claude-3-5-sonnet-20241022-v2:0"
echo "     → us.amazon.nova-lite-v1:0"
echo "     → us.amazon.nova-micro-v1:0"
echo "     → amazon.titan-embed-text-v2:0"
echo ""
echo "  2. SNS SMS sandbox:"
echo "     → Console → SNS → Text messaging → Sandbox"
echo "     → Add phone number → verify via OTP"
echo ""
echo "  3. Location Service:"
echo "     → Console → Location → Place indexes → Create"
echo "     → Name: BhashaAI_PlaceIndex | Provider: Esri"
echo ""
echo "  4. Fill in .env.deploy with your secrets (see .env.deploy.example)"
echo ""
echo "  5. Run:  bash deploy.sh"
echo ""
