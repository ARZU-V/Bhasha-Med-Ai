#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Bhasha AI — Deploy all Lambda functions
# Run from: bhasha-backend/   →   bash deploy.sh
#
# Requires:
#   - .env.deploy file with your secrets (copy from .env.deploy.example)
#   - scripts/.role_arn (created by setup_infra.sh)
#   - AWS CLI configured
# ═══════════════════════════════════════════════════════════════════════════════

set -e

REGION="ap-south-1"
RUNTIME="python3.12"
TIMEOUT=30

# ── Load secrets ──────────────────────────────────────────────────────────────

if [ ! -f ".env.deploy" ]; then
  echo "❌ .env.deploy not found. Copy .env.deploy.example → .env.deploy and fill in secrets."
  exit 1
fi
source .env.deploy

# ── Load role ARN (from setup_infra.sh) ──────────────────────────────────────

if [ -f "scripts/.role_arn" ]; then
  source scripts/.role_arn
else
  # Fallback: fetch from AWS
  LAMBDA_ROLE_ARN=$(aws iam get-role --role-name bhasha-lambda-role \
    --query "Role.Arn" --output text 2>/dev/null)
fi

if [ -z "$LAMBDA_ROLE_ARN" ]; then
  echo "❌ Could not find Lambda role ARN. Run setup_infra.sh first."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        Bhasha AI — Lambda Deployment             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Region   : $REGION"
echo "Role     : $LAMBDA_ROLE_ARN"
echo ""

# ── Fixed values ──────────────────────────────────────────────────────────────

S3_BUCKET="bhasha-ai-audio-arjit"
MAIN_TABLE="BhashaAIMain"
CONV_TABLE="BhashaAIConversations"
CALL_TABLE="BhashaAICallStatus"
API_BASE="https://4zu47eekcg.execute-api.ap-south-1.amazonaws.com/Prod"

# ── Helper: deploy one Lambda ─────────────────────────────────────────────────

deploy_lambda() {
  local FUNC_NAME=$1
  local FOLDER=$2

  echo "▶ $FUNC_NAME"

  cd "lambdas/$FOLDER"
  python -c "import zipfile; z=zipfile.ZipFile('../../${FUNC_NAME}.zip','w',zipfile.ZIP_DEFLATED); z.write('lambda_function.py'); z.close()"
  cd ../..

  # Create or update code
  if aws lambda get-function --function-name "$FUNC_NAME" --region "$REGION" > /dev/null 2>&1; then
    aws lambda update-function-code \
      --function-name "$FUNC_NAME" \
      --zip-file "fileb://${FUNC_NAME}.zip" \
      --region "$REGION" > /dev/null
    echo "  code updated"
  else
    aws lambda create-function \
      --function-name "$FUNC_NAME" \
      --runtime "$RUNTIME" \
      --role "$LAMBDA_ROLE_ARN" \
      --handler lambda_function.lambda_handler \
      --zip-file "fileb://${FUNC_NAME}.zip" \
      --timeout "$TIMEOUT" \
      --region "$REGION" > /dev/null
    echo "  created"
    # Wait for function to be active before setting env vars
    aws lambda wait function-active \
      --function-name "$FUNC_NAME" \
      --region "$REGION" 2>/dev/null || true
  fi

  rm -f "${FUNC_NAME}.zip"
}

# ── Helper: set env vars ──────────────────────────────────────────────────────

set_env() {
  local FUNC_NAME=$1
  local ENV_VARS=$2

  aws lambda update-function-configuration \
    --function-name "$FUNC_NAME" \
    --environment "Variables={$ENV_VARS}" \
    --region "$REGION" > /dev/null
  echo "  env vars set ✅"
}

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY EACH FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════

# 1. voice-process
deploy_lambda "voice-process" "voice_process"
set_env "voice-process" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_CONVERSATIONS_TABLE=$CONV_TABLE"

# 2. medication-crud
deploy_lambda "medication-crud" "medication_crud"
set_env "medication-crud" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_MAIN_TABLE=$MAIN_TABLE"

# 3. book-appointment
deploy_lambda "book-appointment" "book_appointment"
set_env "book-appointment" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_CALL_STATUS_TABLE=$CALL_TABLE,API_BASE_URL=$API_BASE,EXOTEL_ACCOUNT_SID=${EXOTEL_ACCOUNT_SID},EXOTEL_API_KEY=${EXOTEL_API_KEY},EXOTEL_API_TOKEN=${EXOTEL_API_TOKEN},EXOTEL_PHONE=${EXOTEL_PHONE}"

