"""
prepare_kb_docs.py

Downloads MedRAG textbook chunks + PMC open-access papers from Hugging Face,
converts them to plain text files, and uploads to S3 for Bedrock Knowledge Base.

Usage:
  pip install datasets boto3 tqdm
  python prepare_kb_docs.py --bucket YOUR_S3_BUCKET --prefix kb-docs/

The script creates files like:
  s3://YOUR_BUCKET/kb-docs/textbooks/grays_anatomy_chunk_001.txt
  s3://YOUR_BUCKET/kb-docs/pmc/pmc_chunk_00001.txt

Then in AWS Console:
  Bedrock → Knowledge Bases → Create → point to s3://YOUR_BUCKET/kb-docs/
"""

import argparse
import os
import re
import boto3
from tqdm import tqdm

# ── Args ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--bucket',         required=True,  help='S3 bucket name')
parser.add_argument('--prefix',         default='kb-docs/', help='S3 key prefix')
parser.add_argument('--textbooks',      action='store_true', default=True,
                    help='Include MedRAG textbook chunks (default: True)')
parser.add_argument('--pmc',            action='store_true', default=False,
                    help='Include PMC open-access papers (slower, ~4.8M papers)')
parser.add_argument('--pmc-limit',      type=int, default=50000,
                    help='Max PMC chunks to upload (default 50k ≈ ~200MB)')
parser.add_argument('--textbook-limit', type=int, default=0,
                    help='Max textbook chunks (0 = all, ~180k chunks)')
parser.add_argument('--local-only',     action='store_true',
                    help='Save to ./kb_output/ instead of uploading to S3')
args = parser.parse_args()

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9_]', '_', text.lower())[:60]

def upload_or_save(content: str, key: str):
    if args.local_only:
        path = os.path.join('kb_output', key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
    else:
        s3.put_object(
            Bucket=args.bucket,
            Key=f"{args.prefix}{key}",
            Body=content.encode('utf-8'),
            ContentType='text/plain',
        )

# ── S3 client + auto-create bucket ───────────────────────────────────────────

if not args.local_only:
    s3 = boto3.client('s3')

    # Check bucket exists; create it if not
    try:
        s3.head_bucket(Bucket=args.bucket)
        print(f"Bucket s3://{args.bucket} found.")
    except s3.exceptions.ClientError:
        region = boto3.session.Session().region_name or 'ap-south-1'
        print(f"Bucket not found. Creating s3://{args.bucket} in {region} ...")
        if region == 'us-east-1':
            s3.create_bucket(Bucket=args.bucket)
        else:
            s3.create_bucket(
                Bucket=args.bucket,
                CreateBucketConfiguration={'LocationConstraint': region},
            )
        print(f"  ✓ Bucket created.")

    print(f"Uploading to s3://{args.bucket}/{args.prefix}")
else:
    print("Local mode — saving to ./kb_output/")

# ── 1. MedRAG Textbooks ───────────────────────────────────────────────────────
# HuggingFace: MedRAG/textbooks
# Contains pre-chunked text from 18 classic medical textbooks.
# Each row: { id, title, content, source (book name) }

if args.textbooks:
    print("\n── Loading MedRAG textbook chunks ──")
    try:
        from datasets import load_dataset
    except ImportError:
        print("Run: pip install datasets tqdm")
        raise

    ds = load_dataset("MedRAG/textbooks", split="train", trust_remote_code=True)
    total = len(ds) if not args.textbook_limit else min(args.textbook_limit, len(ds))
    print(f"  {len(ds):,} chunks available → uploading {total:,}")

    # Group by source book so Bedrock can attribute sources cleanly
    for i, row in enumerate(tqdm(ds.select(range(total)), desc="Textbooks")):
        source  = slugify(row.get('source') or row.get('title') or 'textbook')
        chunk_id = str(i).zfill(6)

        # Build a clean text file with metadata header
        content = (
            f"Source: {row.get('source', 'Medical Textbook')}\n"
            f"Section: {row.get('title', '')}\n"
            f"---\n"
            f"{row.get('content', row.get('text', ''))}"
        )

        upload_or_save(content, f"textbooks/{source}_{chunk_id}.txt")

    print(f"  ✓ Textbook chunks done ({total:,})")

# ── 2. PMC Open Access Papers ─────────────────────────────────────────────────
# HuggingFace: axiong/PMC_LLaMA_instructions  ← instruction pairs (smaller, practical)
# OR: ncats/MedRAG  ← the actual paper corpus used by MedRAG
#
# We use MedRAG/pubmed which has chunked PubMed abstracts + full-text snippets.
# These are 100% open access (NIH PMC license).

if args.pmc:
    print("\n── Loading PMC open-access chunks ──")
    ds_pmc = load_dataset("MedRAG/pubmed", split="train", trust_remote_code=True,
                           streaming=True)   # streaming → no full download needed

    count = 0
    for row in tqdm(ds_pmc, desc="PMC papers", total=args.pmc_limit):
        if count >= args.pmc_limit:
            break

        chunk_id = str(count).zfill(6)
        pmid = row.get('id', chunk_id)

        content = (
            f"Source: PubMed Central (PMID: {pmid})\n"
            f"Title: {row.get('title', '')}\n"
            f"---\n"
            f"{row.get('content', row.get('text', ''))}"
        )

        upload_or_save(content, f"pmc/pmc_{chunk_id}.txt")
        count += 1

    print(f"  ✓ PMC chunks done ({count:,})")

# ── Done ──────────────────────────────────────────────────────────────────────

print("\n✅ All done!")
if not args.local_only:
    print(f"\nNext steps:")
    print(f"  1. AWS Console → Bedrock → Knowledge Bases → Create Knowledge Base")
    print(f"  2. Data source: s3://{args.bucket}/{args.prefix}")
    print(f"  3. Embedding model: amazon.titan-embed-text-v2:0")
    print(f"  4. Vector store: OpenSearch Serverless (auto-create)")
    print(f"  5. Click 'Sync' and wait ~10 min")
    print(f"  6. Copy the Knowledge Base ID → set as KNOWLEDGE_BASE_ID in deep-analysis Lambda")
