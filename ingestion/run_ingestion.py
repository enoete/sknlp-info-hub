"""
SKNLP Info Hub — ingestion run wrapper (v0)

Takes a sources_registry row, runs the existing extract_from_video.py
pipeline against its handle_or_url, and writes the result into the real
database: one `sources` row for the video, one `claims` row per extracted
candidate (always review_status='pending_review' — see the safety note
below), a `claim_sources` link per claim, and updates
sources_registry.last_checked_at / last_new_item_at.

This is the standalone, direct-run mechanism only. It is NOT wired into
the Source Manager's "run now" button — that comes later, once this core
write path is independently proven (see CLAUDE.md).

Scope, deliberately: writes `sources` + `claims` + `claim_sources` +
`sources_registry` bookkeeping only. Does NOT touch `transcript_segments`
or `speakers` — per-claim video timestamps and speaker identification are
a separate, not-yet-wired pipeline (identify_speaker.py), and claims has
no column to hold a per-claim timestamp anyway (only `sources.video_timestamp`
exists, which is a whole-source field — doesn't fit a multi-claim video).

SAFETY: every claims row this script writes is verified, immediately
after INSERT and before the transaction commits, to actually carry
review_status='pending_review'. If that's ever untrue for any row, the
whole run aborts and rolls back — nothing partially lands. This is the
first mechanism in the project that can write claims without a human
typing the SQL by hand, so this boundary has zero tolerance for silent
exceptions.

Also never writes to claims.citizen_impact or claims.event_date directly
— those are human-confirmed-only columns (see schema.sql); this script
only ever writes the *_suggested counterparts, same as the extraction
schema already enforces.

Setup:
    pip install psycopg2-binary
    export GEMINI_API_KEY=your_key_here
    export DATABASE_URL=postgresql://user:pass@host:port/dbname

Usage:
    python run_ingestion.py --registry-id <uuid>
    python run_ingestion.py --registry-id <uuid> --dry-run   # extract only, print JSON, no DB writes
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone

import psycopg2
import psycopg2.extras

from extract_from_video import extract


def get_db_connection():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set DATABASE_URL before running.", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(dsn)


def fetch_registry_row(conn, registry_id: str) -> dict:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, label, platform, handle_or_url, source_type, tier
               FROM sources_registry WHERE id = %s AND deleted_at IS NULL""",
            (registry_id,),
        )
        row = cur.fetchone()
        if not row:
            print(f"No active sources_registry row found for id {registry_id}", file=sys.stderr)
            sys.exit(1)
        return row


def parse_suggested_date(raw: str):
    """event_date_suggested must be a real ISO date or NULL — never let a
    malformed string from the model crash the whole insert; drop it and
    warn instead, same conservative posture as everything else here."""
    if not raw or not raw.strip():
        return None
    try:
        return datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError:
        print(f"Warning: could not parse event_date_suggested={raw!r} as YYYY-MM-DD; storing NULL instead.", file=sys.stderr)
        return None


def run_ingestion(registry_id: str, dry_run: bool = False) -> dict:
    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, registry_id)
        youtube_url = registry["handle_or_url"]
        source_type = registry["source_type"]

        print(f"Extracting from {youtube_url} (registry={registry['label']!r}, source_type={source_type})...", file=sys.stderr)
        extraction = extract(youtube_url, source_type, category_hint="")
        metadata = extraction.get("_video_metadata", {}) or {}
        claims = extraction.get("candidate_claims", [])
        print(f"Extraction complete: video_summary={extraction.get('video_summary', '')[:80]!r}, {len(claims)} candidate claim(s).", file=sys.stderr)

        if dry_run:
            return {"dry_run": True, "registry_id": registry_id, "claims_count": len(claims), "extraction": extraction}

        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO sources (registry_id, source_type, channel, title, speaker_org, origin_url)
                       VALUES (%s, %s, 'youtube', %s, %s, %s)
                       RETURNING id""",
                    (
                        registry["id"],
                        source_type,
                        metadata.get("title") or youtube_url,
                        metadata.get("channel") or None,
                        youtube_url,
                    ),
                )
                source_id = cur.fetchone()["id"]

                claim_ids = []
                for c in claims:
                    cur.execute(
                        """INSERT INTO claims
                               (stance, title, summary, category, sentiment,
                                citizen_impact_suggested, event_date_suggested,
                                extracted_by, extraction_confidence, review_status)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, 'gemini_agent', %s, 'pending_review')
                           RETURNING id, review_status""",
                        (
                            c["stance"],
                            c["title"],
                            c["summary"],
                            c["category"],
                            c["sentiment"],
                            (c.get("citizen_impact_suggested") or "").strip() or None,
                            parse_suggested_date(c.get("event_date_suggested", "")),
                            c["extraction_confidence"],
                        ),
                    )
                    inserted = cur.fetchone()

                    # Hard safety gate: this is the one thing this script is
                    # never allowed to get wrong. Any deviation aborts the
                    # whole transaction (the `with conn:` block rolls back
                    # on exception) rather than let a single bad row through.
                    if inserted["review_status"] != "pending_review":
                        raise RuntimeError(
                            f"SAFETY VIOLATION: claim {inserted['id']} inserted with "
                            f"review_status={inserted['review_status']!r}, expected 'pending_review'. "
                            f"Aborting entire run — nothing will be committed."
                        )
                    claim_ids.append(str(inserted["id"]))

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
            "registry_id": registry_id,
            "source_id": str(source_id),
            "claim_ids": claim_ids,
            "claims_count": len(claim_ids),
        }
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run ingestion for one sources_registry row and write results to the DB.")
    parser.add_argument("--registry-id", required=True, help="sources_registry.id (UUID) to ingest")
    parser.add_argument("--dry-run", action="store_true", help="Extract only, print JSON, no DB writes")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    result = run_ingestion(args.registry_id, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
