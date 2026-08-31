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

Scope: writes `sources` + `claims` + `claim_sources` + `sources_registry`
bookkeeping, plus one `transcript_segments` row per claim (linked via
`claim_transcript_segments`) so citations can deep-link to the actual
moment a claim was said, not just the bare video. Still does NOT touch
`speakers` — voice identification is a separate, not-yet-wired pipeline
(identify_speaker.py); transcript_segments.speaker_id stays NULL here.

The per-claim segment's start_seconds is real data straight from Gemini's
own start_timestamp for that claim — never guessed. end_seconds and the
speaker/role context are best-effort: end_seconds is capped at the next
claim's start (or the enclosing raw segment's own end_timestamp, or a
flat +20s fallback, whichever is known and smallest), and
speaker_title_at_time is borrowed from whichever raw `segments` entry
(Gemini's broader speaker-turn blocks, not stored on their own here)
actually contains the claim's timestamp. That's a reasonable citation
window, not a claim that these are precise utterance boundaries.

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

from extract_from_video import extract_with_chunking_fallback, normalize_accomplishment_type
from segment_utils import mmss_to_seconds, compute_segment_window
from scope_config import ADMINISTRATION_START, in_scope


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


def ingest_one_video(conn, registry: dict, youtube_url: str, dry_run: bool = False, known_published_at=None) -> dict:
    """The actual extract-then-write-to-DB logic for one video against one
    sources_registry row. Shared by the original single-URL CLI flow (the
    row's own handle_or_url IS the video) and run_channel_discovery.py
    (youtube_url is one of several videos discovered on a channel) — same
    safety guarantees either way: every claims row is verified
    pending_review before commit, nothing partial lands on failure.

    known_published_at, when the caller already has it (discovery does,
    from the RSS feed's <published> field), is a last defensive scope
    check right before any DB write — belt-and-suspenders alongside
    discovery's own upstream filter. The single-URL path has no cheap way
    to get a video's publish date (oEmbed doesn't return one), so it
    passes None here and relies on whoever picked that URL having already
    exercised judgment — same "don't block on absence" rule as
    scope_config.in_scope() itself."""
    if known_published_at is not None and not in_scope(known_published_at):
        return {
            "registry_id": registry["id"],
            "skipped": True,
            "reason": f"published {known_published_at} is before the {ADMINISTRATION_START} scope cutoff",
        }

    source_type = registry["source_type"]

    print(f"Extracting from {youtube_url} (registry={registry['label']!r}, source_type={source_type})...", file=sys.stderr)
    extraction = extract_with_chunking_fallback(youtube_url, source_type, category_hint="")
    metadata = extraction.get("_video_metadata", {}) or {}
    claims = extraction.get("candidate_claims", [])
    print(f"Extraction complete: video_summary={extraction.get('video_summary', '')[:80]!r}, {len(claims)} candidate claim(s).", file=sys.stderr)

    if dry_run:
        return {"dry_run": True, "registry_id": registry["id"], "youtube_url": youtube_url, "claims_count": len(claims), "extraction": extraction}

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

            raw_segments = extraction.get("segments", [])
            claim_seconds_list = sorted(
                {s for s in (mmss_to_seconds(c.get("start_timestamp", "")) for c in claims) if s is not None}
            )

            claim_ids = []
            segments_created = 0
            for c in claims:
                cur.execute(
                    """INSERT INTO claims
                           (stance, title, summary, category, accomplishment_type, sentiment,
                            citizen_impact_suggested, event_date_suggested,
                            extracted_by, extraction_confidence, review_status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'gemini_agent', %s, 'pending_review')
                       RETURNING id, review_status""",
                    (
                        c["stance"],
                        c["title"],
                        c["summary"],
                        c["category"],
                        normalize_accomplishment_type(c.get("accomplishment_type")),
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

                # Deep-link timestamp: start_seconds is real (Gemini's own
                # start_timestamp for this claim); end_seconds is a
                # best-effort window, capped by whichever of (next
                # claim's start, enclosing raw segment's end, +20s
                # fallback) is smallest and still after start_seconds.
                claim_seconds = mmss_to_seconds(c.get("start_timestamp", ""))
                if claim_seconds is not None:
                    end_seconds, speaker_title_at_time = compute_segment_window(claim_seconds, raw_segments, claim_seconds_list)

                    cur.execute(
                        """INSERT INTO transcript_segments
                               (source_id, start_seconds, end_seconds, text, speaker_title_at_time)
                           VALUES (%s, %s, %s, %s, %s)
                           RETURNING id""",
                        (source_id, claim_seconds, end_seconds, c["summary"], speaker_title_at_time),
                    )
                    segment_id = cur.fetchone()["id"]
                    cur.execute(
                        "INSERT INTO claim_transcript_segments (claim_id, segment_id) VALUES (%s, %s)",
                        (inserted["id"], segment_id),
                    )
                    segments_created += 1
                else:
                    print(f"Warning: claim {inserted['id']} has no parseable start_timestamp ({c.get('start_timestamp')!r}); no deep-link segment created.", file=sys.stderr)

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
        "youtube_url": youtube_url,
        "claim_ids": claim_ids,
        "claims_count": len(claim_ids),
        "segments_created": segments_created,
    }


def run_ingestion(registry_id: str, dry_run: bool = False) -> dict:
    """CLI entrypoint for the original behavior: registry.handle_or_url IS
    the one video to ingest (used for single_video-type registry rows,
    e.g. the PM Drew test row). Owns the connection lifecycle; discovery's
    run_channel_discovery.py instead opens one connection and calls
    ingest_one_video() per video, so last_checked_at etc. all land in a
    coherent single run."""
    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, registry_id)
        return ingest_one_video(conn, registry, registry["handle_or_url"], dry_run=dry_run)
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
