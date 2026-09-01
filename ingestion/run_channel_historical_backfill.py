"""
SKNLP Info Hub — YouTube channel historical backfill. The opposition-side
counterpart to run_batch.py's ZIZ historical run, generalized: walks a
registered channel's full upload history back to the Aug 5, 2022 scope
cutoff (discover_channel.find_historical_candidates) instead of only the
~15-most-recent RSS window run_channel_discovery.py is limited to, then
runs the existing extract-and-write pipeline (ingest_one_video) against
up to --limit of the discovered candidates per invocation.

Built 2026-08-31, prompted directly: "the opposition claims... is very
skant... beef that up with real facts and records." Confirmed live before
building this that the opposition-side registered channels (Talk SKN,
Straight Talk, PLP) had each only ever been discovered via the RSS-recent
path -- a real historical gap, not a volume-of-content gap (Straight Talk
alone has 300+ in-scope candidates going back to mid-2023 within the
first 6 pages of its upload history, walking further to reach 2022).

Same safety guarantees as run_batch.py: one video at a time through
run_ingestion.ingest_one_video (pending_review only, never auto-approved),
per-video error isolation so one bad video doesn't sink the run, already-
ingested videos skipped by origin_url.

Usage:
    python run_channel_historical_backfill.py --registry-id <uuid> --limit 15
    python run_channel_historical_backfill.py --registry-id <uuid> --limit 15 --max-pages 40
    python run_channel_historical_backfill.py --registry-id <uuid> --limit 5 --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from discover_channel import resolve_channel_id, find_historical_candidates
from run_ingestion import fetch_registry_row, get_db_connection, ingest_one_video


def already_seen_urls(conn, registry_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT origin_url FROM sources WHERE registry_id = %s", (registry_id,))
        return {row[0] for row in cur.fetchall()}


def run_historical_backfill(registry_id: str, limit: int, max_pages: int, dry_run: bool = False) -> dict:
    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, registry_id)
        if registry["platform"] != "youtube":
            return {"registry_id": registry_id, "error": f"platform={registry['platform']!r} — this script only supports youtube rows"}

        print(f"Resolving channel id for {registry['handle_or_url']!r}...", file=sys.stderr)
        try:
            channel_id = resolve_channel_id(registry["handle_or_url"])
        except ValueError as e:
            return {"registry_id": registry_id, "error": str(e)}
        print(f"Resolved to {channel_id}", file=sys.stderr)

        seen = already_seen_urls(conn, registry_id)
        candidates = find_historical_candidates(channel_id, seen, max_pages=max_pages)
        print(f"{len(candidates)} in-scope, not-yet-ingested candidate(s) found (of up to {max_pages} pages walked).", file=sys.stderr)

        # Oldest-first, same convention as run_batch.py -- builds the
        # historical record outward from the start of this
        # administration's term rather than working backward from today.
        candidates.sort(key=lambda v: v.published_at or datetime.max.date())

        attempted = 0
        results = []
        for v in candidates:
            if attempted >= limit:
                break
            attempted += 1
            print(f"=== {v.url} ({v.published_at}) — {v.title[:80]!r} ===", file=sys.stderr)
            try:
                result = ingest_one_video(conn, registry, v.url, dry_run=dry_run, known_published_at=v.published_at)
                results.append(result)
                print(json.dumps(result, indent=2, default=str))
            except Exception as e:
                print(f"FAILED: {e}", file=sys.stderr)
                results.append({"youtube_url": v.url, "error": str(e)})

        if not dry_run:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE sources_registry SET last_checked_at = %s WHERE id = %s",
                        (datetime.now(timezone.utc), registry_id),
                    )

        return {
            "registry_id": registry_id,
            "channel_id": channel_id,
            "candidates_found": len(candidates),
            "attempted": attempted,
            "remaining_candidates": max(0, len(candidates) - attempted),
            "results": results,
        }
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Historical backfill (back to the scope cutoff) for one registered YouTube channel.")
    parser.add_argument("--registry-id", required=True)
    parser.add_argument("--limit", type=int, default=10, help="Max videos to actually run through Gemini this invocation (default 10)")
    parser.add_argument("--max-pages", type=int, default=100, help="How many 50-video pages of upload history to walk looking for candidates (default 100)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    result = run_historical_backfill(args.registry_id, limit=args.limit, max_pages=args.max_pages, dry_run=args.dry_run)
    print("=== SUMMARY ===", file=sys.stderr)
    print(json.dumps(result, indent=2, default=str))
