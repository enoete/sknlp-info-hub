"""
SKNLP Info Hub — video ingestion agent (v0)

Takes a YouTube URL, sends it directly to Gemini (no download/transcription
step needed — Gemini watches and listens to the video itself), and returns
structured segments + candidate claims ready to insert into the review
queue as `pending_review` rows.

This does NOT publish anything automatically. Output is always a batch of
candidates for a human to approve/edit/reject in the admin queue — same
rule as manual entry, just with the drafting done for you instead of by
hand.

Setup:
    pip install google-genai
    export GEMINI_API_KEY=your_key_here

Usage:
    python extract_from_video.py "https://www.youtube.com/watch?v=XXXXXXXX" \
        --source-type opposition --category-hint "Water,Healthcare,Economy"

Output: JSON printed to stdout, matching the shape needed for
`sources` / `transcript_segments` / `claims` inserts. Pipe this into
your own loader script once the admin API exists, or eyeball it directly
for now.
"""

import argparse
import json
import os
import sys
import requests
from google import genai

# Known figures to help Gemini attempt named identification instead of
# generic "Speaker 1" / "Speaker 2" labels. Keep this list current —
# political roles here change (see CLAUDE.md: PAM leadership, elections).
# Titles are intentionally omitted here; the model is asked to describe
# the role AS STATED IN THE VIDEO, not from this list, to avoid baking in
# a stale title.
KNOWN_FIGURES = [
    "Dr. Terrance Drew (Prime Minister, SKNLP)",
    "Timothy Harris",
    "Shawn Richards",
    "Mark Brantley (Premier of Nevis)",
    "Natasha Grey-Brookes",
    "Janice Daniel-Hodge (NRP)",
]

CATEGORIES = [
    "Economy", "Water", "Healthcare", "Education", "Housing", "Agriculture",
    "Security", "Tourism", "Energy", "Social Protection", "Governance", "Other"
]

SENTIMENTS = ["positive", "neutral", "negative", "critical"]

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "video_summary": {"type": "string"},
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker_label": {
                        "type": "string",
                        "description": "Named figure if identifiable (from on-screen text, introduction, or clear context), otherwise a generic label like 'Speaker 1'."
                    },
                    "speaker_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "How confident the identification is. 'high' only if driven by a clear signal (see identification_signal)."
                    },
                    "identification_signal": {
                        "type": "string",
                        "enum": ["video_title", "channel_identity", "on_screen_text", "spoken_introduction", "self_identified", "voice_only_no_context", "none"],
                        "description": "Which signal actually drove this identification. Be honest — if you're inferring from topic/familiarity rather than an explicit cue, use 'voice_only_no_context' or 'none', not one of the explicit-signal values."
                    },
                    "role_as_stated": {
                        "type": "string",
                        "description": "The speaker's role/title AS STATED OR SHOWN in this video, not assumed from outside knowledge. Empty string if not stated."
                    },
                    "start_timestamp": {"type": "string", "description": "MM:SS"},
                    "end_timestamp": {"type": "string", "description": "MM:SS"},
                    "text": {"type": "string"},
                    "sentiment": {"type": "string", "enum": SENTIMENTS}
                },
                "required": ["speaker_label", "speaker_confidence", "start_timestamp", "end_timestamp", "text", "sentiment"]
            }
        },
        "candidate_claims": {
            "type": "array",
            "description": "Only include segments that state something concrete and specific enough to be a factual claim (a policy, a number, a completed or in-progress project, an accusation about government performance). Do NOT include generic rhetoric, greetings, or vague statements with nothing checkable in them.",
            "items": {
                "type": "object",
                "properties": {
                    "stance": {
                        "type": "string",
                        "enum": ["accomplishment", "opposition_statement"],
                        "description": "accomplishment = government/party describing something it did. opposition_statement = criticism or a claim made against the government/party."
                    },
                    "title": {"type": "string", "description": "Short, neutral label for the claim, under 12 words."},
                    "summary": {"type": "string", "description": "1-2 sentence paraphrase in plain language. Do not quote more than a short phrase verbatim."},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "sentiment": {
                        "type": "string",
                        "enum": SENTIMENTS,
                        "description": "Tone of the claim as stated: 'positive'/'negative' for a straightforward good/bad framing, 'critical' specifically for an opposition_statement leveling criticism at the government, 'neutral' for a plain factual statement with no evaluative framing."
                    },
                    "start_timestamp": {"type": "string", "description": "MM:SS — where this claim starts in the video"},
                    "extraction_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "low if the claim is vague, ambiguous, or you're inferring rather than reading a direct statement"
                    }
                },
                "required": ["stance", "title", "summary", "category", "sentiment", "start_timestamp", "extraction_confidence"]
            }
        }
    },
    "required": ["video_summary", "segments", "candidate_claims"]
}


