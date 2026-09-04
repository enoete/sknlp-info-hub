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

# gov.kn's "National Accomplishments" sector pages (added 2026-09-01) use
# Elementor, not the classic WordPress `entry-content` theme wrapper --
# confirmed live these pages have NO `entry-content` div at all, and are
# far denser than a normal press release (the healthcare page alone has
# 51 achievement bullets across ~39KB of markup from the post div's start
# to its own "Share Article" footer marker), so the SKNIS-tuned 12000-char
# window would truncate most of the real content. `data-elementor-type="wp-post"`
# is the Elementor equivalent -- the one div that wraps a post's real body
# on this theme -- with a larger window sized for a dense achievements list.
GOVKN_CONTENT_WINDOW_CHARS = 60000


def fetch_article(url: str) -> dict:
    """Fetches one article page directly and extracts title + body text
    from its HTML. Used for a single-URL run; the RSS-based discovery
    path (run_website_discovery.py) already has title/body from the feed
    itself and skips this second fetch.

    Targets the theme's `entry-content` div specifically, not a generic
    `<article>` tag -- confirmed live 2026-08-31 that this WordPress
    theme reuses `<article>` for sidebar/"related posts" widgets too, so
    matching the first `<article>...</article>` pair grabbed a widget's
    headline (a different, unrelated post) instead of the real content
    every time. `entry-content` only ever appears once, on the real
    post body. Falls back to the Elementor wp-post wrapper (see above),
    then to the full raw page as a last resort -- the extraction
    prompt's own "don't invent a claim" conservatism handles any
    remaining nav/footer noise fine, same as always."""
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
        # data-elementor-type="wp-post" alone isn't specific enough --
        # confirmed live this theme also stamps it on the site's
        # header/footer template regions (data-elementor-post-type=
        # "ova_framework_hf_el"), and those come FIRST in the page, so a
        # bare search grabbed the nav/footer template instead of the real
        # post. data-elementor-post-type="post" is the actual blog-post
        # wrapper.
        elementor_match = re.search(r'data-elementor-type="wp-post"[^>]*data-elementor-post-type="post"', html, re.IGNORECASE)
        if elementor_match:
            start = elementor_match.end()
            body_html = html[start:start + GOVKN_CONTENT_WINDOW_CHARS]
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
                "did is out of scope regardless of stance -- do not extract it. This applies even when "
                "a CURRENT official is quoted making the allegation critically (e.g. 'the prior "
                "government spent $X without delivering anything') -- that content is still solely "
                "about the previous administration's own record and must be excluded, not tagged "
                "accomplishment just because a current official said it (confirmed real bug 2026-08-31, "
                "see extract_from_video.py's matching rule for the full example). Only extract such a "
                "statement if the article's own substance is a CURRENT government action taken in "
                "response (an audit, a legislative fix, funds recovered) -- then the claim is about "
                "that current action, with the history as context only. "
                "GOVERNMENT-ACTOR RULE: a claim is only in scope if a government body itself -- a "
                "ministry, a statutory/state-owned corporation, or an official acting in that official "
                "capacity -- is the one actually taking the action/decision/expenditure described. An "
                "article merely reporting on a PRIVATE company's own business decision, sponsorship, or "
                "a private club/association's own event, with no government body as a direct party, is "
                "NOT in scope regardless of stance or how favorably it's framed (confirmed real case, "
                "2026-09-04: a private company's sponsorship of a talent competition, aired by a "
                "government-aligned broadcaster, was wrongly extracted as an SKNLP accomplishment -- see "
                "extract_from_video.py's matching rule for the full example). A claim failing this rule "
                "has no government actor at all and must not be extracted, at any featured value. "
                "DECISIONS/INITIATIVES/ACHIEVEMENTS ONLY RULE (corrected 2026-09-04): for "
                "stance='accomplishment', only extract a claim that honestly earns one of the four real "
                "accomplishment_type values -- a genuine decision, initiative, or achievement. Do NOT "
                "extract, at any featured value: a routine operational/service notice (a scheduled "
                "utility outage, a routine public-service announcement with no decision/policy content); "
                "an active investigation into a crime or incident reported as still unfolding (a "
                "completed enforcement action under a stated initiative, or a new law passed, IS in "
                "scope); a purely ceremonial or social event with no new decision attached; or a bare "
                "routine statistic with no accompanying decision or initiative. See "
                "extract_from_video.py's matching rule for the full confirmed examples (an unfolding "
                "homicide investigation, a maintenance-outage notice) that prompted this correction -- "
                "these were cluttering the admin Review Queue even at featured=false, which is no longer "
                "an acceptable way to keep a non-qualifying claim in the corpus."
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
                            "about government performance). false ONLY for a claim that DOES honestly "
                            "earn a real accomplishment_type but is nonetheless minor/reactive rather "
                            "than a policy win. Do NOT use featured=false to still extract a claim that "
                            "isn't a real decision/initiative/achievement at all -- a routine notice, an "
                            "unfolding crime investigation, a ceremonial event with no new decision, or a "
                            "bare statistic must not be extracted as a candidate_claim in the first place "
                            "(see the DECISIONS/INITIATIVES/ACHIEVEMENTS ONLY RULE above)."
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
