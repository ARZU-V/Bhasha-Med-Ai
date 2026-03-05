"""
setup_bedrock_agent.py

One-time script to create the Bhasha AI Bedrock Agent.

Run this ONCE before deploying. It will:
  1. Create IAM role for the Bedrock Agent
  2. Create the Agent (foundation model: Claude Sonnet 3.5)
  3. Create Action Group (3 tools: diagnose, find_hospitals, rank_hospitals)
  4. Prepare the agent (compiles it for use)
  5. Create a production alias
  6. Print the AGENT_ID and ALIAS_ID to add to your .env.deploy

Prerequisites:
  - AWS CLI configured with admin permissions
  - bedrock_agent_action Lambda already deployed (see deploy.sh)
  - pip install boto3

Usage:
  python scripts/setup_bedrock_agent.py

  # Or specify a custom region and Lambda ARN:
  AGENT_REGION=us-east-1 ACTION_LAMBDA_ARN=arn:aws:lambda:... python scripts/setup_bedrock_agent.py
"""

import boto3
import json
import time
import os

# ── Config ─────────────────────────────────────────────────────────────────────

AGENT_REGION       = os.environ.get('AGENT_REGION',        'us-east-1')
APP_REGION         = os.environ.get('APP_REGION',           'ap-south-1')
ACCOUNT_ID         = os.environ.get('AWS_ACCOUNT_ID',       '')
ACTION_LAMBDA_NAME = 'bedrock-agent-action'

# Claude Sonnet 3.5 — best at tool use, available for Bedrock Agents in us-east-1
FOUNDATION_MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0'

AGENT_NAME       = 'BhashaHealthAgent'
AGENT_ALIAS_NAME = 'prod'
ACTION_GROUP     = 'HealthActions'

AGENT_INSTRUCTION = """
You are Bhasha AI, a compassionate health companion for Indian patients.
You support multiple Indian languages including Hindi, Telugu, Tamil, Marathi, Bengali, Gujarati, Kannada, Malayalam, Punjabi, and English.

Your role: Help patients understand their symptoms and find the right specialist nearby.

For EVERY health query, you MUST follow this exact sequence:
1. Call diagnose_symptoms — analyze what the patient likely has
2. Call find_hospitals — find the right specialist nearby based on the diagnosis
3. Call rank_hospitals — recommend the best hospital and prepare the patient

After all 3 tool calls complete, respond in the patient's language with a warm, empathetic 2-3 sentence summary:
- What condition they likely have and its severity
- Which hospital was recommended and why
- The urgency level and what they should do next

Rules:
- Always respond in the patient's preferred language (set in sessionAttributes.lang)
- Be empathetic and avoid medical jargon — you are talking to regular patients
- If urgency is "emergency", be very direct: "Go to the emergency room immediately"
- Never skip any of the 3 tool calls
- Mention the doctor's name / hospital name in your final response
- For routine cases, reassure the patient that help is nearby
""".strip()


# ── IAM setup ─────────────────────────────────────────────────────────────────

TRUST_POLICY = {
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "bedrock.amazonaws.com"},
        "Action": "sts:AssumeRole",
        "Condition": {
            "StringEquals": {"aws:SourceAccount": "ACCOUNT_ID_PLACEHOLDER"},
            "ArnLike": {"AWS:SourceArn": f"arn:aws:bedrock:{AGENT_REGION}:ACCOUNT_ID_PLACEHOLDER:agent/*"}
        }
    }]
}

AGENT_POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BedrockFoundationModel",
            "Effect": "Allow",
            "Action": "bedrock:InvokeModel",
            "Resource": f"arn:aws:bedrock:{AGENT_REGION}::foundation-model/{FOUNDATION_MODEL}"
        },
        {
            "Sid": "InvokeLambdaActionGroup",
            "Effect": "Allow",
            "Action": "lambda:InvokeFunction",
            "Resource": f"arn:aws:lambda:{AGENT_REGION}:ACCOUNT_ID_PLACEHOLDER:function:{ACTION_LAMBDA_NAME}"
        },
        {
            "Sid": "BedrockAgentMemory",
            "Effect": "Allow",
            "Action": [
                "bedrock:GetAgentMemory",
                "bedrock:DeleteAgentMemory"
            ],
            "Resource": "*"
        }
    ]
}

# ── Function schema for the 3 tools ───────────────────────────────────────────

