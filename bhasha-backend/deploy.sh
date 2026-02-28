#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Bhasha AI — Deploy all Lambda functions to AWS
# Run from: bhasha-backend/
# ─────────────────────────────────────────────────────────────

REGION="ap-south-1"
RUNTIME="python3.12"

# Update these after AWS setup
S3_BUCKET="bhasha-ai-audio-arjit"
BEDROCK_MODEL_ID="anthropic.claude-3-haiku-20240307-v1:0"
DYNAMODB_MAIN_TABLE="BhashaAIMain"
DYNAMODB_CONVERSATIONS_TABLE="BhashaAIConversations"
DYNAMODB_CALL_STATUS_TABLE="BhashaAICallStatus"


FUNCTIONS=(
  "voice-process:voice_process"
  "medication-crud:medication_crud"
  "book-appointment:book_appointment"
  "call-status:call_status"
  "connect-callback:connect_callback"
  "emergency-trigger:emergency_trigger"
  "emergency-cancel:emergency_cancel"
  "health-log:health_log"
  "voice-transcribe:voice_transcribe"
  "medicine-check:medicine_check"
  "medicine-scan:medicine_scan"
  "hospital-finder:hospital_finder"
  "profile-crud:profile_crud"
)

for entry in "${FUNCTIONS[@]}"; do
  FUNC_NAME="${entry%%:*}"
  FOLDER="${entry##*:}"

  echo "▶ Deploying $FUNC_NAME..."

  # Zip the function
  cd "lambdas/$FOLDER"
  zip -r "../../${FUNC_NAME}.zip" lambda_function.py
  cd ../..

  # Check if function exists
  aws lambda get-function --function-name "$FUNC_NAME" --region "$REGION" > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    # Update existing
    aws lambda update-function-code \
      --function-name "$FUNC_NAME" \
      --zip-file "fileb://${FUNC_NAME}.zip" \
      --region "$REGION" > /dev/null
    echo "  ✅ Updated $FUNC_NAME"
  else
    # Create new (requires IAM role — create via console first)
    echo "  ⚠️  $FUNC_NAME doesn't exist — create it via AWS Console first, then re-run"
  fi

  rm -f "${FUNC_NAME}.zip"
done

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next: Update environment variables in AWS Lambda console for each function"
