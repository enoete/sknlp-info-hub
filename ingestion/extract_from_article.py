"""
SKNLP Info Hub — text-article ingestion agent (SKNIS press releases and
similar written government sources).

Sibling to extract_from_video.py, not a replacement -- same conservative
claim-extraction philosophy, same stance/scope rules, same
accomplishment_type taxonomy, reusing those constants directly rather
than redefining them. The real difference is the input shape: a
WordPress article (title + full HTML body) has no video/audio, so there
is no chunking, no timestamps, and no transcript_segments deep-link --
citation is just the article URL itself.

Built 2026-08-31 after a concrete, demonstrated gap: asking "Ask the
Record" about the Destiny project could only surface opposition
allegations, because the government's own direct statements on it exist
only as SKNIS press releases (sknis.gov.kn), never as video, so the
video-only pipeline had no way to ever see them.

Speaker attribution here is coarser than the video pipeline's: one
article's primary speaker/subject goes on the `sources` row directly
(speaker_name/speaker_org -- both already-existing columns), not a
per-claim transcript_segments row (there's no timestamp to anchor one
to). Most SKNIS releases are single-official statements, so this covers
the common case; a genuinely multi-official roundup article loses
per-claim speaker granularity -- a known, documented gap, not a silent
one, same posture as every other scoping decision in this project.

Setup:
    export GEMINI_API_KEY=your_key_here

Usage:
    python extract_from_article.py "https://www.sknis.gov.kn/2026/03/12/..."
"""

import argparse
import json
import os
import re
import sys
from html import unescape

import requests
from google import genai

from extract_from_video import (
    ACCOMPLISHMENT_TYPE_NA,
    ACCOMPLISHMENT_TYPES,
    CATEGORIES,
    KNOWN_FIGURES,
    SENTIMENTS,
    _generate_with_retry,
    normalize_accomplishment_type,
)

MODEL = "gemini-3.6-flash"


