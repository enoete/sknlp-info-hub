"""
SKNLP Info Hub — speaker identification agent (v0)

Handles voice enrollment and matching via pyannoteAI, separate from
extract_from_video.py (which handles content/claim extraction via Gemini).
These are two different jobs done by two different tools, on purpose:
Gemini is excellent at understanding video content but has no memory
across calls; pyannoteAI is built specifically for persistent, improving
speaker identification via enrolled voiceprints.

The loop this implements:
  1. enroll_speaker() — create/extend a voiceprint from a clean audio clip
  2. identify_segment() — match a new audio clip against enrolled speakers,
     returns a confidence-routed decision: auto-assign, needs_confirmation,
     or unknown
  3. confirm_match() — call this when an admin confirms or corrects a
     needs_confirmation result. This is the "teaching" step — it adds the
     clip as a new enrollment sample, so future matches on that person get
     better.

Setup:
    pip install requests
    export PYANNOTE_API_KEY=your_key_here

This is a thin wrapper, not a finished pipeline — it still needs: (a) a
step to actually extract a clean audio clip for a given transcript_segment
(ffmpeg, given start/end seconds and the source media), and (b) wiring the
three functions below into the database and the admin review queue UI.
"""

import os
import time
import requests

PYANNOTE_API_BASE = "https://api.pyannote.ai/v1"

# Tune these based on real results, same guidance pyannoteAI gives:
# if enrolled speakers keep showing up as unknown, lower CONFIRM_THRESHOLD.
# if wrong names get auto-assigned, raise AUTO_ASSIGN_THRESHOLD.
AUTO_ASSIGN_THRESHOLD = 80   # >= this: assign automatically, no human check needed
CONFIRM_THRESHOLD = 45       # >= this but < auto-assign: ask a human to confirm
# below CONFIRM_THRESHOLD: leave as unknown_speaker, no suggestion shown

# extract_from_video.py's identification_signal value for a member of the
# public phoning into a call-in program (e.g. Straight Talk). These
# speakers are captured and quoted like anyone else, but deliberately
# never named and never enrolled as a tracked identity -- see
# resolve_speaker_identity()'s early-exit below.
CALLER_SIGNAL = "caller_phoned_in"


def _headers():
    key = os.environ.get("PYANNOTE_API_KEY")
    if not key:
        raise RuntimeError("Set PYANNOTE_API_KEY before calling the speaker-ID API.")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


REQUEST_TIMEOUT_S = 30   # per-HTTP-call socket timeout — without this, a stalled
                         # connection hangs forever regardless of the job-level
                         # timeout_s below, since the wall-clock budget is only
                         # ever checked *between* calls, never inside one.
MAX_CONSECUTIVE_POLL_ERRORS = 3  # tolerate a few transient blips (network hiccup,
                                 # a stray 502) without aborting an otherwise-fine job


