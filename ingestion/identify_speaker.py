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
import requests

PYANNOTE_API_BASE = "https://api.pyannote.ai/v1"

# Tune these based on real results, same guidance pyannoteAI gives:
# if enrolled speakers keep showing up as unknown, lower CONFIRM_THRESHOLD.
# if wrong names get auto-assigned, raise AUTO_ASSIGN_THRESHOLD.
AUTO_ASSIGN_THRESHOLD = 80   # >= this: assign automatically, no human check needed
CONFIRM_THRESHOLD = 45       # >= this but < auto-assign: ask a human to confirm
# below CONFIRM_THRESHOLD: leave as unknown_speaker, no suggestion shown


def _headers():
    key = os.environ.get("PYANNOTE_API_KEY")
    if not key:
        raise RuntimeError("Set PYANNOTE_API_KEY before calling the speaker-ID API.")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def enroll_speaker(speaker_label: str, audio_clip_url: str) -> str:
    """Create or extend a voiceprint for a speaker from a clean audio clip
    (~20-30 seconds of that person, ideally without overlapping speech).
    Returns a voiceprint reference id to store in speakers.voiceprint_ref
    (or, for an additional sample on an already-enrolled speaker, this is
    what gets called again during confirm_match below).
    """
    resp = requests.post(
        f"{PYANNOTE_API_BASE}/voiceprint",
        headers=_headers(),
        json={"label": speaker_label, "audio_url": audio_clip_url},
    )
    resp.raise_for_status()
    return resp.json()["voiceprint_id"]


def identify_segment(audio_clip_url: str, enrolled_voiceprint_ids: list) -> dict:
    """Match a segment's audio against the enrolled voiceprint set.
    Returns a routing decision, not just a raw score — this is the piece
    that turns "a number" into "what should the review queue actually do."
    """
    resp = requests.post(
        f"{PYANNOTE_API_BASE}/identify",
        headers=_headers(),
        json={"audio_url": audio_clip_url, "voiceprint_ids": enrolled_voiceprint_ids},
    )
    resp.raise_for_status()
    result = resp.json()

    best = max(result.get("candidates", []), key=lambda c: c["score"], default=None)
    if best is None:
        return {"decision": "unknown", "speaker_id": None, "score": 0}

    if best["score"] >= AUTO_ASSIGN_THRESHOLD:
        return {"decision": "auto_assign", "speaker_id": best["voiceprint_id"], "score": best["score"]}
    elif best["score"] >= CONFIRM_THRESHOLD:
        return {"decision": "needs_confirmation", "speaker_id": best["voiceprint_id"], "score": best["score"]}
    else:
        return {"decision": "unknown", "speaker_id": None, "score": best["score"]}


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
        voiceprint_id = enroll_speaker(speaker_label, audio_clip_url)
        return {"action": "enrolled_confirmation", "speaker_label": speaker_label, "voiceprint_id": voiceprint_id}
    elif correct_speaker_label:
        voiceprint_id = enroll_speaker(correct_speaker_label, audio_clip_url)
        return {"action": "enrolled_correction", "speaker_label": correct_speaker_label, "voiceprint_id": voiceprint_id}
    else:
        return {"action": "left_unknown"}


def resolve_speaker_identity(context_signal: str, context_confidence: str, context_name: str,
                              audio_clip_url: str, enrolled_voiceprint_ids: dict) -> dict:
    """The fusion step: combine Gemini's context-based guess (video title,
    on-screen text, spoken introduction — see extract_from_video.py) with
    pyannoteAI's voice-based match. Context is treated as the primary
    signal since it's usually cheaper and more explicit; voice is the
    reinforcement and tie-breaker, and the safety check against a
    misleading title or mistaken introduction.

    enrolled_voiceprint_ids: dict of {speaker_label: voiceprint_id} for
    everyone already enrolled.

    Returns one of:
      - auto_assign: confident enough to publish without a human check
      - auto_assign_new_enrollment: confident context match for someone
        NOT yet enrolled — assign AND bootstrap their voiceprint from this
        clip, but flag it for a lightweight non-blocking spot-check rather
        than silently trusting a single unconfirmed signal forever
      - needs_confirmation: signals disagree, or neither is strong enough
        alone — surface both pieces of evidence to the human
      - unknown: nothing usable
    """
    has_context = context_signal not in (None, "none", "voice_only_no_context") and context_confidence == "high"
    already_enrolled = context_name in enrolled_voiceprint_ids if context_name else False

    voice_result = None
    if enrolled_voiceprint_ids:
        voice_result = identify_segment(audio_clip_url, list(enrolled_voiceprint_ids.values()))

    if has_context and not already_enrolled:
        # Strong context signal (title/on-screen/introduction), person not
        # enrolled yet: assign now, bootstrap enrollment, flag for a
        # non-blocking spot-check rather than requiring confirmation before
        # publishing — this is what keeps the workflow light.
        voiceprint_id = enroll_speaker(context_name, audio_clip_url)
        return {
            "decision": "auto_assign_new_enrollment",
            "speaker_label": context_name,
            "evidence": f"context:{context_signal}",
            "voiceprint_id": voiceprint_id,
            "spot_check_recommended": True,
        }

    if has_context and already_enrolled and voice_result:
        if voice_result["decision"] == "auto_assign" and voice_result["speaker_id"] == enrolled_voiceprint_ids[context_name]:
            # Context and voice agree — highest-confidence case.
            return {"decision": "auto_assign", "speaker_label": context_name,
                    "evidence": f"context:{context_signal}+voice_agree", "score": voice_result["score"]}
        if voice_result["decision"] in ("auto_assign", "needs_confirmation") and voice_result["speaker_id"] != enrolled_voiceprint_ids[context_name]:
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
