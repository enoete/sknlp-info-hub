"""
SKNLP Info Hub — article ingestion run wrapper (SKNIS and similar
written government sources). Sibling to run_ingestion.py, same write
path and safety guarantees, adapted for extract_from_article.py's
text-only output (no segments/timestamps).

The one genuinely new piece here, not present in the video pipeline:
corroboration linking. Per explicit instruction (2026-08-31) --
"some of these will be duplicated by youtube, etc... this is where we
will be able to buttress sources by stating the various sources that
talk about the same thing" -- before inserting a brand new claim, this
checks whether an existing APPROVED claim already covers the same
specific fact (same stance/category, pg_trgm title similarity, then a
real LLM relevance check -- the same two-stage pattern that fixed the
Opposition Watch record-pairing bug, reused here because the failure
mode is the same: title/category similarity alone isn't reliable enough
to act on by itself). If a genuine match is found, this links the new
source to the EXISTING claim (an extra `claim_sources` row) instead of
creating a duplicate -- `claims.source_count` on the detail page will
show ">1 independent sources" the moment two sources report the same
fact, which the schema already supported but nothing had ever exercised.

Usage:
    python run_article_ingestion.py --registry-id <uuid> --url <article-url>
    python run_article_ingestion.py --registry-id <uuid> --url <article-url> --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from google import genai

from extract_from_article import extract_article, fetch_article
from extract_from_video import _generate_with_retry
from claim_dedup import find_matching_approved_claim as _find_matching_approved_claim
from run_ingestion import get_db_connection, fetch_registry_row, parse_suggested_date
from scope_config import ADMINISTRATION_START, in_scope


def find_matching_approved_claim(conn, client, title: str, summary: str, category: str, stance: str):
    # category param kept for call-site compatibility, no longer used --
    # see claim_dedup.py's module docstring for why the category filter
    # was dropped (it was the root cause of a real missed-duplicate bug).
    return _find_matching_approved_claim(conn, client, _generate_with_retry, title, summary, stance)


def ingest_one_article(conn, registry: dict, url: str, dry_run: bool = False, known_published_at=None, article_data: dict | None = None) -> dict:
    if known_published_at is not None and not in_scope(known_published_at):
        return {
            "registry_id": registry["id"],
            "skipped": True,
            "reason": f"published {known_published_at} is before the {ADMINISTRATION_START} scope cutoff",
        }

    source_type = registry["source_type"]
    article = article_data or fetch_article(url)

    print(f"Extracting from {url} (registry={registry['label']!r}, source_type={source_type})...", file=sys.stderr)
    extraction = extract_article(article["title"], article["body_text"], source_type)
    claims = extraction.get("candidate_claims", [])
    print(f"Extraction complete: {len(claims)} candidate claim(s), primary_speaker={extraction.get('primary_speaker', '')!r}.", file=sys.stderr)

    if dry_run:
        return {"dry_run": True, "registry_id": registry["id"], "url": url, "claims_count": len(claims), "extraction": extraction}

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    # ingestion_channel enum: 'sknis' is specific to sknis.gov.kn itself;
    # any other written-article registry row (WINN FM, Freedom FM, ...)
    # is the generic 'press_release' bucket -- confirmed needed the hard
    # way testing this same script against WINN FM/Freedom FM 2026-08-31,
    # which would otherwise have mislabeled every article from either as
    # literally "sknis" channel.
    channel = "sknis" if registry["platform"] == "sknis" else "press_release"

    with conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            primary_speaker = (extraction.get("primary_speaker") or "").strip() or None
            cur.execute(
                """INSERT INTO sources (registry_id, source_type, channel, title, speaker_org, speaker_name, origin_url, published_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    registry["id"],
                    source_type,
                    channel,
                    article["title"],
                    registry["label"],
                    primary_speaker,
                    url,
                    known_published_at,
                ),
            )
            source_id = cur.fetchone()["id"]

            claim_ids = []
            linked_count = 0
            new_count = 0
            for c in claims:
                existing_id = find_matching_approved_claim(conn, client, c["title"], c["summary"], c["category"], c["stance"])

                if existing_id:
                    cur.execute(
                        "INSERT INTO claim_sources (claim_id, source_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (existing_id, source_id),
                    )
                    claim_ids.append(str(existing_id))
                    linked_count += 1
                    print(f"  Linked to existing claim {existing_id} (corroborating source, not a duplicate).", file=sys.stderr)
                    continue

                cur.execute(
                    """INSERT INTO claims
                           (stance, title, summary, category, accomplishment_type, sentiment,
                            citizen_impact_suggested, event_date_suggested, featured,
                            extracted_by, extraction_confidence, review_status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'gemini_agent', %s, 'pending_review')
                       RETURNING id, review_status""",
                    (
                        c["stance"],
                        c["title"],
                        c["summary"],
                        c["category"],
                        None if c["accomplishment_type"] == "N/A" else c["accomplishment_type"],
                        c["sentiment"],
                        (c.get("citizen_impact_suggested") or "").strip() or None,
                        parse_suggested_date(c.get("event_date_suggested", "")),
                        c.get("featured", True),
                        c["extraction_confidence"],
                    ),
                )
                inserted = cur.fetchone()

                if inserted["review_status"] != "pending_review":
                    raise RuntimeError(
                        f"SAFETY VIOLATION: claim {inserted['id']} inserted with "
                        f"review_status={inserted['review_status']!r}, expected 'pending_review'. "
                        f"Aborting entire run — nothing will be committed."
                    )
                claim_ids.append(str(inserted["id"]))
                new_count += 1

                cur.execute(
                    "INSERT INTO claim_sources (claim_id, source_id) VALUES (%s, %s)",
                    (inserted["id"], source_id),
                )

            now = datetime.now(timezone.utc)
            cur.execute(
                """UPDATE sources_registry
                   SET last_checked_at = %s, last_new_item_at = COALESCE(%s, last_new_item_at)
                   WHERE id = %s""",
                (now, now if claims else None, registry["id"]),
            )

    return {
        "registry_id": registry["id"],
        "source_id": str(source_id),
        "url": url,
        "claim_ids": claim_ids,
        "new_claims": new_count,
        "linked_to_existing": linked_count,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run ingestion for one article URL against a sources_registry row.")
    parser.add_argument("--registry-id", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, args.registry_id)
        result = ingest_one_article(conn, registry, args.url, dry_run=args.dry_run)
    finally:
        conn.close()

    print(json.dumps(result, indent=2, default=str))
