"""
SKNLP Info Hub — website-level ingestion discovery for WordPress-based
government/press sources (SKNIS confirmed working; should generalize to
Freedom FM / WINN FM's news sites too, same RSS shape, not yet tried).

Mirrors run_channel_discovery.py's role for YouTube: resolves a
registry row's RSS feed, filters to new/in-scope/not-noise items, and
runs run_article_ingestion.ingest_one_article against each. The RSS
item's own <content:encoded> already carries the full article body
(confirmed live 2026-08-31 against sknis.gov.kn/feed/), so this never
needs a second page fetch the way a single --url run does.

Noise filtering exists because a government site's RSS mixes real
policy/accomplishment content with job postings, generic notices, and
event-photo posts that have nothing extractable in them -- same
"cheap, high-confidence exclude-list, not an include-list" philosophy
discover_channel.py's is_probably_relevant() already uses for ZIZ, so a
genuinely new content type isn't silently dropped just because it wasn't
anticipated.

Capped at --max-new (default 5) for the same reason channel discovery
is capped: a site with years of backlog could otherwise trigger an
unbounded batch of extraction calls in one run.

Usage:
    python run_website_discovery.py --registry-id <uuid>
    python run_website_discovery.py --registry-id <uuid> --max-new 10
    python run_website_discovery.py --registry-id <uuid> --dry-run
"""

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timezone

import requests

from run_article_ingestion import ingest_one_article
from run_ingestion import fetch_registry_row, get_db_connection
from scope_config import in_scope
from extract_from_article import strip_html

ATOM_NS = {"content": "http://purl.org/rss/1.0/modules/content/", "dc": "http://purl.org/dc/elements/1.1/"}

# Title/category substrings for content that's clearly not
# claim-worthy -- vacancies, generic notices, photo-only event posts.
# Deliberately short and high-confidence, same posture as
# discover_channel.py's _IRRELEVANT_TITLE_PATTERNS: casting a wide net
# on what's IN, only filtering what's confidently noise.
NOISE_CATEGORY_PATTERNS = re.compile(r"\bjobs?\b|\bvacanc(y|ies)\b|\bnotice(s)?\b", re.IGNORECASE)
NOISE_TITLE_PATTERNS = re.compile(
    r"^(job|vacancy|notice|tender|invitation to bid|request for proposal)\b|"
    r"public holiday|office closure|condolence|obituary",
    re.IGNORECASE,
)


@dataclass
class DiscoveredArticle:
    url: str
    title: str
    body_text: str
    published_at: date | None
    categories: list[str]


def is_probably_relevant(title: str, categories: list[str]) -> bool:
    if NOISE_TITLE_PATTERNS.search(title):
        return False
    if categories and all(NOISE_CATEGORY_PATTERNS.search(c) for c in categories):
        return False
    return True


def fetch_feed_articles(feed_url: str) -> list[DiscoveredArticle]:
    resp = requests.get(feed_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    resp.raise_for_status()
    root = ET.fromstring(resp.text)

    articles = []
    for item in root.iter("item"):
        link_el = item.find("link")
        title_el = item.find("title")
        pubdate_el = item.find("pubDate")
        content_el = item.find("content:encoded", ATOM_NS)
        if link_el is None or title_el is None:
            continue

        published_at = None
        if pubdate_el is not None and pubdate_el.text:
            try:
                published_at = datetime.strptime(pubdate_el.text.strip(), "%a, %d %b %Y %H:%M:%S %z").date()
            except ValueError:
                pass

        categories = [c.text for c in item.findall("category") if c.text]
        body_text = strip_html(content_el.text) if content_el is not None and content_el.text else ""

        articles.append(DiscoveredArticle(
            url=link_el.text.strip(),
            title=(title_el.text or "").strip(),
            body_text=body_text,
            published_at=published_at,
            categories=categories,
        ))
    return articles


def already_seen_urls(conn, registry_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT origin_url FROM sources WHERE registry_id = %s", (registry_id,))
        return {row[0] for row in cur.fetchall()}


def run_website_discovery(registry_id: str, max_new: int = 5, dry_run: bool = False) -> dict:
    conn = get_db_connection()
    try:
        registry = fetch_registry_row(conn, registry_id)
        feed_url = registry["handle_or_url"].rstrip("/") + "/feed/"

        print(f"Fetching feed {feed_url}...", file=sys.stderr)
        all_articles = fetch_feed_articles(feed_url)
        seen = already_seen_urls(conn, registry_id)

        candidates = []
        for a in all_articles:
            if a.url in seen:
                continue
            if not in_scope(a.published_at):
                print(f"Skipping out-of-scope article (published {a.published_at}): {a.title!r}", file=sys.stderr)
                continue
            if not is_probably_relevant(a.title, a.categories):
                print(f"Skipping noise category {a.categories}: {a.title!r}", file=sys.stderr)
                continue
            candidates.append(a)
            if len(candidates) >= max_new:
                break

        print(f"Found {len(candidates)} new in-scope, non-noise article(s) (of up to {max_new} requested, {len(all_articles)} in feed).", file=sys.stderr)

        results = []
        for a in candidates:
            print(f"--- {a.url} ({a.published_at}): {a.title!r} ---", file=sys.stderr)
            try:
                article_data = {"title": a.title, "body_text": a.body_text}
                result = ingest_one_article(
                    conn, registry, a.url, dry_run=dry_run,
                    known_published_at=a.published_at, article_data=article_data,
                )
                results.append(result)
            except Exception as e:
                print(f"Error ingesting {a.url}: {e}", file=sys.stderr)
                results.append({"url": a.url, "error": str(e)})

        if not dry_run:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE sources_registry SET last_checked_at = %s WHERE id = %s",
                        (datetime.now(timezone.utc), registry_id),
                    )

        return {"registry_id": registry_id, "feed_url": feed_url, "candidates_found": len(candidates), "results": results}
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Discover and ingest new articles from a registered WordPress-based source's RSS feed.")
    parser.add_argument("--registry-id", required=True)
    parser.add_argument("--max-new", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    result = run_website_discovery(args.registry_id, max_new=args.max_new, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
