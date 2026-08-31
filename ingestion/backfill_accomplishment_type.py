"""
One-time backfill: classify existing approved accomplishment claims into
the new accomplishment_type taxonomy (see schema.sql's claims.accomplishment_type
comment and extract_from_video.py's ACCOMPLISHMENT_TYPES). Everything
ingested going forward gets this from the extraction agent directly;
claims approved before this field existed need a retroactive pass.

This is a metadata reclassification of already-approved claims, not new
unreviewed content -- same category of action as the earlier claims.year
derivation backfill (see CLAUDE.md's schema-status log) -- so it writes
directly via SQL rather than routing back through the pending_review
queue. Defaults to a dry run (prints the proposed classification for each
claim without writing anything); pass --apply to actually UPDATE.

Uses Gemini in batches (title+summary only, no video) to keep this to a
handful of calls instead of one per claim -- ~90 claims fits in ~6
batches of 15.

Usage:
    python backfill_accomplishment_type.py            # dry run, prints only
    python backfill_accomplishment_type.py --apply    # writes to the DB
"""

import argparse
import json
import os
import sys

import psycopg2
import psycopg2.extras
from google import genai

from extract_from_video import ACCOMPLISHMENT_TYPES, _generate_with_retry

BATCH_SIZE = 15

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "classifications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "accomplishment_type": {"type": "string", "enum": ACCOMPLISHMENT_TYPES},
                },
                "required": ["id", "accomplishment_type"],
            },
        }
    },
    "required": ["classifications"],
}


def build_prompt(batch: list) -> str:
    items = "\n".join(f"- id={c['id']}: \"{c['title']}\" — {c['summary']}" for c in batch)
    return f"""
Classify each claim below into exactly one accomplishment_type. Definitions:

- 'Accomplishment' = a completed, concrete deliverable — a project finished, a
  facility built/opened, a service actually launched, a benefit actually
  delivered.
- 'Policy Decision' = a formal policy/law/regulation/rate adopted or changed —
  decided and in effect, but not a physical thing built.
- 'Strategic Decision' = a directional commitment — a partnership, MOU,
  membership, framework agreement, or stated strategic plan — a choice of
  direction, not yet a specific delivered project or codified policy.
- 'Ongoing Initiative' = clearly still in progress — a program actively
  running, a groundbreaking/launch of a multi-phase effort, an expansion
  underway — explicitly not finished yet.

Base the classification only on what the title/summary actually states about
completion status. Return one classification per id, in the same order.

Claims:
{items}
"""


def classify_batch(client, batch: list) -> dict:
    response = _generate_with_retry(
        client,
        model="gemini-3.6-flash",
        contents=[{"text": build_prompt(batch)}],
        config={"response_mime_type": "application/json", "response_schema": CLASSIFY_SCHEMA},
    )
    result = json.loads(response.text)
    return {c["id"]: c["accomplishment_type"] for c in result["classifications"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write to the DB (default: dry run, print only)")
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set DATABASE_URL before running.", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, summary FROM claims
               WHERE stance = 'accomplishment' AND review_status = 'approved'
                 AND accomplishment_type IS NULL
               ORDER BY created_at"""
        )
        claims = cur.fetchall()

    print(f"{len(claims)} approved accomplishment claim(s) with no accomplishment_type yet.", file=sys.stderr)
    if not claims:
        return

    all_classifications = {}
    for i in range(0, len(claims), BATCH_SIZE):
        batch = [dict(c, id=str(c["id"])) for c in claims[i:i + BATCH_SIZE]]
        print(f"Classifying batch {i // BATCH_SIZE + 1} ({len(batch)} claims)...", file=sys.stderr)
        result = classify_batch(client, batch)
        all_classifications.update(result)

    by_id = {str(c["id"]): c for c in claims}
    for claim_id, acc_type in all_classifications.items():
        title = by_id.get(claim_id, {}).get("title", "?")
        print(f"{acc_type:20s} {title}")

    missing = [str(c["id"]) for c in claims if str(c["id"]) not in all_classifications]
    if missing:
        print(f"WARNING: {len(missing)} claim(s) got no classification back, left untouched: {missing}", file=sys.stderr)

    if not args.apply:
        print("\nDry run only -- rerun with --apply to write these to the DB.", file=sys.stderr)
        conn.close()
        return

    with conn:
        with conn.cursor() as cur:
            for claim_id, acc_type in all_classifications.items():
                cur.execute("UPDATE claims SET accomplishment_type = %s WHERE id = %s", (acc_type, claim_id))
    print(f"\nApplied {len(all_classifications)} classification(s).", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