FUNCTION_SCHEMA = {
    'functions': [
        {
            'name': 'diagnose_symptoms',
            'description': (
                'Analyze patient symptoms using medical AI (Comprehend Medical NLP + '
                'Nova Pro clinical reasoning + optional image analysis). '
                'Returns: condition, severity, specialty_needed, urgency, red_flags, '
                'action_steps, questions_for_doctor. '
                'ALWAYS call this FIRST before finding hospitals.'
            ),
            'parameters': {
                'symptoms': {
                    'type': 'string',
                    'description': 'Patient symptom description in their own words',
                    'required': True,
                },
                'lang': {
                    'type': 'string',
                    'description': 'Language code: en/hi/te/ta/mr/bn/gu/kn/ml/pa',
                    'required': False,
                },
            },
        },
        {
            'name': 'find_hospitals',
            'description': (
                'Find nearby hospitals and clinics for a given medical specialty. '
                'Uses Google Places API (if configured) or OpenStreetMap as fallback. '
                'Emergency cases search a smaller radius to find the fastest option. '
                'Call this SECOND after diagnose_symptoms. '
                'Use the specialty_needed from the diagnosis result.'
            ),
            'parameters': {
                'specialty': {
                    'type': 'string',
                    'description': 'Medical specialty (e.g. Cardiologist, General Physician, Orthopedic)',
                    'required': True,
                },
                'urgency': {
                    'type': 'string',
                    'description': 'emergency | urgent | routine — affects search radius',
                    'required': False,
                },
            },
        },
        {
            'name': 'rank_hospitals',
            'description': (
                'Rank the found hospitals for this patient and generate a tailored '
                'visit preparation guide including: questions to ask the doctor, '
                'what documents to bring, transport advice, and urgency timing. '
                'Call this LAST after find_hospitals. '
                'Returns the best hospital recommendation and full prep guide.'
            ),
            'parameters': {
                'specialty': {
                    'type': 'string',
                    'description': 'Medical specialty (from diagnosis)',
                    'required': False,
                },
            },
        },
    ]
}


# ── Helper: wait for agent status ─────────────────────────────────────────────

