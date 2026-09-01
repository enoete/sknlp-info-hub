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
from datetime import date, datetime, timedelta
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


# ------------------------------------------------------------
# Historical backfill (Aug 2022 -> present, not just "what's new")
# ------------------------------------------------------------
#
# The RSS feed above only ever shows the ~15 most recent uploads — no good
# for reaching back to when this administration took office. A channel
# posting several times a day (ZIZ: daily news + several talk/interview
# shows) can easily have several thousand uploads across a 4-year window,
# so this deliberately does NOT try to process everything: it enumerates
# candidates cheaply (title + position only, no per-video metadata fetch,
# no Gemini call) so the actual volume can be sized and a human can decide
# how to budget the real extraction runs, and it filters out categories
# that are clearly not government-accountability content before that
# count is even reported.

_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october|november|december"
)
# Covers every date style actually observed in ZIZ titles: "August 30th,
# 2026", "13th May 2026", "October 9, 2025", "4 October, 2025",
# "March 19 , 2025" (stray space before the comma).
_DATE_PATTERNS = [
    re.compile(rf"({_MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?\s*,?\s*(\d{{4}})", re.IGNORECASE),
    re.compile(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTHS})\s*,?\s*(\d{{4}})", re.IGNORECASE),
]


def parse_date_from_title(title: str) -> Optional[date]:
    """Best-effort date extraction from a video title — no network call,
    used to cheaply place a video in time during backfill pagination
    without fetching real upload_date metadata per video (yt-dlp only
    returns that in non-flat mode, which is one HTTP request per video —
    far too slow across thousands of candidates). Most of this channel's
    actually valuable content (news broadcasts, sittings, statements)
    reliably embeds a real date in the title; undated titles are handled
    by the caller (treated as in-scope while pagination is still within
    the scope window, since the playlist order brackets them between
    dated neighbors)."""
    for pattern in _DATE_PATTERNS:
        m = pattern.search(title)
        if not m:
            continue
        groups = m.groups()
        month_str = groups[0] if groups[0].isalpha() else groups[1]
        day_str = groups[1] if groups[0].isalpha() else groups[0]
        year_str = groups[2]
        try:
            return datetime.strptime(f"{month_str} {day_str} {year_str}", "%B %d %Y").date()
        except ValueError:
            continue
    return None


# Title substrings for content that is clearly not government-accountability
# material -- music/entertainment mixes, lifestyle/health features, retail
# features. Deliberately a short, high-confidence exclude-list rather than
# an include-list: "use judgment, don't limit to just one content type" per
# CLAUDE.md's ingestion philosophy means casting a wide net (news, sittings,
# statements, press conferences, interviews, documentaries, InFocus-style
# policy segments all stay IN), and only filtering out what's confidently
# irrelevant -- Gemini's own conservative extraction is the real filter for
# everything that survives this cheap pre-filter, same as any other video.
_IRRELEVANT_TITLE_PATTERNS = re.compile(
    r"megamix|pleasure pulse|radio market|health\s*wise|bougainvillea|"
    r"world read aloud|book\s*shop|christmas.*gift|gift.*local",
    re.IGNORECASE,
)


def is_probably_relevant(title: str) -> bool:
    return not _IRRELEVANT_TITLE_PATTERNS.search(title)


def _list_uploads_page(channel_id: str, start: int, end: int) -> list[dict]:
    """One page of the channel's uploads playlist (guaranteed reverse-
    chronological, unlike the /videos tab which YouTube can reorder by
    "popular"). Flat mode only -- id + title + position, no per-video
    metadata fetch, so this stays fast even hundreds of pages deep."""
    import yt_dlp

    uploads_playlist_id = "UU" + channel_id[2:]
    url = f"https://www.youtube.com/playlist?list={uploads_playlist_id}"
    opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "playliststart": start,
        "playlistend": end,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return info.get("entries") or []


def find_historical_candidates(
    channel_id: str,
    already_seen_urls: set[str],
    page_size: int = 50,
    max_pages: int = 200,
    start_page: int = 0,
    seed_last_confirmed_date: Optional[date] = None,
) -> list[DiscoveredVideo]:
    """Walks the uploads playlist backward from most recent, page by page,
    until title-parsed dates confirm we've crossed before the scope
    cutoff (or max_pages is hit, as a hard backstop against an unbounded
    walk if date parsing ever fails to catch the boundary). Returns every
    in-scope, not-already-ingested, probably-relevant candidate found —
    this can be a LARGE list (thousands, for a high-volume channel across
    a 4-year window); it's on the caller to decide how many to actually
    run through Gemini in one go, same max_new-style budgeting as
    find_new_in_scope_videos."""
    candidates = []
    last_confirmed_date: Optional[date] = seed_last_confirmed_date
    # We're walking newest -> oldest by construction (the uploads
    # playlist is guaranteed reverse-chronological), so any correctly-
    # parsed date should be <= last_confirmed_date, with a small
    # tolerance for same-day/adjacent-position uploads. A date NEWER
    # than the running anchor by more than that is the real anomaly
    # signal (a title typo -- real example hit during testing: "Radio
    # Market ... - January 14, 2022" sitting between two January 2023
    # uploads, a one-year typo on the channel's own upload) and gets
    # discarded. A date that's OLDER, however much older, is always
    # plausible on its own -- a channel can go months between uploads.
    # This used to be a single symmetric window (MAX_PLAUSIBLE_JUMP_DAYS
    # = 45 in both directions), which was a real bug on lower-frequency
    # channels: PLP and Straight Talk both post far less often than ZIZ
    # (which this constant was tuned against), so a completely normal
    # multi-month gap between consecutive playlist positions got
    # rejected as "implausible," leaving last_confirmed_date stuck near
    # its first (often noisy) anchor value. That meant the scope-cutoff
    # check below never engaged and the walk silently drifted years past
    # the Aug 2022 cutoff without ever stopping -- confirmed live on
    # PLP's channel (150 candidates walked, spanning back to 2022
    # campaign rally uploads, none ever flagged out of scope).
    FORWARD_TOLERANCE_DAYS = 3

    for page in range(start_page, start_page + max_pages):
        start = page * page_size + 1
        end = start + page_size - 1
        entries = _list_uploads_page(channel_id, start, end)
        if not entries:
            break  # ran off the end of the channel's history

        for entry in entries:
            video_id = entry.get("id")
            title = entry.get("title") or ""
            if not video_id:
                continue
            url = f"https://www.youtube.com/watch?v={video_id}"

            parsed = parse_date_from_title(title)
            if parsed is not None:
                if last_confirmed_date is None or parsed <= last_confirmed_date + timedelta(days=FORWARD_TOLERANCE_DAYS):
                    last_confirmed_date = parsed
                else:
                    print(f"Ignoring implausible date jump ({parsed}, vs running {last_confirmed_date}) in title: {title!r}", file=sys.stderr)
                    parsed = None  # don't attach an untrusted date to this candidate either

            if last_confirmed_date is not None and not in_scope(last_confirmed_date):
                print(
                    f"Crossed scope cutoff at {last_confirmed_date} (before {ADMINISTRATION_START}) — stopping backfill walk.",
                    file=sys.stderr,
                )
                return candidates

            if url in already_seen_urls:
                continue
            if not is_probably_relevant(title):
                continue
            candidates.append(DiscoveredVideo(video_id, title, parsed))

        print(f"Page {page + 1} ({start}-{end}): {len(entries)} videos, last confirmed date so far: {last_confirmed_date}", file=sys.stderr)

    return candidates
