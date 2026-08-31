"""
SKNLP Info Hub — one-time backfill: attach real timestamped
transcript_segments to claims that were approved before that feature
existed (run_ingestion.py now creates these automatically for every new
claim going forward; this script is only for what predates that).

Re-extracts the same video fresh (Gemini has no memory between calls, so
this is a real, independent extraction, not a cache read), then matches
each EXISTING claim linked to the given source to whichever freshly
re-extracted candidate claim has the most similar title (pg_trgm
similarity — same tool already used elsewhere in this project to find
real duplicate claims). Greedy, one fresh candidate used at most once,
and a similarity floor below which a claim is skipped with a warning
rather than force a wrong link — titles can vary slightly between
separate extraction calls (confirmed earlier this session), so this is
matching, not an exact-string join.

Idempotent: only considers existing claims that don't already have a
transcript_segments link, so re-running this after some claims are
already backfilled only touches what's still missing.

Usage:
    python backfill_segments.py --source-id <uuid>
    python backfill_segments.py --source-id <uuid> --dry-run
"""

import argparse
import json
import os
import sys

import psycopg2
import psycopg2.extras

from extract_from_video import extract
from segment_utils import mmss_to_seconds, compute_segment_window

SIMILARITY_FLOOR = 0.3


def get_db_connection():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set DATABASE_URL before running.", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(dsn)


def fetch_source(conn, source_id: str) -> dict:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, origin_url, source_type FROM sources WHERE id = %s", (source_id,))
        row = cur.fetchone()
        if not row:
            print(f"No sources row found for id {source_id}", file=sys.stderr)
            sys.exit(1)
        return row


def fetch_unbackfilled_claims(conn, source_id: str) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT c.id, c.title
               FROM claims c
               JOIN claim_sources cs ON cs.claim_id = c.id
               LEFT JOIN claim_transcript_segments cts ON cts.claim_id = c.id
               WHERE cs.source_id = %s AND cts.claim_id IS NULL""",
            (source_id,),
        )
        return cur.fetchall()


def title_similarity(conn, a: str, b: str) -> float:
    with conn.cursor() as cur:
        cur.execute("SELECT similarity(%s, %s)", (a, b))
        return cur.fetchone()[0]


def backfill(source_id: str, dry_run: bool = False) -> dict:
    conn = get_db_connection()
    try:
        source = fetch_source(conn, source_id)
        existing_claims = fetch_unbackfilled_claims(conn, source_id)
        if not existing_claims:
            return {"source_id": source_id, "message": "No unbackfilled claims for this source.", "matches": []}

        print(f"Re-extracting {source['origin_url']} to get real timestamps...", file=sys.stderr)
        extraction = extract(source["origin_url"], source["source_type"], category_hint="")
        fresh_claims = extraction.get("candidate_claims", [])
        raw_segments = extraction.get("segments", [])
        print(f"Fresh extraction: {len(fresh_claims)} candidate claim(s) to match against {len(existing_claims)} existing.", file=sys.stderr)

        # Greedy best-match: for each existing claim, pick the most similar
        # not-yet-used fresh candidate; skip (don't force) below the floor.
        used_fresh_indices = set()
        matches = []
        for existing in existing_claims:
            best_idx, best_score = None, -1.0
            for i, fresh in enumerate(fresh_claims):
                if i in used_fresh_indices:
                    continue
                score = title_similarity(conn, existing["title"], fresh["title"])
                if score > best_score:
                    best_idx, best_score = i, score

            if best_idx is None or best_score < SIMILARITY_FLOOR:
                print(f"  SKIP: {existing['title']!r} — no fresh candidate matched above {SIMILARITY_FLOOR} (best={best_score:.3f})", file=sys.stderr)
                continue

            used_fresh_indices.add(best_idx)
            matches.append({"claim_id": str(existing["id"]), "claim_title": existing["title"], "fresh": fresh_claims[best_idx], "similarity": round(best_score, 3)})
            print(f"  MATCH ({best_score:.3f}): {existing['title']!r} <- {fresh_claims[best_idx]['title']!r} @ {fresh_claims[best_idx]['start_timestamp']}", file=sys.stderr)

        if dry_run:
            return {"source_id": source_id, "dry_run": True, "matches": matches}

        claim_seconds_list = sorted(
            {s for s in (mmss_to_seconds(m["fresh"]["start_timestamp"]) for m in matches) if s is not None}
        )

        segments_created = 0
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                for m in matches:
                    claim_seconds = mmss_to_seconds(m["fresh"]["start_timestamp"])
                    if claim_seconds is None:
                        print(f"  Warning: matched fresh candidate for {m['claim_title']!r} has no parseable timestamp; skipping.", file=sys.stderr)
                        continue
                    end_seconds, speaker_title_at_time = compute_segment_window(claim_seconds, raw_segments, claim_seconds_list)
                    cur.execute(
                        """INSERT INTO transcript_segments
                               (source_id, start_seconds, end_seconds, text, speaker_title_at_time)
                           VALUES (%s, %s, %s, %s, %s)
                           RETURNING id""",
                        (source_id, claim_seconds, end_seconds, m["fresh"]["summary"], speaker_title_at_time),
                    )
                    segment_id = cur.fetchone()["id"]
                    cur.execute(
                        "INSERT INTO claim_transcript_segments (claim_id, segment_id) VALUES (%s, %s)",
                        (m["claim_id"], segment_id),
                    )
                    segments_created += 1

        return {"source_id": source_id, "matches": matches, "segments_created": segments_created}
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill transcript_segments for claims approved before deep-linking existed.")
    parser.add_argument("--source-id", required=True, help="sources.id (UUID) whose claims need backfilling")
    parser.add_argument("--dry-run", action="store_true", help="Match only, print JSON, no DB writes")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    result = backfill(args.source_id, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
