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


def seconds_to_mmss(seconds) -> str:
    """99 -> '1:39'. Inverse of mmss_to_seconds, used by
    extract_long_video()'s chunk-offset merge to convert an absolute
    (chunk-offset-added) second count back into the MM:SS string shape
    every other timestamp field in this pipeline already expects."""
    seconds = max(0, int(round(seconds)))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


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


# Generic placeholders Gemini uses when a speaker isn't actually
# identifiable ("Speaker 1", "Speaker 2", ...) — never store one of these
# as speaker_name_at_time, that would make "who said this" filtering
# actively misleading (grouping unrelated unidentified speakers under a
# fake shared identity) rather than just incomplete. "Caller" is handled
# the same way for a different reason: deliberately never named at all
# (see CLAUDE.md's "Call-in callers" decision) — it's a real, meaningful
# label but not a name.
_NON_NAME_LABELS = {"caller"}


def _is_real_name(label) -> bool:
    if not label:
        return False
    normalized = label.strip().lower()
    if normalized in _NON_NAME_LABELS:
        return False
    if normalized.startswith("speaker ") and normalized[8:].strip().isdigit():
        return False
    return True


def compute_segment_window(claim_seconds: int, raw_segments: list, all_claim_seconds_sorted: list):
    """Returns (end_seconds, speaker_title_at_time, speaker_name_at_time)
    for a claim's deep-link segment: end_seconds is capped at whichever of
    (next claim's start, enclosing raw segment's end, +20s flat fallback)
    is smallest and still after claim_seconds; speaker_title_at_time is
    borrowed from the enclosing raw segment's role_as_stated, and
    speaker_name_at_time from its speaker_label, when one contains this
    claim — speaker_name_at_time stays None for a generic "Speaker N"
    placeholder or a caller, never guessed."""
    enclosing = find_enclosing_segment(claim_seconds, raw_segments)
    enclosing_end = mmss_to_seconds(enclosing.get("end_timestamp", "")) if enclosing else None
    later = [x for x in all_claim_seconds_sorted if x > claim_seconds]
    next_claim_seconds = later[0] if later else None
    candidates = [x for x in (next_claim_seconds, enclosing_end, claim_seconds + 20) if x is not None and x > claim_seconds]
    end_seconds = min(candidates) if candidates else claim_seconds + 20
    speaker_title_at_time = (enclosing.get("role_as_stated") or None) if enclosing else None
    raw_label = enclosing.get("speaker_label") if enclosing else None
    speaker_name_at_time = raw_label.strip() if _is_real_name(raw_label) else None
    return end_seconds, speaker_title_at_time, speaker_name_at_time
