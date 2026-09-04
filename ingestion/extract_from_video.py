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
    pip install -r requirements.txt   # see requirements.txt, run inside a venv
    export GEMINI_API_KEY=your_key_here
    export YOUTUBE_DATA_API_KEY=your_key_here   # only needed for videos long
        # enough to trigger the chunked-extraction fallback -- see
        # video_chunking.py's module docstring for why this is required

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
import time

import requests
from google import genai
from google.genai import errors as genai_errors

from segment_utils import mmss_to_seconds, seconds_to_mmss
from video_chunking import DEFAULT_CHUNK_SECONDS, compute_chunk_windows, get_video_duration_seconds

# Known figures to help Gemini attempt named identification instead of
# generic "Speaker 1" / "Speaker 2" labels, AND -- just as important --
# to establish which side of the aisle each one actually sits on. Keep
# this list current -- political roles here change (see CLAUDE.md: PAM
# leadership, elections), and a stale/incomplete list is exactly what
# caused a real bug (2026-08-31): several sitting SKNLP ministers not on
# this list (Maynard, Clarke, Wilkin, Phillip, Hanley, Douglas, Duggins,
# Henderson) had their own National Assembly floor statements mislabeled
# stance='opposition_statement' simply because the content sounded
# critical (they were criticizing the PREVIOUS administration) and the
# model had no explicit signal that the speaker was a CURRENT government
# minister. Titles are intentionally omitted here beyond a short party/
# side tag -- the model is asked to describe the role AS STATED IN THE
# VIDEO, not from this list, to avoid baking in a stale specific title.
KNOWN_FIGURES = [
    # Current SKNLP government (accomplishment side) -- full Cabinet as of
    # 2026-08-31, confirmed by the person who commissioned this project:
    "Dr. Terrance Drew — SKNLP, Prime Minister",
    "Dr. Geoffrey Ian Hanley — SKNLP, Deputy Prime Minister",
    "Dr. Denzil Douglas — SKNLP, Minister of Foreign Affairs",
    "Konris Maynard — SKNLP, Minister of Public Infrastructure",
    "Marsha Henderson — SKNLP, Minister of Tourism",
    "Samal Duggins — SKNLP, Minister of Agriculture",
    "Dr. Joyelle Clarke — SKNLP, Minister of Sustainable Development",
    "Garth Wilkin — SKNLP, Attorney-General",
    "Isalean Phillip — SKNLP, Minister of State",
    # Opposition figures (opposition_statement side when criticizing the
    # CURRENT SKNLP government -- see the stance field's own description
    # for the critical distinction: praising/defending THEIR OWN prior
    # administration's record is neither accomplishment nor
    # opposition_statement, it's out of this archive's scope entirely):
    "Timothy Harris — PLP leader, former Prime Minister (Team Unity, 2015-2022)",
    "Shawn Richards — PAM",
    "Mark Brantley — Premier of Nevis, opposition-aligned nationally",
    "Natasha Grey-Brookes — PAM (former leader)",
    "Janice Daniel-Hodge — NRP",
]

# The solo-commentary channel hosts -- not political figures, so kept
# separate from KNOWN_FIGURES, but their speaker_label needs the exact
# same canonical-string treatment (see that field's description below)
# so "who said this" filtering doesn't fragment one real person across
# several near-identical name strings. Confirmed the hard way 2026-08-31:
# the speaker-name backfill (backfill_speaker_name.py, which imports this
# same dict) produced both "Ian Liburd" and "Ian \"Patches\" Liburd" for
# the same person before this canonical form was made explicit and
# enforced in both scripts' prompts.
CHANNEL_HOSTS = {
    "Talk SKN - Kyle Flanders": "Kyle Flanders",
    "Straight Talk": "Ian \"Patches\" Liburd",
}