# 4. call-status
deploy_lambda "call-status" "call_status"
set_env "call-status" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_CALL_STATUS_TABLE=$CALL_TABLE"

# 5. connect-callback
deploy_lambda "connect-callback" "connect_callback"
set_env "connect-callback" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_CALL_STATUS_TABLE=$CALL_TABLE"

# 6. exoml-applet
deploy_lambda "exoml-applet" "exoml_applet"
set_env "exoml-applet" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_CALL_STATUS_TABLE=$CALL_TABLE"

# 7. emergency-trigger
deploy_lambda "emergency-trigger" "emergency_trigger"
set_env "emergency-trigger" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_MAIN_TABLE=$MAIN_TABLE,DYNAMODB_CALL_STATUS_TABLE=$CALL_TABLE,API_BASE_URL=$API_BASE,EXOTEL_ACCOUNT_SID=${EXOTEL_ACCOUNT_SID},EXOTEL_API_KEY=${EXOTEL_API_KEY},EXOTEL_API_TOKEN=${EXOTEL_API_TOKEN},EXOTEL_PHONE=${EXOTEL_PHONE}"

# 8. emergency-cancel
deploy_lambda "emergency-cancel" "emergency_cancel"
set_env "emergency-cancel" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_MAIN_TABLE=$MAIN_TABLE"

# 9. health-log
deploy_lambda "health-log" "health_log"
set_env "health-log" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_MAIN_TABLE=$MAIN_TABLE"

# 10. voice-transcribe
deploy_lambda "voice-transcribe" "voice_transcribe"
set_env "voice-transcribe" \
  "AWS_REGION_NAME=$REGION,S3_BUCKET=$S3_BUCKET"

# 11. medicine-check
deploy_lambda "medicine-check" "medicine_check"
set_env "medicine-check" \
  "BEDROCK_REGION=us-east-1"

# 12. medicine-scan
deploy_lambda "medicine-scan" "medicine_scan"
set_env "medicine-scan" \
  "BEDROCK_REGION=us-east-1"

# 13. hospital-finder
deploy_lambda "hospital-finder" "hospital_finder"
HOSP_ENV="AWS_REGION_NAME=$REGION"
if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
  HOSP_ENV="$HOSP_ENV,GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}"
fi
set_env "hospital-finder" "$HOSP_ENV"

# 14. profile-crud
deploy_lambda "profile-crud" "profile_crud"
set_env "profile-crud" \
  "AWS_REGION_NAME=$REGION,DYNAMODB_MAIN_TABLE=$MAIN_TABLE"

# 15. medical-history
deploy_lambda "medical-history" "medical_history"
set_env "medical-history" \
  "APP_REGION=$REGION,BEDROCK_REGION=us-east-1,DYNAMODB_MAIN_TABLE=$MAIN_TABLE,S3_BUCKET=$S3_BUCKET"

# 16. deep_analysis
deploy_lambda "deep_analysis" "deep_analysis"
DEEP_ENV="DYNAMODB_MAIN_TABLE=$MAIN_TABLE,BEDROCK_REGION=us-east-1,APP_REGION=$REGION"
if [ -n "$KNOWLEDGE_BASE_ID" ]; then
  DEEP_ENV="$DEEP_ENV,KNOWLEDGE_BASE_ID=${KNOWLEDGE_BASE_ID}"
fi
set_env "deep_analysis" "$DEEP_ENV"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         All Lambdas deployed! ✅                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "API Gateway: $API_BASE"
echo ""
echo "REMAINING MANUAL STEP:"
echo "  Add POST /deep-analysis route in API Gateway console"
echo "  → Console → API Gateway → 4zu47eekcg → Resources"
echo "  → Create Resource: /deep-analysis"
echo "  → Create Method: POST → Lambda: deep-analysis"
echo "  → Enable CORS → Deploy to Prod stage"
echo ""
if [ -z "$KNOWLEDGE_BASE_ID" ]; then
  echo "⚠️  KNOWLEDGE_BASE_ID not set — deep-analysis runs in fallback (direct Claude) mode."
  echo "   Once KB is created, set KNOWLEDGE_BASE_ID in .env.deploy and re-run:"
  echo "   bash deploy.sh"
  echo ""
fi
