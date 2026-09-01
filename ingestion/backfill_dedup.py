"""
One-time backfill: merge existing duplicate claims that predate
claim_dedup.py being wired into both ingestion pipelines (2026-08-31).
Confirmed real: the EC$250 back-to-school voucher announcement existed
as four separate claims (Talk SKN, Straight Talk, two SKNIS articles)
before the fix -- this finds and merges other clusters like it.

Same two-stage approach as claim_dedup.py, applied retroactively: for
each pair of approved claims sharing a stance, pg_trgm similarity on
title+summary combined narrows to real candidates, then one LLM call
per pair confirms it's actually the same specific fact before merging.
Merges by keeping the OLDER claim (created_at) as canonical -- arbitrary
but stable -- relinking every claim_sources/claim_transcript_segments
row from the duplicate onto the canonical claim, then rejecting the
duplicate. Never deletes a source or a citation, only consolidates which
claim they point at.

Defaults to a dry run (prints proposed merges only). Pass --apply to
actually write them.

Usage:
    python backfill_dedup.py              # dry run, prints only
    python backfill_dedup.py --apply      # writes to the DB
"""

import argparse
import os
import sys

import psycopg2
import psycopg2.extras
from google import genai

from claim_dedup import _is_same_claim
from extract_from_video import _generate_with_retry

# claim_dedup.py's MIN_SIMILARITY (0.2) is tuned for the LIVE path, where
# it's cheap by construction -- one new claim checked against at most
# CANDIDATE_LIMIT=5 existing ones. This script instead compares EVERY
# approved claim against every other approved claim of the same stance
# (all-pairs), so the same low threshold is a real scale mistake: a real
# run against ~600 claims found 11,550 "candidate" pairs at 0.2, which
# would mean 11,550 LLM calls -- hours, real cost, mostly noise. Confirmed
# empirically (2026-08-31, a manual audit before this script existed)
# that genuine duplicate clusters score >= 0.45 on this same
# title+summary-combined metric; below that is normal topical overlap
# between distinct claims, not a duplicate signal. Bulk sweep only, not
# used by the live per-claim path.
BULK_MIN_SIMILARITY = 0.45


def find_duplicate_pairs(conn) -> list[dict]:
    # Widened from approved-only to approved+pending_review 2026-08-31,
    # same day as the live-path widening in claim_dedup.py -- a live
    # audit found real duplicate clusters sitting in the pending queue
    # itself (never compared to each other since the original live-path
    # matching only checked against already-approved claims). Rejected
    # claims are excluded either way (already handled or intentionally
    # discarded, never a merge candidate).
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT a.id AS id_a, a.title AS title_a, a.summary AS summary_a, a.created_at AS created_a, a.review_status AS status_a,
                      b.id AS id_b, b.title AS title_b, b.summary AS summary_b, b.created_at AS created_b, b.review_status AS status_b,
                      similarity(a.title || ' ' || a.summary, b.title || ' ' || b.summary) AS sim
               FROM claims a JOIN claims b ON a.id < b.id
               WHERE a.stance = b.stance
                 AND a.review_status IN ('approved', 'pending_review')
                 AND b.review_status IN ('approved', 'pending_review')
                 AND similarity(a.title || ' ' || a.summary, b.title || ' ' || b.summary) > %s
               ORDER BY sim DESC""",
            (BULK_MIN_SIMILARITY,),
        )
        return cur.fetchall()


def merge_claim(conn, canonical_id, duplicate_id, apply: bool):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if not apply:
            cur.execute("SELECT source_id FROM claim_sources WHERE claim_id = %s", (duplicate_id,))
            return [str(r["source_id"]) for r in cur.fetchall()]

        cur.execute(
            "INSERT INTO claim_sources (claim_id, source_id) "
            "SELECT %s, source_id FROM claim_sources WHERE claim_id = %s "
            "ON CONFLICT DO NOTHING",
            (canonical_id, duplicate_id),
        )
        cur.execute(
            "INSERT INTO claim_transcript_segments (claim_id, segment_id) "
            "SELECT %s, segment_id FROM claim_transcript_segments WHERE claim_id = %s "
            "ON CONFLICT DO NOTHING",
            (canonical_id, duplicate_id),
        )
        cur.execute("UPDATE claims SET review_status = 'rejected' WHERE id = %s", (duplicate_id,))
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
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

    pairs = find_duplicate_pairs(conn)
    print(f"{len(pairs)} candidate pair(s) above similarity {BULK_MIN_SIMILARITY} to check.", file=sys.stderr)

    # A claim already merged away in this same run must not be treated as
    # canonical for a later pair, or re-merged again -- track what's been
    # rejected so far and skip any pair touching it.
    already_rejected: set[str] = set()
    merges = []

    for p in pairs:
        id_a, id_b = str(p["id_a"]), str(p["id_b"])
        if id_a in already_rejected or id_b in already_rejected:
            continue
        if not _is_same_claim(client, _generate_with_retry, p["title_a"], p["summary_a"], p["title_b"], p["summary_b"]):
            continue

        # Prefer an already-approved claim as canonical over a
        # pending_review one regardless of age (it's already been
        # human-vetted, don't discard that); otherwise keep the older
        # claim as canonical -- arbitrary but stable.
        if p["status_a"] == "approved" and p["status_b"] != "approved":
            a_is_canonical = True
        elif p["status_b"] == "approved" and p["status_a"] != "approved":
            a_is_canonical = False
        else:
            a_is_canonical = p["created_a"] <= p["created_b"]

        if a_is_canonical:
            canonical, canonical_title, duplicate, duplicate_title = id_a, p["title_a"], id_b, p["title_b"]
        else:
            canonical, canonical_title, duplicate, duplicate_title = id_b, p["title_b"], id_a, p["title_a"]

        print(f"MERGE: {duplicate_title!r} -> {canonical_title!r}")
        merge_claim(conn, canonical, duplicate, args.apply)
        already_rejected.add(duplicate)
        merges.append((canonical, duplicate))

    if args.apply:
        conn.commit()
        print(f"\nApplied {len(merges)} merge(s).", file=sys.stderr)
    else:
        print(f"\nDry run only -- {len(merges)} merge(s) would be applied. Rerun with --apply to write them.", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