# Expanded 2026-09-01, prompted directly by the gov.kn "National
# Accomplishments" source (see CLAUDE.md): its own "Sports & Entertainment"
# sector page had nowhere honest to land -- all 3 of its claims got
# force-fitted into 'Other'. Auditing the existing 'Other' bucket (36
# claims) surfaced two more real, coherent clusters that had been
# silently absorbed into 'Governance' and 'Other': a distinct digital-
# government/IT cluster (eTA, SMARTS, digital ID, "Voice It" AI assistant
# -- 13+ claims, mostly diluting 'Governance' between political/legal
# process and e-government systems) and roads/public-works content with
# no honest home at all. 'Sports' and 'Culture & Entertainment' are two
# SEPARATE categories, per explicit instruction (2026-09-01) -- sports
# (stadiums, athletics, cricket) reads as a distinct enough cluster on
# its own to warrant its own category rather than folding into culture;
# 'Entertainment' on its own would start near-empty (no distinctly-
# entertainment content in the corpus yet, only culture/arts), so it's
# merged with Culture rather than given a fourth, likely-empty slot.
# Digital HEALTH tools (NDHIS, WellCare card) stay under Healthcare on
# purpose, not IT & Digital Governance -- the story there is the health
# delivery outcome, not the technology itself.
CATEGORIES = [
    "Economy", "Water", "Healthcare", "Education", "Housing", "Agriculture",
    "Security", "Tourism", "Energy", "Social Protection", "Governance",
    "Sports", "Culture & Entertainment", "Environment", "Infrastructure",
    "Information Technology & Digital Governance", "Other"
]

SENTIMENTS = ["positive", "neutral", "negative", "critical"]

# Sub-classification within stance='accomplishment' only -- see
# schema.sql's claims.accomplishment_type comment for why this exists
# separately from stance. Definitions kept short and mutually
# distinguishable so the model doesn't have to guess at the boundary:
ACCOMPLISHMENT_TYPES = ["Accomplishment", "Policy Decision", "Strategic Decision", "Ongoing Initiative"]
# Sentinel for stance='opposition_statement', where this field doesn't
# apply. Not an empty string -- Gemini's response_schema validator rejects
# an empty string as an enum value (confirmed: real 400 INVALID_ARGUMENT,
# "enum[...] cannot be empty"), so this needs a real non-empty token.
# run_ingestion.py/backfill scripts normalize this back to NULL before it
# ever reaches the DB (see schema.sql's CHECK constraint, which has no
# 'N/A' in its allowed set on purpose).
ACCOMPLISHMENT_TYPE_NA = "N/A"


