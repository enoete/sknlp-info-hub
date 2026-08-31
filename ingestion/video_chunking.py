"""
Video chunking for the ingestion agent -- splits a long YouTube video (too
long to fit inside Gemini's 1,048,576-token input ceiling in one call, even
at MEDIA_RESOLUTION_LOW -- confirmed on two real multi-hour National
Assembly sittings that still failed after that setting was added) into
time windows that each get sent to Gemini as a separate call.

Deliberately does NOT download the video or use local ffmpeg splitting.
Two reasons:
1. Gemini's video understanding API accepts a `video_metadata` block with
   `start_offset`/`end_offset` alongside the same YouTube `file_data` URI
   already used elsewhere in this pipeline -- Gemini clips server-side, so
   there's no need to download, split, re-upload, or manage local files at
   all. Confirmed via the SDK's own types.VideoMetadata fields.
2. This droplet's own YouTube access (yt-dlp AND plain HTTP) is subject to
   IP-level bot-check/rate-limiting -- confirmed hitting CAPTCHA walls on
   this exact channel after a day of heavy scraping. Server-side clipping
   means chunking doesn't depend on our droplet's IP reputation at all.

The one thing offset-clipping genuinely needs that we don't otherwise
have: the video's REAL total duration, so chunk windows never guess past
the actual end. Confirmed by direct test that Gemini will confidently
invent plausible-sounding content for a start_offset past a short video's
real end rather than reporting anything is wrong -- guessing wrong here
would violate this project's non-negotiable "never invent a claim" rule,
so duration comes from the YouTube Data API v3 (exact, deterministic),
never estimated.
"""

import os
import re
import sys
from urllib.request import urlopen
from urllib.parse import urlencode

# 90 min. Real data points from this project's own failures/successes at
# MEDIA_RESOLUTION_LOW (via the YouTube Data API's confirmed durations):
# a 2h03m video extracted fine in one call, a 58min video extracted fine,
# but 3h53m and 8h10m both hit the token ceiling. The real threshold sits
# somewhere between ~2h and ~4h -- 90 min stays comfortably under the
# confirmed-safe 2h03m mark while roughly halving the number of Gemini
# calls (and wall-clock time) per long sitting versus a more conservative
# 30-min chunk size.
DEFAULT_CHUNK_SECONDS = 5400

_ISO8601_DURATION_RE = re.compile(
    r"P(?:(?P<days>\d+)D)?T?(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?"
)


def parse_iso8601_duration(duration: str) -> int:
    """'PT2H15M30S' -> 8130. YouTube Data API v3 always returns durations
    in this format (ISO 8601); raises on anything that doesn't match at
    all rather than silently returning 0, since a wrong duration here can
    lead to chunk windows that miss real content or duplicate it."""
    match = _ISO8601_DURATION_RE.fullmatch(duration.strip())
    if not match or not any(match.groupdict().values()):
        raise ValueError(f"Could not parse ISO 8601 duration: {duration!r}")
    parts = {k: int(v) if v else 0 for k, v in match.groupdict().items()}
    return parts["days"] * 86400 + parts["hours"] * 3600 + parts["minutes"] * 60 + parts["seconds"]


def extract_video_id(youtube_url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", youtube_url)
    if not match:
        raise ValueError(f"Could not extract a video id from {youtube_url!r}")
    return match.group(1)


def get_video_duration_seconds(youtube_url: str, api_key: str | None = None) -> int:
    """Real, exact duration via YouTube Data API v3's videos.list
    (contentDetails.duration) -- 1 quota unit per call against the
    10,000/day free tier. Requires YOUTUBE_DATA_API_KEY (separate from
    GEMINI_API_KEY -- confirmed the Gemini key alone doesn't authenticate
    against this API); see README.md for the one-time Cloud Console setup
    (enable "YouTube Data API v3" on the same project, reuse or create a
    key)."""
    api_key = api_key or os.environ.get("YOUTUBE_DATA_API_KEY")
    if not api_key:
        raise RuntimeError(
            "YOUTUBE_DATA_API_KEY not set -- required to get exact video "
            "durations for chunking long videos safely. See README.md."
        )
    video_id = extract_video_id(youtube_url)
    url = "https://www.googleapis.com/youtube/v3/videos?" + urlencode(
        {"part": "contentDetails", "id": video_id, "key": api_key}
    )
    with urlopen(url, timeout=15) as resp:
        import json
        data = json.load(resp)
    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"YouTube Data API returned no video for id {video_id} (deleted/private/wrong id?)")
    return parse_iso8601_duration(items[0]["contentDetails"]["duration"])


def compute_chunk_windows(duration_seconds: int, chunk_seconds: int = DEFAULT_CHUNK_SECONDS):
    """[(0, 1800), (1800, 3600), ...] covering the full real duration, the
    last window trimmed to the actual end -- never extends past
    duration_seconds, so no chunk ever asks Gemini to process time that
    doesn't exist in the video."""
    if duration_seconds <= 0:
        raise ValueError(f"duration_seconds must be positive, got {duration_seconds}")
    windows = []
    start = 0
    while start < duration_seconds:
        end = min(start + chunk_seconds, duration_seconds)
        windows.append((start, end))
        start = end
    return windows