def fetch_video_metadata(youtube_url: str) -> dict:
    """Pull title + channel name via YouTube's public oEmbed endpoint —
    no API key needed. This is a cheap, high-value signal: a video titled
    'Hon. Mark Brantley - Aug 25 2026' or uploaded on the SKNLP official
    channel tells you a lot about who's in it before you even analyze the
    content. Always feed this to the model explicitly rather than relying
    on it to infer everything from the video alone."""
    try:
        resp = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": youtube_url, "format": "json"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return {"title": data.get("title", ""), "channel": data.get("author_name", "")}
    except Exception as e:
        print(f"Warning: couldn't fetch video metadata ({e}). Continuing without it.", file=sys.stderr)
        return {"title": "", "channel": ""}


def build_prompt(source_type: str, category_hint: str, video_title: str, channel_name: str) -> str:
    figures_list = "\n".join(f"- {f}" for f in KNOWN_FIGURES)
    metadata_block = ""
    if video_title or channel_name:
        metadata_block = f"""
Video metadata (use this as a strong signal for speaker identification —
titles and channel names often name who's featured; weigh this alongside
what you see/hear in the video itself, not instead of it):
- Title: {video_title or '(not available)'}
- Channel: {channel_name or '(not available)'}
"""
    return f"""
You are drafting entries for a fact-sourced political archive. Watch and
listen to this video and extract structured information. Be conservative:
when in doubt, mark confidence as 'low' rather than guessing.
{metadata_block}
Known figures who may appear (use this to help identify speakers, but only
mark speaker_confidence as 'high' if the identity is actually clear from
one or more of: the video title, the channel, an on-screen name/lower
third, a spoken introduction, or the speaker naming themselves — not from
assuming based on topic or general familiarity):
{figures_list}

This video is expected to be primarily {source_type} content.
Likely categories for claims: {category_hint or ', '.join(CATEGORIES)}.

For candidate_claims: only extract statements specific and concrete enough
to be checked against a record — a number, a named project, a specific
policy, a specific accusation. Skip generic political rhetoric, greetings,
and applause lines with nothing factual in them. It is better to extract
fewer, higher-confidence claims than many vague ones — a human reviews
every one of these before anything is published, so err toward precision.

Never invent a claim that isn't actually stated in the video.
"""


def extract(youtube_url: str, source_type: str, category_hint: str, model: str = "gemini-2.5-flash") -> dict:
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    metadata = fetch_video_metadata(youtube_url)

    response = client.models.generate_content(
        model=model,
        contents=[
            {"file_data": {"file_uri": youtube_url, "mime_type": "video/mp4"}},
            {"text": build_prompt(source_type, category_hint, metadata["title"], metadata["channel"])},
        ],
        config={
            "response_mime_type": "application/json",
            "response_schema": RESPONSE_SCHEMA,
        },
    )
    result = json.loads(response.text)
    result["_video_metadata"] = metadata
    return result


def to_review_queue_rows(extraction: dict, youtube_url: str, source_type: str) -> list:
    """Reshape the raw extraction into rows matching the sources/claims
    schema, tagged for human review. This is a draft shape — wire it to
    your actual DB insert logic once the admin API exists."""
    rows = []
    for claim in extraction.get("candidate_claims", []):
        rows.append({
            "review_status": "pending_review",
            "extracted_by": "gemini_agent",
            "stance": claim["stance"],
            "title": claim["title"],
            "summary": claim["summary"],
            "category": claim["category"],
            "sentiment": claim["sentiment"],
            "extraction_confidence": claim["extraction_confidence"],
            "source_origin_url": youtube_url,
            "source_type": source_type,
            "video_timestamp": claim["start_timestamp"],
        })
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract candidate claims from a YouTube video via Gemini.")
    parser.add_argument("youtube_url", help="Full YouTube video URL")
    parser.add_argument("--source-type", default="official_party",
                         choices=["official_party", "official_govt", "opposition", "press"])
    parser.add_argument("--category-hint", default="", help="Comma-separated category hints, optional")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    extraction = extract(args.youtube_url, args.source_type, args.category_hint)
    review_rows = to_review_queue_rows(extraction, args.youtube_url, args.source_type)

    print(json.dumps({
        "video_summary": extraction["video_summary"],
        "segments_found": len(extraction.get("segments", [])),
        "candidate_claims": review_rows,
        "low_confidence_speakers": [
            s for s in extraction.get("segments", [])
            if s.get("speaker_confidence") == "low"
        ],
    }, indent=2))
