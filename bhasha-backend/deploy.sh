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

# Load Bedrock Agent IDs (from setup_bedrock_agent.py)
if [ -f "scripts/.agent_ids" ]; then
  source scripts/.agent_ids
fi

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

  # Try update first; only create if function truly doesn't exist
  if UPDATE_OUT=$(aws lambda update-function-code \
      --function-name "$FUNC_NAME" \
      --zip-file "fileb://${FUNC_NAME}.zip" \
      --region "$REGION" 2>&1); then
    echo "  code updated"
  elif echo "$UPDATE_OUT" | grep -q "ResourceNotFoundException"; then
    aws lambda create-function \
      --function-name "$FUNC_NAME" \
      --runtime "$RUNTIME" \
      --role "$LAMBDA_ROLE_ARN" \
      --handler lambda_function.lambda_handler \
      --zip-file "fileb://${FUNC_NAME}.zip" \
      --timeout "$TIMEOUT" \
      --region "$REGION" > /dev/null
    echo "  created"
    aws lambda wait function-active \
      --function-name "$FUNC_NAME" \
      --region "$REGION" 2>/dev/null || true
  else
    echo "  ERROR: $UPDATE_OUT"
    rm -f "${FUNC_NAME}.zip"
    exit 1
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

# 17. multi_agent  (legacy custom tool-use loop — kept for fallback)
deploy_lambda "multi-agent" "multi_agent"
aws lambda update-function-configuration \
  --function-name "multi-agent" \
  --timeout 90 \
  --region "$REGION" > /dev/null
AGENT_ENV="DYNAMODB_MAIN_TABLE=$MAIN_TABLE,BEDROCK_REGION=us-east-1,APP_REGION=$REGION"
if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
  AGENT_ENV="$AGENT_ENV,GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}"
fi
set_env "multi-agent" "$AGENT_ENV"

# 18. bedrock-agent-action  (Action Group Lambda — Bedrock Agent calls this)
#     Must be deployed to the AGENT_REGION (us-east-1) where the Bedrock Agent lives
BEDROCK_AGENT_REGION="${BEDROCK_AGENT_REGION:-us-east-1}"
echo "▶ bedrock-agent-action  (region: $BEDROCK_AGENT_REGION)"
cd "lambdas/bedrock_agent_action"
python -c "import zipfile; z=zipfile.ZipFile('../../bedrock-agent-action.zip','w',zipfile.ZIP_DEFLATED); z.write('lambda_function.py'); z.close()"
cd ../..
if ACTION_UPDATE=$(aws lambda update-function-code \
  --function-name "bedrock-agent-action" \
  --zip-file "fileb://bedrock-agent-action.zip" \
  --region "$BEDROCK_AGENT_REGION" 2>&1); then
  echo "  code updated"
elif echo "$ACTION_UPDATE" | grep -q "ResourceNotFoundException"; then
  aws lambda create-function \
    --function-name "bedrock-agent-action" \
    --runtime "$RUNTIME" \
    --role "$LAMBDA_ROLE_ARN" \
    --handler lambda_function.lambda_handler \
    --zip-file "fileb://bedrock-agent-action.zip" \
    --timeout 90 \
    --region "$BEDROCK_AGENT_REGION" > /dev/null
  echo "  created"
  aws lambda wait function-active \
    --function-name "bedrock-agent-action" \
    --region "$BEDROCK_AGENT_REGION" 2>/dev/null || true
else
  echo "  ERROR: $ACTION_UPDATE"
  rm -f bedrock-agent-action.zip
  exit 1
fi
rm -f bedrock-agent-action.zip
ACTION_ENV="DYNAMODB_MAIN_TABLE=$MAIN_TABLE,APP_REGION=$REGION,BEDROCK_REGION=$BEDROCK_AGENT_REGION"
if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
  ACTION_ENV="$ACTION_ENV,GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}"
fi
aws lambda update-function-configuration \
  --function-name "bedrock-agent-action" \
  --environment "Variables={$ACTION_ENV}" \
  --region "$BEDROCK_AGENT_REGION" > /dev/null
echo "  env vars set ✅"

# 19. bedrock-agent-invoker  (API Gateway Lambda — frontend calls this)
deploy_lambda "bedrock-agent-invoker" "bedrock_agent_invoker"
aws lambda update-function-configuration \
  --function-name "bedrock-agent-invoker" \
  --timeout 120 \
  --region "$REGION" > /dev/null
INVOKER_ENV="DYNAMODB_MAIN_TABLE=$MAIN_TABLE,APP_REGION=$REGION,BEDROCK_AGENT_REGION=$BEDROCK_AGENT_REGION"
if [ -n "$BEDROCK_AGENT_ID" ]; then
  INVOKER_ENV="$INVOKER_ENV,BEDROCK_AGENT_ID=${BEDROCK_AGENT_ID}"
fi
if [ -n "$BEDROCK_AGENT_ALIAS_ID" ]; then
  INVOKER_ENV="$INVOKER_ENV,BEDROCK_AGENT_ALIAS_ID=${BEDROCK_AGENT_ALIAS_ID}"
fi
set_env "bedrock-agent-invoker" "$INVOKER_ENV"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         All Lambdas deployed! ✅                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "API Gateway: $API_BASE"
echo ""
echo "REMAINING MANUAL STEPS (API Gateway console):"
echo "  → Console → API Gateway → 4zu47eekcg → Resources"
echo ""
echo "  1. POST /deep-analysis → Lambda: deep_analysis"
echo "     Enable CORS, deploy to Prod"
echo ""
echo "  2. POST /multi-agent        → Lambda: multi-agent   (legacy, timeout: 90s)"
echo "     GET  /multi-agent        → Lambda: multi-agent"
echo ""
echo "  3. POST /bedrock-agent      → Lambda: bedrock-agent-invoker  (timeout: 120s)"
echo "     GET  /bedrock-agent      → Lambda: bedrock-agent-invoker"
echo "     Enable CORS on all routes, deploy to Prod"
echo ""
echo "  IMPORTANT: API Gateway integration timeout is max 29s."
echo "  For bedrock-agent (takes 60-90s), use a Lambda Function URL:"
echo "    Console → Lambda → bedrock-agent-invoker → Configuration → Function URL"
echo "    Auth type: NONE, CORS: enabled"
echo "  Then update frontend config.ts: BEDROCK_AGENT_URL = <function-url>"
echo ""
echo "  Run setup first (if not done): python scripts/setup_bedrock_agent.py"
echo ""
if [ -z "$KNOWLEDGE_BASE_ID" ]; then
  echo "⚠️  KNOWLEDGE_BASE_ID not set — deep-analysis runs in fallback (direct Claude) mode."
  echo "   Once KB is created, set KNOWLEDGE_BASE_ID in .env.deploy and re-run:"
  echo "   bash deploy.sh"
  echo ""
fi
