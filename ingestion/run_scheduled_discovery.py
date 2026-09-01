"""
SKNLP Info Hub — scheduled discovery across every registered source.

Built 2026-09-01, closing the gap flagged directly: nothing in this
project ever ran on its own -- every batch this whole build was a
manually (if detached) launched one-off. This is the thing a cron job
actually calls: it queries sources_registry itself for every eligible
row (active, not manual-capture-only, a platform this project knows how
to discover) rather than a hardcoded list, so a newly registered source
gets picked up automatically without this script needing an edit.

Dedup and noise-filtering are NOT reimplemented here -- they're already
structural properties of the underlying write path this script calls
into (run_channel_discovery.run_channel_discovery /
run_website_discovery.run_website_discovery, both of which go through
ingest_one_video()/ingest_one_article(), both of which already call
claim_dedup.find_matching_approved_claim() before inserting anything new,
and both of which write `featured` directly from the extraction agent's
own judgment). This script's only job is deciding WHICH sources to check
and HOW MANY new items per source this run, deliberately modest
(--max-new, default 3) since this runs unattended and repeatedly, not as
a one-off backfill -- see run_channel_historical_backfill.py for that.

Per-source error isolation: one source failing (a dead feed, a changed
page layout, a transient API error) must never block the rest -- same
posture as run_batch.py.

Usage:
    python run_scheduled_discovery.py                  # real run, max 3 new items/source
    python run_scheduled_discovery.py --max-new 5
    python run_scheduled_discovery.py --dry-run         # extract only, no DB writes
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from run_ingestion import get_db_connection
from run_channel_discovery import run_channel_discovery
from run_website_discovery import run_website_discovery

# Excludes test/placeholder registry rows by label -- e.g. "TEST —
# Combobox verification (safe to delete)" -- rather than requiring the
# registry to stay perfectly clean of them. requires_manual_capture and
# platform already exclude Facebook and one-off manual rows structurally.
_LABEL_EXCLUDE_PREFIXES = ("TEST",)


def eligible_sources(conn) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, label, platform FROM sources_registry
               WHERE status = 'active' AND requires_manual_capture = false
                 AND platform IN ('youtube', 'website', 'sknis')
               ORDER BY platform, label"""
        )
        rows = cur.fetchall()
    return [r for r in rows if not any(r["label"].startswith(p) for p in _LABEL_EXCLUDE_PREFIXES)]


def main():
    parser = argparse.ArgumentParser(description="Run discovery across every eligible registered source.")
    parser.add_argument("--max-new", type=int, default=3, help="Max new items per source this run (default 3)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    conn = get_db_connection()
    try:
        sources = eligible_sources(conn)
        print(f"=== scheduled discovery run ({datetime.now(timezone.utc).isoformat()}) — {len(sources)} eligible source(s) ===", file=sys.stderr)

        results = []
        for s in sources:
            print(f"--- {s['label']} ({s['platform']}) ---", file=sys.stderr)
            try:
                if s["platform"] == "youtube":
                    result = run_channel_discovery(str(s["id"]), max_new=args.max_new, dry_run=args.dry_run)
                else:
                    result = run_website_discovery(str(s["id"]), max_new=args.max_new, dry_run=args.dry_run)
                results.append({"label": s["label"], **result})
            except Exception as e:
                print(f"FAILED: {s['label']}: {e}", file=sys.stderr)
                results.append({"label": s["label"], "error": str(e)})

        print("=== SUMMARY ===", file=sys.stderr)
        print(json.dumps(results, indent=2, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
