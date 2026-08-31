"""
One-time backfill: classify existing approved claims (ingested before
claims.featured existed, or before extract_from_video.py/
extract_from_article.py wrote it directly) into featured/not-featured.
Everything ingested going forward gets this from the extraction agent
directly; this is only for the ~440 claims that predate it.

Prompted directly, 2026-08-31: "we need to do a site-wide audit and make
sure we're not importing noise and generic news items... Rescuing people
from a sinking ship is good. Arresting people, etc... not for this
initiative... some of the stuff can be used to answer chatbot-related
questions right? But some of them just do not need to be front facing."
featured=false never touches review_status, retrieval (Ask the Record),
or Opposition Watch -- see schema.sql's claims.featured comment. This is
purely about what belongs in the curated Dashboard/Timeline grid.

Same batched-Gemini-classification pattern as backfill_accomplishment_type.py.
Defaults to a dry run; pass --apply to actually UPDATE.

Usage:
    python backfill_featured.py            # dry run, prints only
    python backfill_featured.py --apply    # writes to the DB
"""

import argparse
import json
import os
import sys

import psycopg2
import psycopg2.extras
from google import genai

from extract_from_video import _generate_with_retry

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
                    "featured": {"type": "boolean"},
                },
                "required": ["id", "featured"],
            },
        }
    },
    "required": ["classifications"],
}


def build_prompt(batch: list) -> str:
    items = "\n".join(f"- id={c['id']}: \"{c['title']}\" — {c['summary']}" for c in batch)
    return f"""
For each claim below, decide featured (true/false):

true = genuine government policy, decision, project, budget item, or
initiative (or, for an opposition_statement, a specific documented
allegation about government performance).

false = a real, worth-keeping-searchable claim that is nonetheless an
isolated incident rather than a policy/decision -- a specific rescue
operation, a specific arrest, a routine crime-statistic mention, a
ceremonial or social event with no policy content, general human-interest
news. Rule of thumb: could this specific fact reasonably be described
using one of "Accomplishment / Policy Decision / Strategic Decision /
Ongoing Initiative"? If not, it's very likely false, not a stretch to
force it into one anyway.

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
    return {c["id"]: c["featured"] for c in result["classifications"]}


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
               WHERE review_status = 'approved'
               ORDER BY created_at"""
        )
        claims = cur.fetchall()

    print(f"{len(claims)} approved claim(s) to classify.", file=sys.stderr)
    if not claims:
        return

    all_classifications = {}
    for i in range(0, len(claims), BATCH_SIZE):
        batch = [dict(c, id=str(c["id"])) for c in claims[i:i + BATCH_SIZE]]
        print(f"Classifying batch {i // BATCH_SIZE + 1} ({len(batch)} claims)...", file=sys.stderr)
        result = classify_batch(client, batch)
        all_classifications.update(result)

    by_id = {str(c["id"]): c for c in claims}
    not_featured = 0
    for claim_id, featured in all_classifications.items():
        title = by_id.get(claim_id, {}).get("title", "?")
        if not featured:
            not_featured += 1
            print(f"NOT FEATURED   {title}")

    missing = [str(c["id"]) for c in claims if str(c["id"]) not in all_classifications]
    if missing:
        print(f"WARNING: {len(missing)} claim(s) got no classification back, left untouched: {missing}", file=sys.stderr)

    print(f"\n{not_featured} of {len(claims)} would be marked featured=false; the rest stay featured=true.", file=sys.stderr)

    if not args.apply:
        print("\nDry run only -- rerun with --apply to write these to the DB.", file=sys.stderr)
        conn.close()
        return

    with conn:
        with conn.cursor() as cur:
            for claim_id, featured in all_classifications.items():
                if not featured:
                    cur.execute("UPDATE claims SET featured = false WHERE id = %s", (claim_id,))
    print(f"\nApplied: {not_featured} claim(s) set to featured=false.", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
