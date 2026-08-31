"""
SKNLP Info Hub — batch runner for the ZIZ historical backfill's high-value
candidate list (see discover_channel.py's find_historical_candidates() and
CLAUDE.md's "prioritize high-value content first" decision).

Takes the JSON produced by filtering a backfill scan down to National
Assembly sittings / PM-Minister statements / press conferences, skips
anything already in the `sources` table (by YouTube video id, so reruns
are safe), and calls run_ingestion.ingest_one_video() for each remaining
candidate in oldest-first order — same one-video-at-a-time write path and
safety guarantees as everything else in this pipeline, just looped with
per-video error isolation so one bad video (token ceiling, 403, etc.)
doesn't abort the whole batch.

Usage:
    python run_batch.py --registry-id <uuid> --candidates /tmp/ziz_high_value.json \
        --categories "PM/Minister statement,Press conference" --limit 10
"""

import argparse
import json
import re
import sys
from datetime import date, datetime

import psycopg2
import psycopg2.extras

from run_ingestion import fetch_registry_row, get_db_connection, ingest_one_video


def already_ingested_video_ids(conn) -> set:
    with conn.cursor() as cur:
        cur.execute("SELECT origin_url FROM sources WHERE origin_url LIKE %s", ("%youtube%",))
        ids = set()
        for (url,) in cur.fetchall():
            m = re.search(r"v=([A-Za-z0-9_-]{11})", url or "")
            if m:
                ids.add(m.group(1))
        return ids


def load_candidates(path: str, categories: list) -> list:
    with open(path) as f:
        data = json.load(f)
    combined = []
    for cat in categories:
        for item in data.get(cat, []):
            combined.append({**item, "_category": cat})
    # Oldest-first: undated items (date=None) sort last, not first, so we
    # don't burn the batch budget on items we can't scope-check confidently.
    combined.sort(key=lambda it: it.get("date") or "9999-99-99")
    return combined


def main():
    parser = argparse.ArgumentParser(description="Batch-ingest a filtered list of high-value ZIZ candidates.")
    parser.add_argument("--registry-id", required=True)
    parser.add_argument("--candidates", required=True, help="Path to the high-value candidates JSON")
    parser.add_argument("--categories", default="PM/Minister statement,Press conference",
                         help="Comma-separated category keys from the candidates JSON to include")
    parser.add_argument("--limit", type=int, default=10, help="Max videos to attempt this run")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    candidates = load_candidates(args.candidates, categories)

    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, args.registry_id)
        seen_ids = already_ingested_video_ids(conn)

        attempted = 0
        results = []
        for item in candidates:
            if attempted >= args.limit:
                break
            video_id = item["id"]
            if video_id in seen_ids:
                continue
            url = f"https://www.youtube.com/watch?v={video_id}"
            print(f"=== {url} ({item.get('date')}, {item['_category']}) — {item.get('title', '')[:80]} ===", file=sys.stderr)
            attempted += 1
            try:
                result = ingest_one_video(conn, registry, url, dry_run=args.dry_run)
                results.append(result)
                print(json.dumps(result, indent=2, default=str))
            except Exception as e:
                error_result = {"youtube_url": url, "error": str(e)}
                results.append(error_result)
                print(f"FAILED: {e}", file=sys.stderr)

        print("=== BATCH SUMMARY ===", file=sys.stderr)
        print(json.dumps(results, indent=2, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