def _run_job(path: str, payload: dict, poll_interval_s: float = 3, timeout_s: float = 120) -> dict:
    """pyannoteAI's voiceprint/identify/diarize endpoints are all async: the
    POST returns {jobId, status:"created"} immediately, and the real result
    only shows up once GET /jobs/{jobId} reports status "succeeded" (or
    "failed"). Confirmed empirically against the real API — every endpoint
    here is job-based, not request/response.

    Bounded on two axes so this can't hang indefinitely: a hard wall-clock
    budget (timeout_s) across the whole poll loop, AND a socket-level
    timeout on every individual HTTP call (REQUEST_TIMEOUT_S) so a single
    stalled connection can't silently eat the whole budget in one call.
    """
    resp = requests.post(f"{PYANNOTE_API_BASE}{path}", headers=_headers(), json=payload, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    job_id = resp.json()["jobId"]

    waited = 0.0
    consecutive_errors = 0
    poll_delay = poll_interval_s
    while waited < timeout_s:
        time.sleep(poll_delay)
        waited += poll_delay

        try:
            job = requests.get(f"{PYANNOTE_API_BASE}/jobs/{job_id}", headers=_headers(), timeout=REQUEST_TIMEOUT_S)
            job.raise_for_status()
            job_data = job.json()
        except requests.RequestException as e:
            consecutive_errors += 1
            if consecutive_errors > MAX_CONSECUTIVE_POLL_ERRORS:
                raise RuntimeError(
                    f"pyannoteAI job {job_id}: {MAX_CONSECUTIVE_POLL_ERRORS} consecutive poll failures, giving up. Last error: {e}"
                ) from e
            continue

        consecutive_errors = 0
        if job_data["status"] == "succeeded":
            return job_data["output"]
        if job_data["status"] == "failed":
            raise RuntimeError(f"pyannoteAI job {job_id} failed: {job_data}")
        # mild backoff for slow jobs so we don't hammer the API while waiting
        poll_delay = min(poll_delay * 1.5, 10)

    raise TimeoutError(f"pyannoteAI job {job_id} did not finish within {timeout_s}s")


def enroll_speaker(speaker_label: str, audio_clip_url: str) -> str:
    """Create or extend a voiceprint for a speaker from a clean audio clip
    (~20-30 seconds of that person, ideally without overlapping speech).

    Returns the voiceprint itself — a base64-encoded embedding string, not
    a server-side reference id. pyannoteAI's /voiceprint endpoint doesn't
    keep any server-side record of enrolled speakers; the caller (us) owns
    storing this value (in speakers.voiceprint_ref) and must pass it back
    in full on every identify_segment() call. Confirmed via a live test
    call — the docstring originally assumed an opaque "voiceprint_id" you
    could reference later, which isn't how the real API works.
    """
    output = _run_job("/voiceprint", {"url": audio_clip_url})
    return output["voiceprint"]


def identify_segment(audio_clip_url: str, enrolled_voiceprints: dict) -> dict:
    """Match a segment's audio against the enrolled voiceprint set.
    Returns a routing decision, not just a raw score — this is the piece
    that turns "a number" into "what should the review queue actually do."

    enrolled_voiceprints: {speaker_label: voiceprint_string} — the actual
    base64 voiceprint values returned by enroll_speaker(), not ids.
    """
    voiceprints_payload = [
        {"label": label, "voiceprint": vp} for label, vp in enrolled_voiceprints.items()
    ]
    output = _run_job("/identify", {"url": audio_clip_url, "voiceprints": voiceprints_payload})

    # Real shape (confirmed via a live call, not documented assumption):
    # output.voiceprints is one entry per pyannoteAI-diarized speaker cluster
    # found in the clip (SPEAKER_00, SPEAKER_01, ...), each with a
    # {enrolled_label: confidence_0_to_100} map against every voiceprint we
    # submitted. A clip can contain more than one diarized speaker; we take
    # the single best (cluster, candidate) pair across all of them, since
    # this function's contract is "who is most likely present," not a
    # per-cluster breakdown.
    best_label, best_score = None, -1
    for cluster in output.get("voiceprints", []):
        for label, score in cluster.get("confidence", {}).items():
            if score > best_score:
                best_label, best_score = label, score

    if best_label is None:
        return {"decision": "unknown", "speaker_id": None, "score": 0}

    if best_score >= AUTO_ASSIGN_THRESHOLD:
        return {"decision": "auto_assign", "speaker_id": best_label, "score": best_score}
    elif best_score >= CONFIRM_THRESHOLD:
        return {"decision": "needs_confirmation", "speaker_id": best_label, "score": best_score}
    else:
        return {"decision": "unknown", "speaker_id": None, "score": best_score}


def confirm_match(speaker_label: str, audio_clip_url: str, confirmed: bool, correct_speaker_label: str = None) -> dict:
    """Call this from the admin review queue when a human answers a
    'is this [name]?' prompt. This is the active-learning step:
      - confirmed=True: add this clip as a new enrollment sample for that
        speaker (origin='confirmed_correction' in speaker_voice_samples).
        Growing the sample set is what improves future matches.
      - confirmed=False + correct_speaker_label given: the model guessed
        wrong. Enroll this clip against the CORRECT speaker instead —
        every correction is also a free extra training sample.
      - confirmed=False + no correct_speaker_label: genuinely unknown to
        the team too. Leave unenrolled; don't guess.
    """
    if confirmed:
        voiceprint = enroll_speaker(speaker_label, audio_clip_url)
        return {"action": "enrolled_confirmation", "speaker_label": speaker_label, "voiceprint": voiceprint}
    elif correct_speaker_label:
        voiceprint = enroll_speaker(correct_speaker_label, audio_clip_url)
        return {"action": "enrolled_correction", "speaker_label": correct_speaker_label, "voiceprint": voiceprint}
    else:
        return {"action": "left_unknown"}


def resolve_speaker_identity(context_signal: str, context_confidence: str, context_name: str,
                              audio_clip_url: str, enrolled_voiceprints: dict) -> dict:
    """The fusion step: combine Gemini's context-based guess (video title,
    on-screen text, spoken introduction — see extract_from_video.py) with
    pyannoteAI's voice-based match. Context is treated as the primary
    signal since it's usually cheaper and more explicit; voice is the
    reinforcement and tie-breaker, and the safety check against a
    misleading title or mistaken introduction.

    enrolled_voiceprints: dict of {speaker_label: voiceprint_string} for
    everyone already enrolled (pyannoteAI has no server-side speaker
    registry — we own storing and re-submitting the actual voiceprint
    values every time, not just an id).

    Returns one of:
      - auto_assign: confident enough to publish without a human check
      - auto_assign_new_enrollment: confident context match for someone
        NOT yet enrolled — assign AND bootstrap their voiceprint from this
        clip, but flag it for a lightweight non-blocking spot-check rather
        than silently trusting a single unconfirmed signal forever
      - needs_confirmation: signals disagree, or neither is strong enough
        alone — surface both pieces of evidence to the human
      - caller: an anonymous call-in speaker (see CALLER_SIGNAL) — labeled
        and quoted, but never enrolled or voice-matched against anyone
      - unknown: nothing usable
    """
    if context_signal == CALLER_SIGNAL:
        # A phone-in caller is intentionally never named or tracked as a
        # persistent identity -- enrolling a voiceprint under the shared
        # generic label 'Caller' would silently conflate every caller who
        # ever phones in as "the same person" for future voice matching,
        # which is both wrong and exactly the kind of un-requested identity
        # tracking this decision explicitly rules out. No enrollment, no
        # voice-matching attempt at all; just pass the label through.
        return {"decision": "caller", "speaker_label": "Caller", "evidence": CALLER_SIGNAL, "score": None}

    has_context = context_signal not in (None, "none", "voice_only_no_context") and context_confidence == "high"
    already_enrolled = context_name in enrolled_voiceprints if context_name else False

    voice_result = None
    if enrolled_voiceprints:
        voice_result = identify_segment(audio_clip_url, enrolled_voiceprints)

    if has_context and not already_enrolled:
        # Strong context signal (title/on-screen/introduction), person not
        # enrolled yet: assign now, bootstrap enrollment, flag for a
        # non-blocking spot-check rather than requiring confirmation before
        # publishing — this is what keeps the workflow light.
        voiceprint = enroll_speaker(context_name, audio_clip_url)
        return {
            "decision": "auto_assign_new_enrollment",
            "speaker_label": context_name,
            "evidence": f"context:{context_signal}",
            "voiceprint": voiceprint,
            "spot_check_recommended": True,
        }

    if has_context and already_enrolled and voice_result:
        if voice_result["decision"] == "auto_assign" and voice_result["speaker_id"] == context_name:
            # Context and voice agree — highest-confidence case.
            return {"decision": "auto_assign", "speaker_label": context_name,
                    "evidence": f"context:{context_signal}+voice_agree", "score": voice_result["score"]}
        if voice_result["decision"] in ("auto_assign", "needs_confirmation") and voice_result["speaker_id"] != context_name:
            # Context says one person, voice matches a DIFFERENT enrolled
            # person. Real disagreement — never auto-resolve this silently.
            return {"decision": "needs_confirmation", "speaker_label": context_name,
                    "evidence": f"DISAGREEMENT: context says {context_name}, voice matches a different enrolled speaker",
                    "score": voice_result["score"]}
        # Context high-confidence, voice inconclusive either way — trust context.
        return {"decision": "auto_assign", "speaker_label": context_name,
                "evidence": f"context:{context_signal}, voice inconclusive", "score": None}

    if voice_result:
        # No usable context signal — fall back to voice-only routing.
        return voice_result

    return {"decision": "unknown", "speaker_id": None, "score": 0}


if __name__ == "__main__":
    print(__doc__)
    print(f"AUTO_ASSIGN_THRESHOLD={AUTO_ASSIGN_THRESHOLD}, CONFIRM_THRESHOLD={CONFIRM_THRESHOLD}")
    print("Import enroll_speaker / identify_segment / confirm_match into your ingestion pipeline.")