def normalize_accomplishment_type(value) -> str | None:
    """The model's raw accomplishment_type value -> what actually belongs
    in claims.accomplishment_type (NULL for the N/A sentinel, an empty
    value, or anything else that isn't one of the real types -- the DB's
    own CHECK constraint would reject a stray value anyway, so fail safe
    to NULL rather than let an INSERT error take down a whole batch)."""
    value = (value or "").strip()
    return value if value in ACCOMPLISHMENT_TYPES else None

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
                        "description": "Named figure if identifiable (from on-screen text, introduction, or clear context), otherwise a generic label like 'Speaker 1'. For a caller phoning into a call-in program (e.g. Straight Talk), always use the literal generic label 'Caller' — never transcribe or guess a name/surname even if the host uses one on air; callers are deliberately never named in this system. If the speaker is one of the KNOWN_FIGURES listed above, use ONLY the name portion before the em-dash (e.g. 'Dr. Terrance Drew', not 'Dr. Terrance Drew — SKNLP, Prime Minister') — but use that exact name string, not a shorter or differently-formatted version — e.g. 'Ian \"Patches\" Liburd', not 'Ian Liburd'; this field is used for per-person filtering, so the same real person must always come back as the exact same string."
                    },
                    "speaker_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "How confident the identification is. 'high' only if driven by a clear signal (see identification_signal). A phone-in caller should be 'high' — the call-in format itself is the confirming signal, not a lower confidence just because no name is given."
                    },
                    "identification_signal": {
                        "type": "string",
                        "enum": ["video_title", "channel_identity", "on_screen_text", "spoken_introduction", "self_identified", "caller_phoned_in", "voice_only_no_context", "none"],
                        "description": "Which signal actually drove this identification. Be honest — if you're inferring from topic/familiarity rather than an explicit cue, use 'voice_only_no_context' or 'none', not one of the explicit-signal values. Use 'caller_phoned_in' specifically for a member of the public calling into a talk program — this is a distinct, deliberate case, not a failed identification."
                    },
                    "role_as_stated": {
                        "type": "string",
                        "description": "The speaker's role/title AS STATED OR SHOWN in this video, not assumed from outside knowledge. Empty string if not stated. For a phone-in caller, use 'Caller' here too, so this consistent label is what gets stored as the historical speaker_title_at_time for the claim."
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
            "description": (
                "Only include segments that state something concrete and specific enough to be a "
                "factual claim (a policy, a number, a completed or in-progress project, an accusation "
                "about government performance). Do NOT include generic rhetoric, greetings, or vague "
                "statements with nothing checkable in them. CRITICAL SCOPE RULE, checked before stance: "
                "this archive covers ONLY the current St. Kitts and Nevis Labour Party (SKNLP) "
                "administration's term, which began August 5, 2022 (Dr. Terrance Drew, Prime Minister). "
                "If a claim is solely about what a PREVIOUS/DIFFERENT administration (e.g. the "
                "2015-2022 Team Unity/PLP-led government) did, achieved, or is proud of -- even when a "
                "current opposition figure who served in that prior administration is describing their "
                "own past record, favorably or not -- DO NOT extract it as a candidate_claim at all. It "
                "is out of scope regardless of stance; it is not an SKNLP accomplishment (wrong party) "
                "and not a valid opposition_statement either (not criticism of the CURRENT government). "
                "Only extract it if it is being used as direct, explicit context for a claim ABOUT the "
                "current SKNLP administration (e.g. an opposition figure contrasting past performance "
                "against a specific current-government failure) -- and even then, stance describes the "
                "part of the statement that is actually about the current administration. "
                "This exclusion applies with EQUAL FORCE when a CURRENT SKNLP official is the speaker, "
                "not just an opposition figure -- confirmed live 2026-08-31 (a PM Drew statement that "
                "the prior government spent $14.4M without laying a construction block, and a separate "
                "Konris Maynard statement alleging the prior government spent $14M on 'dirt management' "
                "at the same site, were both wrongly extracted as SKNLP accomplishment claims and had to "
                "be manually rejected -- do not repeat this). The test is what the claim's substance is "
                "actually about, never who is speaking: a CURRENT official narrating or criticizing a "
                "specific dollar figure, project failure, or budget decision that the PREVIOUS "
                "administration itself made is STILL solely about the previous administration's own "
                "record, and must be excluded, exactly as if an opposition figure had said it. Only "
                "extract it, tagged accomplishment, when the claim's own substance is a CURRENT "
                "government action taken in response to that history (an audit ordered, funds "
                "recovered, a law amended, a replacement project launched) -- in that case the claim is "
                "about the current action, with the historical failure serving only as context, not the "
                "reverse. Quick self-check: if the only honest accomplishment_type for a claim would be "
                "none of the four real categories (i.e. you would need to leave it blank or force a "
                "bad fit), that is itself a strong signal the claim is actually excluded scope, not a "
                "real accomplishment -- don't extract a claim you can't honestly type. "
                "GOVERNMENT-ACTOR RULE, checked together with the rule above: a claim is only in scope "
                "if a government body itself -- a ministry, a statutory/state-owned corporation (NHC, "
                "NEVLEC, SKELEC, Water Services, Social Security Board, etc.), or a government minister/"
                "official acting in that official capacity -- is the one actually taking the action, "
                "decision, or expenditure the claim describes. A government-aligned channel (ZIZ, "
                "SKNIS) simply airing or reporting on a PRIVATE company's own business decision, "
                "sponsorship, product launch, or a private club/association's own event -- with no "
                "government ministry, agency, or official as a direct party to the action itself -- is "
                "NOT in scope, regardless of stance, even when the coverage is favorable or frames it as "
                "good news for the country. Confirmed real case, 2026-09-04: 'S.L. Horsford & Company "
                "Limited partnered with ZIZ Broadcasting Corporation as the title sponsor for the 2026 "
                "Kittitian Superstar competition' was wrongly extracted as an SKNLP 'Strategic Decision' "
                "-- no government body was a party to that sponsorship deal, it is a private company's "
                "own marketing decision that a state broadcaster happened to air. A named private "
                "sports club/association running its own program (e.g. a sporting association's summer "
                "camp) with no stated government funding or ministry involvement is the same failure "
                "mode. A claim that fails this rule has no government actor at all and must not be "
                "extracted as a candidate_claim in the first place, at any featured value. "
                "DECISIONS/INITIATIVES/ACHIEVEMENTS ONLY RULE (corrected 2026-09-04, supersedes any "
                "earlier instinct to extract low-value content 'just in case, with featured=false'): for "
                "stance='accomplishment', only extract a claim that honestly earns one of the four real "
                "accomplishment_type values (Accomplishment / Policy Decision / Strategic Decision / "
                "Ongoing Initiative) -- a genuine decision, initiative, or achievement. Do NOT extract, "
                "at ANY featured value: a routine operational or service notice (a scheduled utility "
                "outage, a maintenance notice, a routine public-service announcement with no decision or "
                "policy content -- e.g. 'SKELEC schedules island-wide maintenance outages' is NOT in "
                "scope); an active investigation into a crime or incident, reported as still unfolding "
                "(e.g. 'police investigate a double homicide' is NOT in scope -- but a completed "
                "enforcement action taken under a stated initiative, such as an arrest total reported "
                "as part of a named anti-crime campaign, or a new criminal justice LAW passed, IS in "
                "scope as a real accomplishment); a purely ceremonial or social event with no new "
                "decision attached (an anniversary thanksgiving service, a ribbon-cutting with nothing "
                "new announced); or a bare routine statistic mentioned with no accompanying decision or "
                "initiative. Confirmed real cases, 2026-09-04: an RSCNPF double-homicide investigation "
                "and a SKELEC scheduled-outage notice had both been extracted as accomplishment claims "
                "(with featured=false) and were still cluttering the admin Review Queue -- per explicit "
                "instruction, these must not be extracted at all, not merely hidden from public view. "
                "`featured=false` is now reserved ONLY for a claim that DOES honestly earn a real "
                "accomplishment_type but is nonetheless minor or reactive rather than a policy win (e.g. "
                "a single school closure ordered in direct response to one incident) -- it is not a way "
                "to keep a non-qualifying claim in the corpus for chatbot searchability. A citizen asking "
                "about a specific ongoing crime investigation or a maintenance outage should get 'no "
                "record found,' not a hit -- this is a deliberate scope narrowing, not an oversight."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "stance": {
                        "type": "string",
                        "enum": ["accomplishment", "opposition_statement"],
                        "description": (
                            "Classify by WHO the claim's content is actually about (the current SKNLP "
                            "administration, in office since Aug 5 2022) and, separately, WHO is "
                            "speaking -- these are not the same question, and conflating them is a "
                            "confirmed real bug (see KNOWN_FIGURES comment above). "
                            "'accomplishment' = describes something the CURRENT SKNLP government did, "
                            "decided, or is doing -- this includes a CURRENT government minister citing "
                            "history while describing the CURRENT government's OWN resulting action "
                            "(e.g. 'the prior government left the land registry in disarray, so we "
                            "ordered a full audit' -- here the claim is about the audit, a current "
                            "action). It does NOT include a bare allegation about what the PREVIOUS "
                            "administration itself spent, built, or decided, even when a current "
                            "official is the one saying it critically (e.g. 'the prior government spent "
                            "$14M on X without building anything') -- that content is solely about the "
                            "previous administration's own record and is OUT OF SCOPE per the CRITICAL "
                            "SCOPE RULE above, regardless of who states it; do not extract it as "
                            "accomplishment just because the speaker currently holds SKNLP office. "
                            "'opposition_statement' = criticism made by an opposition-aligned speaker "
                            "AGAINST the CURRENT SKNLP government specifically -- not against a prior "
                            "administration, and not a prior administration's own achievements being "
                            "recounted by an opposition figure (see the CRITICAL SCOPE RULE above -- "
                            "that case should not be extracted as a claim at all). "
                            "When in doubt about which administration a claim is really about, check "
                            "the speaker against the KNOWN_FIGURES list above for their actual current "
                            "affiliation rather than inferring it from tone alone."
                        )
                    },
                    "title": {"type": "string", "description": "Short, neutral label for the claim, under 12 words."},
                    "summary": {"type": "string", "description": "1-2 sentence paraphrase in plain language. Do not quote more than a short phrase verbatim."},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "accomplishment_type": {
                        "type": "string",
                        "enum": ACCOMPLISHMENT_TYPES + [ACCOMPLISHMENT_TYPE_NA],
                        "description": (
                            f"REQUIRED for stance='accomplishment'; '{ACCOMPLISHMENT_TYPE_NA}' for "
                            "stance='opposition_statement' (this field doesn't apply to opposition claims). "
                            "For an accomplishment claim, pick exactly one: "
                            "'Accomplishment' = a completed, concrete deliverable — a project finished, a facility "
                            "built/opened, a service actually launched, a benefit actually delivered. "
                            "'Policy Decision' = a formal policy/law/regulation/rate adopted or changed — decided "
                            "and in effect, but not a physical thing built. "
                            "'Strategic Decision' = a directional commitment — a partnership, MOU, membership, "
                            "framework agreement, or stated strategic plan — a choice of direction, not yet a "
                            "specific delivered project or codified policy. "
                            "'Ongoing Initiative' = clearly still in progress — a program actively running, a "
                            "groundbreaking/launch of a multi-phase effort, an expansion underway — explicitly not "
                            "finished yet. Choose based on what the video actually states about completion status; "
                            "don't guess 'Accomplishment' by default just because it's the government's own claim."
                        ),
                    },
                    "sentiment": {
                        "type": "string",
                        "enum": SENTIMENTS,
                        "description": "Tone of the claim as stated: 'positive'/'negative' for a straightforward good/bad framing, 'critical' specifically for an opposition_statement leveling criticism at the government, 'neutral' for a plain factual statement with no evaluative framing."
                    },
                    "citizen_impact_suggested": {
                        "type": "string",
                        "description": "DRAFT ONLY — a human must review and explicitly promote this before it becomes the published citizen_impact; never auto-published verbatim (see schema.sql). One plain-language sentence, written directly to a resident of St. Kitts and Nevis, on what this concretely means for them day-to-day (e.g. 'Means shorter wait times at JNF General Hospital's emergency department'). Only what's actually implied by the claim itself — don't invent a benefit or harm the video didn't state or clearly imply. Empty string if the claim is too abstract to translate into a concrete citizen-facing effect."
                    },
                    "event_date_suggested": {
                        "type": "string",
                        "description": "DRAFT ONLY — a human must review and explicitly confirm/edit this before it becomes the published event_date; never auto-promoted (see schema.sql, and the review queue's planned 'confirm suggested date' card). ISO format (YYYY-MM-DD) if the video explicitly states the date this event/policy took effect or occurred. Empty string if no explicit date is stated — never infer or guess from the video's upload date alone."
                    },
                    "start_timestamp": {"type": "string", "description": "MM:SS — where this claim starts in the video"},
                    "extraction_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "low if the claim is vague, ambiguous, or you're inferring rather than reading a direct statement"
                    },
                    "featured": {
                        "type": "boolean",
                        "description": (
                            "true for genuine government policy, decision, project, budget item, or "
                            "initiative (or, for opposition_statement, a specific documented allegation "
                            "about government performance). false ONLY for a claim that DOES honestly "
                            "earn a real accomplishment_type but is nonetheless minor/reactive rather "
                            "than a policy win (e.g. a single school closure ordered in direct response "
                            "to one incident, with no broader policy attached). Do NOT use featured=false "
                            "as a way to still extract a claim that isn't a real decision/initiative/"
                            "achievement at all -- a routine notice, an unfolding crime investigation, a "
                            "ceremonial event with no new decision, or a bare statistic must not be "
                            "extracted as a candidate_claim in the first place (see the "
                            "DECISIONS/INITIATIVES/ACHIEVEMENTS ONLY RULE above) -- there is no featured "
                            "value that makes those in scope."
                        ),
                    }
                },
                "required": ["stance", "title", "summary", "category", "accomplishment_type", "sentiment", "citizen_impact_suggested", "event_date_suggested", "start_timestamp", "extraction_confidence", "featured"]
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


