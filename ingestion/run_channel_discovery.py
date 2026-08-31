"""
SKNLP Info Hub — channel-level ingestion discovery.

The missing piece behind sources_registry: a youtube_channel row (e.g.
ZIZ Radio TV, SKNIS official YouTube) could be registered but nothing
ever checked it for new content — run_ingestion.py only ever knew how to
process one already-known video URL. This resolves the channel's real id,
lists its recent uploads via YouTube's public RSS feed, filters out
anything already ingested or before the scope cutoff (see
scope_config.py), and runs the existing extract-and-write pipeline
(ingest_one_video, from run_ingestion.py) against each new one.

Capped at --max-new per run (default 3) on purpose: a channel with years
of backlog (e.g. National Assembly sittings going back to 2022) could
otherwise trigger a large, expensive batch of Gemini video-understanding
calls and flood the review queue in one shot. Catching up on a large
backlog is several deliberate runs, not one unbounded sweep.

Usage:
    python run_channel_discovery.py --registry-id <uuid>
    python run_channel_discovery.py --registry-id <uuid> --max-new 5
    python run_channel_discovery.py --registry-id <uuid> --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from discover_channel import resolve_channel_id, find_new_in_scope_videos
from run_ingestion import fetch_registry_row, get_db_connection, ingest_one_video


def already_seen_urls(conn, registry_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT origin_url FROM sources WHERE registry_id = %s", (registry_id,))
        return {row[0] for row in cur.fetchall()}


def run_channel_discovery(registry_id: str, max_new: int = 3, dry_run: bool = False) -> dict:
    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, registry_id)
        if registry["platform"] != "youtube":
            return {"registry_id": registry_id, "error": f"platform={registry['platform']!r} — channel discovery only supports youtube rows"}

        print(f"Resolving channel id for {registry['handle_or_url']!r}...", file=sys.stderr)
        try:
            channel_id = resolve_channel_id(registry["handle_or_url"])
        except ValueError as e:
            return {"registry_id": registry_id, "error": str(e)}
        print(f"Resolved to {channel_id}", file=sys.stderr)

        seen = already_seen_urls(conn, registry_id)
        candidates = find_new_in_scope_videos(channel_id, seen, max_new)
        print(f"Found {len(candidates)} new in-scope video(s) (of up to {max_new} requested).", file=sys.stderr)

        results = []
        for v in candidates:
            print(f"--- {v.url} ({v.published_at}): {v.title!r} ---", file=sys.stderr)
            try:
                result = ingest_one_video(conn, registry, v.url, dry_run=dry_run, known_published_at=v.published_at)
                results.append(result)
            except Exception as e:
                # One bad video (a Gemini failure, an unparseable response)
                # shouldn't sink the whole channel's discovery run — record
                # it and keep going, same "don't let one failure block
                # everything else" posture as the rest of this pipeline.
                print(f"Error ingesting {v.url}: {e}", file=sys.stderr)
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
            "results": results,
        }
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Discover and ingest new videos from a registered YouTube channel.")
    parser.add_argument("--registry-id", required=True, help="sources_registry.id (UUID) — must be a youtube_channel-type row")
    parser.add_argument("--max-new", type=int, default=3, help="Max new videos to process this run (default 3)")
    parser.add_argument("--dry-run", action="store_true", help="Extract only, print JSON, no DB writes")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    result = run_channel_discovery(args.registry_id, max_new=args.max_new, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
