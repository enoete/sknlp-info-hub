"""
SKNLP Info Hub — sitemap-based historical backfill discovery for
WordPress sources (SKNIS confirmed; should generalize to other
WordPress news sites, not yet tried). Sibling to discover_channel.py's
find_historical_candidates() for YouTube -- same reason it exists:
run_website_discovery.py's RSS feed only ever shows the ~10 most recent
items, no pagination, so it can never reach back to the Aug 2022 scope
cutoff on its own.

WordPress's own sitemap_index.xml (via the Yoast SEO plugin, confirmed
present on sknis.gov.kn) paginates all posts into post-sitemap*.xml
files at ~1000 URLs each, and this site's URLs are date-structured
(sknis.gov.kn/YYYY/MM/DD/slug/), so the scope filter and candidate
listing can both be done from the sitemap URLs alone -- no per-article
fetch needed until actual extraction.

Confirmed live 2026-08-31: post-sitemap13.xml straddles the Aug 5 2022
cutoff (Feb-Sep 2022), post-sitemap19.xml is the most recent (Feb-Aug
2026) -- so the in-scope sitemap range for SKNIS specifically is 13-19.
That range is NOT assumed generic; a different WordPress site's post
volume means a different range, so this always walks sitemap_index.xml
itself to find the right pages rather than hardcoding sitemap numbers.

Usage (as a library, called from run_website_discovery.py --historical):
    find_historical_candidates(base_url, already_seen_urls, max_new)
"""

import re
import sys
from dataclasses import dataclass
from datetime import date

import requests

from run_website_discovery import NOISE_TITLE_PATTERNS
from scope_config import in_scope

URL_DATE_PATTERN = re.compile(r"/(\d{4})/(\d{2})/(\d{2})/")


@dataclass
class HistoricalCandidate:
    url: str
    published_at: date | None


def _fetch_xml_locs(url: str) -> list[str]:
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    resp.raise_for_status()
    return re.findall(r"<loc>([^<]*)</loc>", resp.text)


def _parse_date_from_url(url: str) -> date | None:
    m = URL_DATE_PATTERN.search(url)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _is_probably_noise_url(url: str) -> bool:
    slug = url.rstrip("/").rsplit("/", 1)[-1].replace("-", " ")
    return bool(NOISE_TITLE_PATTERNS.search(slug))


def find_historical_candidates(base_url: str, already_seen_urls: set[str], max_new: int) -> list[HistoricalCandidate]:
    """Walks this site's post-sitemap pages newest-first (post-sitemap
    plugins number oldest->newest, so reversed() here gives newest-first,
    matching "catch up on what's missing starting from most recent" —
    same priority order as run_website_discovery.py's RSS path), collecting
    in-scope, not-already-seen, not-obviously-noise URLs until max_new is
    reached or every in-scope sitemap page has been walked."""
    index_url = base_url.rstrip("/") + "/sitemap_index.xml"
    print(f"Fetching sitemap index {index_url}...", file=sys.stderr)
    sitemap_urls = [u for u in _fetch_xml_locs(index_url) if re.search(r"/post-sitemap\d*\.xml$", u)]
    # WordPress/Yoast numbers these oldest-first; walk newest-first.
    sitemap_urls.sort(key=lambda u: int(re.search(r"(\d+)?\.xml$", u).group(1) or "0"))
    sitemap_urls.reverse()

    candidates: list[HistoricalCandidate] = []
    for sm_url in sitemap_urls:
        print(f"Scanning {sm_url}...", file=sys.stderr)
        urls = _fetch_xml_locs(sm_url)
        # Sitemap pages are chronological; oldest entries only appear in
        # earlier-numbered pages, but a single page can straddle the
        # scope cutoff (confirmed: post-sitemap13.xml spans Feb-Sep
        # 2022), so filter every URL rather than skip whole pages.
        page_had_in_scope_item = False
        for url in reversed(urls):  # newest-first within the page too
            published_at = _parse_date_from_url(url)
            if not in_scope(published_at):
                continue
            page_had_in_scope_item = True
            if url in already_seen_urls or _is_probably_noise_url(url):
                continue
            candidates.append(HistoricalCandidate(url=url, published_at=published_at))
            if len(candidates) >= max_new:
                return candidates
        if not page_had_in_scope_item and sitemap_urls.index(sm_url) > 0:
            # Every URL on this page was pre-cutoff -- older pages will
            # only be more so (pages are chronological), stop walking.
            break

    return candidates
