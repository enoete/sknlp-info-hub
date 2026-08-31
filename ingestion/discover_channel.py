"""
YouTube channel discovery — the piece that was missing: sources_registry
had youtube_channel rows with detection_method='public_rss' since the
project's early design, but nothing ever actually read that feed. This
resolves a channel's real UC... id (a bare @handle isn't enough to build
an RSS URL) and lists its recent uploads via YouTube's public Atom feed —
no API key needed, no scraping of rendered pages.

Two-step because YouTube's RSS endpoint only accepts a real channel_id,
not an @handle: resolve_channel_id() fetches the channel's own page and
reads the canonical <link>, which YouTube server-renders even though the
rest of the page is client-hydrated.
"""

import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from typing import Optional

from scope_config import ADMINISTRATION_START, in_scope

USER_AGENT = "Mozilla/5.0 (compatible; SKNLPInfoHub/1.0)"
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def resolve_channel_id(handle_or_url: str) -> str:
    """Accepts a bare @handle ('@ZIZRadioTV'), a channel/UC... form, or a
    full URL, and returns the real UC... channel id. Raises ValueError if
    it can't be resolved (dead handle, network failure, unexpected page
    shape) — callers should treat that as "skip this source, don't crash
    the whole discovery run"."""
    match = re.search(r"(UC[\w-]{22})", handle_or_url)
    if match:
        return match.group(1)

    handle = handle_or_url.strip()
    if not handle.startswith("http"):
        handle = handle.lstrip("@")
        url = f"https://www.youtube.com/@{handle}"
    else:
        url = handle

    try:
        html = _fetch(url)
    except Exception as e:
        raise ValueError(f"Could not fetch channel page for {handle_or_url!r}: {e}")

    canon = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', html)
    if not canon:
        raise ValueError(f"Could not find a channel id on the page for {handle_or_url!r} — handle may be wrong or dead.")
    return canon.group(1)


class DiscoveredVideo:
    def __init__(self, video_id: str, title: str, published_at: Optional[date]):
        self.video_id = video_id
        self.title = title
        self.published_at = published_at
        self.url = f"https://www.youtube.com/watch?v={video_id}"

    def __repr__(self):
        return f"DiscoveredVideo({self.video_id!r}, {self.title!r}, {self.published_at})"


def fetch_channel_videos(channel_id: str) -> list[DiscoveredVideo]:
    """YouTube's public Atom feed for a channel — most recent ~15 uploads,
    newest first. No pagination available (that's the feed's own limit,
    not something this can page around); a channel with a large backlog
    beyond that window needs a different, deliberate backfill pass, not
    silently assumed as covered by ongoing discovery runs."""
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    xml_text = _fetch(url)
    root = ET.fromstring(xml_text)

    videos = []
    for entry in root.findall("atom:entry", ATOM_NS):
        video_id_el = entry.find("yt:videoId", ATOM_NS)
        title_el = entry.find("atom:title", ATOM_NS)
        published_el = entry.find("atom:published", ATOM_NS)
        if video_id_el is None or title_el is None:
            continue
        published_at = None
        if published_el is not None and published_el.text:
            try:
                published_at = datetime.fromisoformat(published_el.text).date()
            except ValueError:
                pass
        videos.append(DiscoveredVideo(video_id_el.text, title_el.text or "", published_at))
    return videos


def find_new_in_scope_videos(channel_id: str, already_seen_urls: set[str], max_new: int) -> list[DiscoveredVideo]:
    """Newest-first from the feed, filtered to: not already in `sources`
    (by exact origin_url), and on/after the scope cutoff. Capped at
    `max_new` — a channel with years of backlog (e.g. National Assembly
    sittings) needs several deliberate runs to catch up, not one
    unbounded sweep that could rack up a lot of Gemini video-understanding
    cost/time in a single call."""
    out = []
    for v in fetch_channel_videos(channel_id):
        if v.url in already_seen_urls:
            continue
        if not in_scope(v.published_at):
            print(f"Skipping out-of-scope video (published {v.published_at}, before {ADMINISTRATION_START} cutoff): {v.title!r}", file=sys.stderr)
            continue
        out.append(v)
        if len(out) >= max_new:
            break
    return out