def build_prompt(source_type: str, category_hint: str, video_title: str, channel_name: str, chunk_context: dict | None = None) -> str:
    figures_list = "\n".join(f"- {f}" for f in KNOWN_FIGURES)
    hosts_list = "\n".join(f"- On {org}, an unnamed host speaking is {name}" for org, name in CHANNEL_HOSTS.items())
    metadata_block = ""
    if video_title or channel_name:
        metadata_block = f"""
Video metadata (use this as a strong signal for speaker identification —
titles and channel names often name who's featured; weigh this alongside
what you see/hear in the video itself, not instead of it):
- Title: {video_title or '(not available)'}
- Channel: {channel_name or '(not available)'}
"""
    chunk_block = ""
    if chunk_context:
        chunk_block = f"""
IMPORTANT — this clip is part {chunk_context['index'] + 1} of {chunk_context['total']} of one
longer recording, split only because of a technical length limit; it is
NOT a standalone video. It may start or end mid-sentence/mid-proceeding —
that's expected, don't treat an abrupt start/end as anything unusual.
Report every start_timestamp/end_timestamp relative to THIS CLIP, starting
at 0:00 — never guess at or reconstruct the original full-video time, the
correct offset is added automatically afterward. If a speaker was already
introduced in an earlier part you don't have access to, still identify
them here if the on-screen text, context, or your own recognition of a
known figure (see below) makes it clear — don't down-rate confidence
purely because the introduction happened outside this clip.
"""
    return f"""
You are drafting entries for a fact-sourced political archive. Watch and
listen to this video and extract structured information. Be conservative:
when in doubt, mark confidence as 'low' rather than guessing.
{metadata_block}{chunk_block}
Known figures who may appear (use this to help identify speakers, but only
mark speaker_confidence as 'high' if the identity is actually clear from
one or more of: the video title, the channel, an on-screen name/lower
third, a spoken introduction, or the speaker naming themselves — not from
assuming based on topic or general familiarity):
{figures_list}

{hosts_list}

If this is a call-in program (e.g. Straight Talk, or any show where members
of the public phone in to speak on air): treat every caller as a distinct
speaker turn worth capturing — their statements matter and should be
extracted into candidate_claims like anyone else's — but never attempt to
identify or name a caller, even if the host uses a first name on air. Use
the exact literal label 'Caller' for both speaker_label and role_as_stated,
and identification_signal 'caller_phoned_in'. This is intentional and by
design, not a missed identification — do not lower speaker_confidence just
because no name is captured.

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


# Default video processing costs enough tokens/frame that a multi-hour
# National Assembly sitting alone can approach the model's 1,048,576-token
# input ceiling (confirmed: two real sittings failed with 400
# INVALID_ARGUMENT / token count exceeded before this was set). LOW trades
# some fine visual detail (reading small on-screen text) for roughly 4-5x
# more video fitting in the same budget -- an acceptable trade here since
# speaker identification already leans on video title/channel metadata fed
# in explicitly (see fetch_video_metadata/build_prompt), not on reading
# on-screen credits at high fidelity. Shared by both the single-call path
# and each per-chunk call in extract_long_video() below.
GEMINI_GENERATE_CONFIG = {
    "response_mime_type": "application/json",
    "response_schema": RESPONSE_SCHEMA,
    "media_resolution": "MEDIA_RESOLUTION_LOW",
}


# Between the confirmed-safe 2h03m data point and the confirmed-failing
# 3h53m one (see video_chunking.DEFAULT_CHUNK_SECONDS's comment for the
# real numbers this project measured). Below this, try a single call
# first -- cheap, and works for the overwhelming majority of videos. At or
# above it, skip straight to chunking rather than waiting for a failure:
# direct testing showed Gemini's failure mode for an oversized request
# ISN'T even consistent (400 token-ceiling once, 500 INTERNAL on an
# identical retry of the same video) -- a known-real duration is a far
# more reliable signal than any specific error string Gemini happens to
# return that day.
LONG_VIDEO_CHUNK_THRESHOLD_SECONDS = 8100  # 2h15m


def _is_likely_size_related_error(exc: Exception) -> bool:
    """Best-effort fallback signal for when the proactive duration check
    in extract_with_chunking_fallback() couldn't run (YOUTUBE_DATA_API_KEY
    unset/lookup failed) -- catches both observed real failure shapes for
    an oversized single-call request: the clean 400 'token count exceeds'
    validation error, and the less specific 500 INTERNAL that the same
    8h10m video also produced on a retry. Not a fully reliable signal on
    its own (a 500 INTERNAL could in principle be an unrelated transient
    fault) -- this is why the proactive duration check is the primary
    defense and this is only the secondary one."""
    if isinstance(exc, genai_errors.ClientError) and "token count exceeds" in str(exc):
        return True
    if isinstance(exc, genai_errors.ServerError) and "INTERNAL" in str(exc):
        return True
    return False


# Transient overload, not a real failure -- Google's own message says so
# ("Spikes in demand are usually temporary"). Seen repeatedly today across
# unrelated calls. A long chunked extraction (up to several Gemini calls
# per video) is especially exposed to this: one blip on chunk 4 of 6
# shouldn't throw away the previous 3 successful calls, so every
# generate_content call in this module goes through this retry wrapper
# rather than each call site reimplementing its own backoff.
_TRANSIENT_RETRY_DELAYS_SECONDS = (10, 30, 60)


def _generate_with_retry(client, **kwargs):
    last_exc = None
    for attempt, delay in enumerate((*_TRANSIENT_RETRY_DELAYS_SECONDS, None)):
        try:
            return client.models.generate_content(**kwargs)
        except genai_errors.ServerError as e:
            if "UNAVAILABLE" not in str(e) and "high demand" not in str(e):
                raise
            last_exc = e
            if delay is None:
                raise
            print(f"Transient 503 (attempt {attempt + 1}/{len(_TRANSIENT_RETRY_DELAYS_SECONDS) + 1}), "
                  f"retrying in {delay}s: {e}", file=sys.stderr)
            time.sleep(delay)
    raise last_exc  # pragma: no cover -- loop above always returns or raises


def extract(youtube_url: str, source_type: str, category_hint: str, model: str = "gemini-3.6-flash") -> dict:
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    metadata = fetch_video_metadata(youtube_url)

    response = _generate_with_retry(
        client,
        model=model,
        contents=[
            {"file_data": {"file_uri": youtube_url, "mime_type": "video/mp4"}},
            {"text": build_prompt(source_type, category_hint, metadata["title"], metadata["channel"])},
        ],
        config=GEMINI_GENERATE_CONFIG,
    )
    result = json.loads(response.text)
    result["_video_metadata"] = metadata
    return result


def extract_chunk(client, youtube_url: str, source_type: str, category_hint: str,
                   video_title: str, channel_name: str, start_seconds: int, end_seconds: int,
                   chunk_index: int, total_chunks: int, model: str = "gemini-3.6-flash") -> dict:
    """Same extraction as extract(), but against one time window of the
    video via video_metadata.start_offset/end_offset instead of the whole
    thing -- Gemini clips server-side from the same YouTube file_data URI,
    so this needs no local download/upload at all (see video_chunking.py's
    module docstring for why that matters on this droplet specifically).
    start_seconds/end_seconds are always real, API-confirmed boundaries
    (video_chunking.compute_chunk_windows), never a guess past the video's
    actual end -- Gemini has been confirmed to invent plausible content
    for an out-of-range offset rather than reporting anything wrong, so
    the correctness burden sits entirely on the caller passing in real
    windows, not on this function detecting a bad one."""
    response = _generate_with_retry(
        client,
        model=model,
        contents=[
            {
                "file_data": {"file_uri": youtube_url, "mime_type": "video/mp4"},
                "video_metadata": {"start_offset": f"{start_seconds}s", "end_offset": f"{end_seconds}s"},
            },
            {"text": build_prompt(
                source_type, category_hint, video_title, channel_name,
                chunk_context={"index": chunk_index, "total": total_chunks},
            )},
        ],
        config=GEMINI_GENERATE_CONFIG,
    )
    return json.loads(response.text)


def extract_long_video(youtube_url: str, source_type: str, category_hint: str,
                        model: str = "gemini-3.6-flash", chunk_seconds: int = DEFAULT_CHUNK_SECONDS) -> dict:
    """Look up the video's real duration (YouTube Data API v3 -- see
    video_chunking.get_video_duration_seconds), compute non-overlapping
    chunk_seconds-long windows that never extend past that real duration,
    extract each window separately (extract_chunk), then merge results
    back into one video-absolute-timestamped output shaped exactly like
    extract()'s return value -- so callers (run_ingestion.py) don't need
    separate handling for the chunked path. Only meant to be called when a
    direct extract() call has already failed with the token-ceiling
    error; see extract_with_chunking_fallback().

    Real, non-trivial cost: one Gemini call per chunk_seconds window
    (e.g. a 4-hour sitting is 8 separate calls at the 30-min default).
    Not the default path for a reason."""
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    metadata = fetch_video_metadata(youtube_url)

    duration = get_video_duration_seconds(youtube_url)
    windows = compute_chunk_windows(duration, chunk_seconds=chunk_seconds)
    print(f"{youtube_url}: {duration / 60:.0f} min total, {len(windows)} chunk(s) of up to {chunk_seconds // 60} min.", file=sys.stderr)

    video_summaries = []
    all_segments = []
    all_claims = []
    for i, (start_seconds, end_seconds) in enumerate(windows):
        print(f"Extracting chunk {i + 1}/{len(windows)} ({start_seconds // 60}-{end_seconds // 60} min)...", file=sys.stderr)
        chunk_result = extract_chunk(
            client, youtube_url, source_type, category_hint,
            metadata["title"], metadata["channel"],
            start_seconds=start_seconds, end_seconds=end_seconds,
            chunk_index=i, total_chunks=len(windows), model=model,
        )

        if chunk_result.get("video_summary"):
            video_summaries.append(chunk_result["video_summary"])

        for seg in chunk_result.get("segments", []):
            all_segments.append(_offset_timestamps(seg, start_seconds, ("start_timestamp", "end_timestamp")))
        for claim in chunk_result.get("candidate_claims", []):
            all_claims.append(_offset_timestamps(claim, start_seconds, ("start_timestamp",)))

    result = {
        "video_summary": " / ".join(video_summaries) or "(no content extracted)",
        "segments": all_segments,
        "candidate_claims": all_claims,
        "_video_metadata": metadata,
        "_chunked": True,
        "_chunk_count": len(windows),
    }
    return result


def _offset_timestamps(obj: dict, offset_seconds: float, fields: tuple) -> dict:
    """Convert the named MM:SS fields on a raw segment/claim dict from
    chunk-relative to full-video-absolute, in place on a shallow copy.
    Leaves a field untouched (rather than raising) if it doesn't parse --
    same conservative posture as mmss_to_seconds itself."""
    obj = dict(obj)
    for field in fields:
        parsed = mmss_to_seconds(obj.get(field, ""))
        if parsed is not None:
            obj[field] = seconds_to_mmss(parsed + offset_seconds)
    return obj


def extract_with_chunking_fallback(youtube_url: str, source_type: str, category_hint: str,
                                    model: str = "gemini-3.6-flash") -> dict:
    """The entrypoint run_ingestion.py and run_batch.py actually call.

    Primary path: look up the video's real duration (YouTube Data API v3)
    and decide upfront -- below LONG_VIDEO_CHUNK_THRESHOLD_SECONDS, try
    the fast, cheap single-call extract() (the overwhelming majority of
    videos); at or above it, go straight to the more expensive
    extract_long_video() without wasting a call that's known likely to
    fail. This is deterministic and doesn't depend on Gemini returning any
    particular error shape for an oversized request (confirmed it
    doesn't -- see _is_likely_size_related_error's docstring).

    Fallback path: if the duration lookup itself fails (no
    YOUTUBE_DATA_API_KEY set, video not found, network issue), fall back
    to the old reactive behavior -- try extract() and only chunk if it
    fails with a size-shaped error. Any other exception (auth error,
    permission denied on a specific video, network failure) is re-raised
    as-is -- chunking wouldn't fix those, so there's no reason to pay for
    it."""
    try:
        duration = get_video_duration_seconds(youtube_url)
    except Exception as e:
        duration = None
        print(f"{youtube_url}: couldn't look up duration ({e}); will only chunk reactively on failure.", file=sys.stderr)

    if duration is not None and duration >= LONG_VIDEO_CHUNK_THRESHOLD_SECONDS:
        print(f"{youtube_url}: {duration / 60:.0f} min, at/above the "
              f"{LONG_VIDEO_CHUNK_THRESHOLD_SECONDS // 60}-min chunking threshold -- "
              f"skipping the single-call attempt.", file=sys.stderr)
        return extract_long_video(youtube_url, source_type, category_hint, model=model)

    try:
        return extract(youtube_url, source_type, category_hint, model=model)
    except Exception as e:
        if not _is_likely_size_related_error(e):
            raise
        print(f"{youtube_url}: single call failed with a size-shaped error ({e}); "
              f"falling back to chunked extraction.", file=sys.stderr)
        return extract_long_video(youtube_url, source_type, category_hint, model=model)


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
            "accomplishment_type": normalize_accomplishment_type(claim["accomplishment_type"]),
            "sentiment": claim["sentiment"],
            "citizen_impact_suggested": claim["citizen_impact_suggested"],
            "event_date_suggested": claim["event_date_suggested"],
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

    extraction = extract_with_chunking_fallback(args.youtube_url, args.source_type, args.category_hint)
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
