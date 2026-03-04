"""
deploy_gemma_sagemaker.py

Deploys google/gemma-3-27b-it to Amazon SageMaker using the
HuggingFace TGI (Text Generation Inference) container.

Requirements:
  pip install sagemaker boto3

Prerequisites:
  1. Accept Gemma 3 terms at: https://huggingface.co/google/gemma-3-27b-it
  2. Create HuggingFace token at: https://huggingface.co/settings/tokens
  3. AWS account with SageMaker access
  4. Run setup_infra.sh first (creates bhasha-lambda-role)

Usage:
  python scripts/deploy_gemma_sagemaker.py --hf-token hf_xxxx

The script prints the endpoint name when done.
Set it in .env.deploy as:  SAGEMAKER_ENDPOINT=bhasha-gemma3-27b
"""

import argparse
import boto3
import sagemaker
from sagemaker.huggingface import HuggingFaceModel

# ── Args ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--hf-token',       required=True,
                    help='HuggingFace token (accept Gemma 3 terms first)')
parser.add_argument('--region',         default='ap-south-1')
parser.add_argument('--endpoint-name',  default='bhasha-gemma3-27b')
parser.add_argument('--instance-type',  default='ml.g5.12xlarge',
                    help='Instance with enough VRAM. g5.12xlarge=4×A10G (96GB) recommended')
parser.add_argument('--quantize',       default='bitsandbytes-nf4',
                    help='Quantization (bitsandbytes-nf4 cuts VRAM by ~4×, fits g5.12xlarge)')
args = parser.parse_args()

# ── SageMaker session ─────────────────────────────────────────────────────────

boto_session  = boto3.Session(region_name=args.region)
sm_session    = sagemaker.Session(boto_session=boto_session)
role_arn      = boto3.client('iam', region_name=args.region)\
                      .get_role(RoleName='bhasha-lambda-role')['Role']['Arn']

print(f"\nDeploying google/gemma-3-27b-it")
print(f"  Region   : {args.region}")
print(f"  Instance : {args.instance_type}")
print(f"  Quantize : {args.quantize}")
print(f"  Endpoint : {args.endpoint_name}")
print(f"  Role     : {role_arn}")
print()

# ── HuggingFace TGI container config ─────────────────────────────────────────

# TGI environment — these control the inference server
env = {
    'HF_MODEL_ID':                  'google/gemma-3-27b-it',
    'HF_TOKEN':                     args.hf_token,
    'SM_NUM_GPUS':                  '4',         # g5.12xlarge has 4 GPUs
    'MAX_INPUT_LENGTH':             '4096',
    'MAX_TOTAL_TOKENS':             '6144',
    'MAX_BATCH_PREFILL_TOKENS':     '4096',
    'HUGGING_FACE_HUB_TOKEN':       args.hf_token,
}

if args.quantize:
    env['QUANTIZE'] = args.quantize

# HuggingFace TGI container (use latest stable version)
# Check latest at: https://github.com/aws/deep-learning-containers/blob/master/available_images.md
llm_image = sagemaker.image_uris.retrieve(
    framework='huggingface',
    region=args.region,
    version='2.1.1',         # TGI version
    py_version='py310',
    image_scope='inference',
    instance_type=args.instance_type,
)

print(f"Container: {llm_image}")

# ── Create model + deploy ─────────────────────────────────────────────────────

model = HuggingFaceModel(
    image_uri=llm_image,
    env=env,
    role=role_arn,
    sagemaker_session=sm_session,
)

# Check if endpoint already exists
sm_client = boto3.client('sagemaker', region_name=args.region)
try:
    sm_client.describe_endpoint(EndpointName=args.endpoint_name)
    print(f"⚠️  Endpoint '{args.endpoint_name}' already exists. Delete it first if you want to redeploy.")
    print(f"   aws sagemaker delete-endpoint --endpoint-name {args.endpoint_name} --region {args.region}")
    exit(0)
except sm_client.exceptions.ClientError:
    pass   # Doesn't exist yet — proceed

print("\nDeploying... (this takes 10-15 minutes)")
print("You can monitor in: AWS Console → SageMaker → Endpoints")

predictor = model.deploy(
    initial_instance_count=1,
    instance_type=args.instance_type,
    endpoint_name=args.endpoint_name,
    container_startup_health_check_timeout=900,  # 15 min for model download
)

# ── Done ──────────────────────────────────────────────────────────────────────

print(f"\n✅ Deployed! Endpoint: {args.endpoint_name}")
print(f"\nAdd to .env.deploy:")
print(f"  SAGEMAKER_ENDPOINT={args.endpoint_name}")
print(f"\nThen re-run:  bash deploy.sh")
print(f"\nEstimated cost: ~$4–7/hour (ml.g5.12xlarge)")
print("Delete when done:  aws sagemaker delete-endpoint "
      f"--endpoint-name {args.endpoint_name} --region {args.region}")
