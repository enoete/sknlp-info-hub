"""
Shared timestamp/segment helpers for run_ingestion.py and
backfill_segments.py — kept in one place so both the forward path (new
extractions) and the backfill path (existing pre-approved claims that
predate this feature) compute deep-link windows the exact same way.
"""


def mmss_to_seconds(mmss: str):
    """'01:39' -> 99. Returns None (never raises) on anything that doesn't
    parse — a missing/malformed timestamp should skip the deep-link for
    that one claim, not break the whole run."""
    if not mmss or not mmss.strip():
        return None
    parts = mmss.strip().split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return None
    if len(parts) == 2:
        m, s = parts
        return m * 60 + s
    if len(parts) == 3:
        h, m, s = parts
        return h * 3600 + m * 60 + s
    return None


def find_enclosing_segment(claim_seconds: int, raw_segments: list):
    """Which of Gemini's broader speaker-turn segments actually contains
    this claim's timestamp — used only to borrow real speaker/role
    context and an end-time cap, not stored as a row of its own."""
    for seg in raw_segments:
        start = mmss_to_seconds(seg.get("start_timestamp", ""))
        end = mmss_to_seconds(seg.get("end_timestamp", ""))
        if start is not None and end is not None and start <= claim_seconds <= end:
            return seg
    return None


def compute_segment_window(claim_seconds: int, raw_segments: list, all_claim_seconds_sorted: list):
    """Returns (end_seconds, speaker_title_at_time) for a claim's deep-link
    segment: end_seconds is capped at whichever of (next claim's start,
    enclosing raw segment's end, +20s flat fallback) is smallest and still
    after claim_seconds; speaker_title_at_time is borrowed from the
    enclosing raw segment's role_as_stated when one contains this claim."""
    enclosing = find_enclosing_segment(claim_seconds, raw_segments)
    enclosing_end = mmss_to_seconds(enclosing.get("end_timestamp", "")) if enclosing else None
    later = [x for x in all_claim_seconds_sorted if x > claim_seconds]
    next_claim_seconds = later[0] if later else None
    candidates = [x for x in (next_claim_seconds, enclosing_end, claim_seconds + 20) if x is not None and x > claim_seconds]
    end_seconds = min(candidates) if candidates else claim_seconds + 20
    speaker_title_at_time = (enclosing.get("role_as_stated") or None) if enclosing else None
    return end_seconds, speaker_title_at_time