def wait_for_status(bedrock, agent_id, target_status, timeout=120):
    print(f'  Waiting for agent status: {target_status}...', end='', flush=True)
    start = time.time()
    while time.time() - start < timeout:
        resp = bedrock.get_agent(agentId=agent_id)
        status = resp['agent']['agentStatus']
        if status == target_status:
            print(f' {status}')
            return True
        if 'FAILED' in status:
            print(f'\n  ERROR: Agent status = {status}')
            return False
        print('.', end='', flush=True)
        time.sleep(5)
    print(f'\n  TIMEOUT after {timeout}s')
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print('\n' + '=' * 60)
    print('  Bhasha AI — Bedrock Agent Setup')
    print('=' * 60 + '\n')

    # Resolve account ID
    sts = boto3.client('sts')
    account_id = ACCOUNT_ID or sts.get_caller_identity()['Account']
    print(f'AWS Account ID : {account_id}')
    print(f'Agent Region   : {AGENT_REGION}')
    print(f'App Region     : {APP_REGION}')

    iam     = boto3.client('iam')
    bedrock = boto3.client('bedrock-agent', region_name=AGENT_REGION)
    lam     = boto3.client('lambda', region_name=AGENT_REGION)

    # Resolve Lambda ARN
    try:
        lambda_resp = lam.get_function(FunctionName=ACTION_LAMBDA_NAME)
        action_lambda_arn = lambda_resp['Configuration']['FunctionArn']
        print(f'Action Lambda  : {action_lambda_arn}')
    except Exception as e:
        print(f'\nERROR: Cannot find Lambda "{ACTION_LAMBDA_NAME}" in {AGENT_REGION}.')
        print(f'  Deploy it first: bash deploy.sh')
        print(f'  Or set ACTION_LAMBDA_ARN env var.\n')
        print(f'  Details: {e}')
        return

    # ── Step 1: IAM Role ──────────────────────────────────────────────────────
    print('\n[1/5] Creating IAM role for Bedrock Agent...')
    role_name = 'bhasha-bedrock-agent-role'

    trust = json.dumps(TRUST_POLICY).replace('ACCOUNT_ID_PLACEHOLDER', account_id)
    policy = json.dumps(AGENT_POLICY) \
        .replace('ACCOUNT_ID_PLACEHOLDER', account_id) \
        .replace(
            f'arn:aws:lambda:{AGENT_REGION}:ACCOUNT_ID_PLACEHOLDER:function:{ACTION_LAMBDA_NAME}',
            action_lambda_arn
        )

    try:
        role_resp = iam.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=trust,
            Description='Role for Bhasha AI Bedrock Agent',
        )
        role_arn = role_resp['Role']['Arn']
        iam.put_role_policy(
            RoleName=role_name,
            PolicyName='BhashaAgentPolicy',
            PolicyDocument=policy,
        )
        print(f'  Created: {role_arn}')
        time.sleep(10)  # IAM propagation delay
    except iam.exceptions.EntityAlreadyExistsException:
        role_arn = iam.get_role(RoleName=role_name)['Role']['Arn']
        iam.put_role_policy(
            RoleName=role_name,
            PolicyName='BhashaAgentPolicy',
            PolicyDocument=policy,
        )
        print(f'  Using existing role: {role_arn}')
        time.sleep(5)

    # ── Step 2: Create Agent ───────────────────────────────────────────────────
    print(f'\n[2/5] Creating Bedrock Agent "{AGENT_NAME}"...')
    try:
        agent_resp = bedrock.create_agent(
            agentName=AGENT_NAME,
            foundationModel=FOUNDATION_MODEL,
            instruction=AGENT_INSTRUCTION,
            agentResourceRoleArn=role_arn,
            idleSessionTTLInSeconds=1800,
            memoryConfiguration={
                'enabledMemoryTypes': ['SESSION_SUMMARY'],
                'storageDays': 30,
            },
            description='Bhasha AI health companion — symptom diagnosis + hospital finder + visit prep',
        )
        agent_id = agent_resp['agent']['agentId']
        print(f'  Agent ID: {agent_id}')
    except bedrock.exceptions.ConflictException:
        # Agent already exists — find it
        agents = bedrock.list_agents()['agentSummaries']
        existing = [a for a in agents if a['agentName'] == AGENT_NAME]
        if not existing:
            print('  ERROR: ConflictException but agent not found in list. Check console.')
            return
        agent_id = existing[0]['agentId']
        print(f'  Using existing agent: {agent_id}')

    # Wait for agent to be in a usable state
    wait_for_status(bedrock, agent_id, 'NOT_PREPARED')

    # ── Step 3: Create Action Group ────────────────────────────────────────────
    print(f'\n[3/5] Creating Action Group "{ACTION_GROUP}"...')
    try:
        bedrock.create_agent_action_group(
            agentId=agent_id,
            agentVersion='DRAFT',
            actionGroupName=ACTION_GROUP,
            actionGroupExecutor={'lambda': action_lambda_arn},
            functionSchema={'functions': FUNCTION_SCHEMA['functions']},
            actionGroupState='ENABLED',
            description='Health tools: diagnose symptoms, find hospitals, rank and prepare',
        )
        print(f'  Action group created')
    except bedrock.exceptions.ConflictException:
        print(f'  Action group already exists')

    # ── Step 4: Add Lambda permission for Bedrock Agent ───────────────────────
    print('\n[4/5] Adding Lambda resource policy for Bedrock Agent...')
    try:
        lam.add_permission(
            FunctionName=action_lambda_arn,
            StatementId='AllowBedrockAgent',
            Action='lambda:InvokeFunction',
            Principal='bedrock.amazonaws.com',
            SourceArn=f'arn:aws:bedrock:{AGENT_REGION}:{account_id}:agent/{agent_id}',
        )
        print('  Permission added')
    except lam.exceptions.ResourceConflictException:
        print('  Permission already exists')

    # ── Step 5: Prepare Agent ──────────────────────────────────────────────────
    print('\n[5/6] Preparing agent (compiling)...')
    bedrock.prepare_agent(agentId=agent_id)
    wait_for_status(bedrock, agent_id, 'PREPARED')

    # ── Step 6: Create Alias ───────────────────────────────────────────────────
    print('\n[6/6] Creating production alias...')
    try:
        alias_resp = bedrock.create_agent_alias(
            agentId=agent_id,
            agentAliasName=AGENT_ALIAS_NAME,
            description='Production alias for Bhasha AI health agent',
        )
        alias_id = alias_resp['agentAlias']['agentAliasId']
        print(f'  Alias ID: {alias_id}')
    except bedrock.exceptions.ConflictException:
        aliases = bedrock.list_agent_aliases(agentId=agent_id)['agentAliasSummaries']
        existing = [a for a in aliases if a['agentAliasName'] == AGENT_ALIAS_NAME]
        if existing:
            alias_id = existing[0]['agentAliasId']
            print(f'  Using existing alias: {alias_id}')
        else:
            alias_id = 'TSTALIASID'
            print(f'  Could not create alias, using draft: {alias_id}')

    # ── Output ─────────────────────────────────────────────────────────────────
    print('\n' + '=' * 60)
    print('  Setup Complete!')
    print('=' * 60)
    print(f'\n  Agent ID    : {agent_id}')
    print(f'  Alias ID    : {alias_id}')
    print(f'  Region      : {AGENT_REGION}')
    print('\n  Add these to your .env.deploy:')
    print(f'  BEDROCK_AGENT_ID={agent_id}')
    print(f'  BEDROCK_AGENT_ALIAS_ID={alias_id}')
    print(f'  BEDROCK_AGENT_REGION={AGENT_REGION}')
    print('\n  Then run: bash deploy.sh')
    print('  The invoker Lambda will be configured with these IDs automatically.\n')

    # Save to file for deploy.sh to use
    with open('scripts/.agent_ids', 'w') as f:
        f.write(f'BEDROCK_AGENT_ID={agent_id}\n')
        f.write(f'BEDROCK_AGENT_ALIAS_ID={alias_id}\n')
        f.write(f'BEDROCK_AGENT_REGION={AGENT_REGION}\n')
    print('  Saved to scripts/.agent_ids (loaded by deploy.sh automatically)')


if __name__ == '__main__':
    main()