def strip_html(html: str) -> str:
    """WordPress's content:encoded field is real HTML -- strip tags down
    to plain text for the extraction prompt. Not a full HTML parser (no
    new dependency for this), just good enough to remove markup noise;
    the model doesn't need clean typography, just the actual words."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


CONTENT_WINDOW_CHARS = 12000  # generous fixed window from the content div's start,
# not a real HTML parser -- confirmed 2026-08-31 that a genuine SKNIS
# press release fits well within this, and any trailing nav/footer noise
# past the real content is handled fine by the extraction prompt's own
# "don't invent a claim" conservatism, not worth a real HTML parser
# dependency for.


def fetch_article(url: str) -> dict:
    """Fetches one SKNIS article page directly and extracts title +
    body text from its HTML. Used for a single-URL run; the RSS-based
    discovery path (run_website_discovery.py) already has title/body
    from the feed itself and skips this second fetch.

    Targets the theme's `entry-content` div specifically, not a generic
    `<article>` tag -- confirmed live 2026-08-31 that this WordPress
    theme reuses `<article>` for sidebar/"related posts" widgets too, so
    matching the first `<article>...</article>` pair grabbed a widget's
    headline (a different, unrelated post) instead of the real content
    every time. `entry-content` only ever appears once, on the real
    post body."""
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    resp.raise_for_status()
    html = resp.text
    title_match = re.search(r"<title>([^<]*)</title>", html, re.IGNORECASE)
    title = unescape(title_match.group(1)).strip() if title_match else url
    content_match = re.search(r'class="[^"]*\bentry-content\b[^"]*"', html, re.IGNORECASE)
    if content_match:
        start = content_match.end()
        body_html = html[start:start + CONTENT_WINDOW_CHARS]
    else:
        body_html = html
    return {"title": title, "body_text": strip_html(body_html)}


RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "article_summary": {"type": "string"},
        "primary_speaker": {
            "type": "string",
            "description": (
                "The single primary official/speaker this article is about or quotes, if there is a "
                "clear one (e.g. 'Dr. Terrance Drew', 'Samal Duggins') -- use the exact name string "
                "from KNOWN_FIGURES if they're on that list, name portion only (before the em-dash). "
                "Empty string if the article is a general institutional announcement with no single "
                "clear speaker (e.g. a notice, a statistics release)."
            ),
        },
        "candidate_claims": {
            "type": "array",
            "description": (
                "Only include statements concrete and specific enough to be a factual claim (a policy, "
                "a number, a completed or in-progress project, an official position on a specific "
                "matter). Do NOT include generic rhetoric, greetings, or vague statements with nothing "
                "checkable in them. CRITICAL SCOPE RULE, checked before stance: this archive covers "
                "ONLY the current SKNLP administration's term, which began August 5, 2022 (Dr. Terrance "
                "Drew, Prime Minister). A claim solely about what a PREVIOUS/DIFFERENT administration "
                "did is out of scope regardless of stance -- do not extract it."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "stance": {
                        "type": "string",
                        "enum": ["accomplishment", "opposition_statement"],
                        "description": (
                            "Nearly everything from an official SKNIS release will be 'accomplishment' "
                            "(the current government's own statement/position/action) -- "
                            "'opposition_statement' only applies if the article is directly quoting an "
                            "opposition figure's criticism (e.g. a article reporting on a press "
                            "conference where an opposition MP spoke)."
                        ),
                    },
                    "title": {"type": "string", "description": "Short, neutral label for the claim, under 12 words."},
                    "summary": {"type": "string", "description": "1-2 sentence paraphrase in plain language. Do not quote more than a short phrase verbatim."},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "accomplishment_type": {
                        "type": "string",
                        "enum": ACCOMPLISHMENT_TYPES + [ACCOMPLISHMENT_TYPE_NA],
                        "description": (
                            f"REQUIRED for stance='accomplishment'; '{ACCOMPLISHMENT_TYPE_NA}' for "
                            "stance='opposition_statement'. Pick exactly one: 'Accomplishment' = a "
                            "completed, concrete deliverable. 'Policy Decision' = a formal "
                            "policy/law/regulation adopted or changed. 'Strategic Decision' = a "
                            "directional commitment (partnership, MOU, framework). 'Ongoing Initiative' "
                            "= clearly still in progress, explicitly not finished yet."
                        ),
                    },
                    "sentiment": {"type": "string", "enum": SENTIMENTS},
                    "citizen_impact_suggested": {
                        "type": "string",
                        "description": "DRAFT ONLY -- a human must review before this becomes the published citizen_impact. One plain-language sentence on what this concretely means for a resident day-to-day. Empty string if too abstract.",
                    },
                    "event_date_suggested": {
                        "type": "string",
                        "description": "DRAFT ONLY -- ISO format (YYYY-MM-DD) if the article explicitly states the date this event/policy occurred or took effect. Empty string if no explicit date -- never infer from the article's publish date alone.",
                    },
                    "extraction_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "low if the claim is vague, ambiguous, or you're inferring rather than reading a direct statement",
                    },
                    "featured": {
                        "type": "boolean",
                        "description": (
                            "true for genuine government policy, decision, project, budget item, or "
                            "initiative (or, for opposition_statement, a specific documented allegation "
                            "about government performance). false for a real, worth-keeping-searchable "
                            "claim that is nonetheless an isolated incident rather than a policy/decision "
                            "-- a specific rescue operation, a specific arrest, a routine crime-statistic "
                            "mention, a ceremonial or social event with no policy content, general human-"
                            "interest news. Rule of thumb: could this specific fact reasonably be "
                            "described using one of the four accomplishment_type categories (a completed "
                            "deliverable, a policy, a strategic commitment, an ongoing program)? If not, "
                            "it's very likely featured=false, not a stretch to force it into one anyway."
                        ),
                    },
                },
                "required": ["stance", "title", "summary", "category", "accomplishment_type", "sentiment", "citizen_impact_suggested", "event_date_suggested", "extraction_confidence", "featured"],
            },
        },
    },
    "required": ["article_summary", "primary_speaker", "candidate_claims"],
}


def build_prompt(title: str, body_text: str, published_at: str, category_hint: str) -> str:
    figures_list = "\n".join(f"- {f}" for f in KNOWN_FIGURES)
    return f"""
You are drafting entries for a fact-sourced political archive from an
official government press release. Read the article below and extract
structured information. Be conservative: when in doubt, mark
extraction_confidence as 'low' rather than guessing, and skip a
statement entirely rather than force it into a claim.

Article title: {title}
Published: {published_at or '(unknown)'}
Likely categories: {category_hint or ', '.join(CATEGORIES)}

Known figures who may appear (use this to identify the primary speaker
and to write their name consistently -- see primary_speaker's own
description for the exact-string requirement):
{figures_list}

Article text:
{body_text}

Never invent a claim, number, or date that isn't actually stated in the
article.
"""


def extract_article(title: str, body_text: str, source_type: str, category_hint: str = "", published_at: str = "") -> dict:
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    response = _generate_with_retry(
        client,
        model=MODEL,
        contents=[{"text": build_prompt(title, body_text, published_at, category_hint)}],
        config={"response_mime_type": "application/json", "response_schema": RESPONSE_SCHEMA},
    )
    result = json.loads(response.text)
    for c in result.get("candidate_claims", []):
        c["accomplishment_type"] = normalize_accomplishment_type(c.get("accomplishment_type")) or ACCOMPLISHMENT_TYPE_NA
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract candidate claims from an SKNIS (or similar) article URL.")
    parser.add_argument("url", help="Full article URL")
    parser.add_argument("--source-type", default="official_govt", choices=["official_party", "official_govt", "opposition", "press"])
    parser.add_argument("--category-hint", default="")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    article = fetch_article(args.url)
    extraction = extract_article(article["title"], article["body_text"], args.source_type, args.category_hint)
    print(json.dumps({"title": article["title"], **extraction}, indent=2))
