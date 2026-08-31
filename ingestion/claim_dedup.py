"""
SKNLP Info Hub — shared corroboration/dedup logic, used by BOTH
run_article_ingestion.py and run_ingestion.py (video pipeline).

Originally built 2026-08-31 inside run_article_ingestion.py only, per
explicit instruction: "some of these will be duplicated by youtube,
etc... this is where we will be able to buttress sources by stating the
various sources that talk about the same thing." Extracted into its own
module and fixed the same day after a real, demonstrated failure: the
EC$250 back-to-school voucher announcement was extracted separately by
Talk SKN, Straight Talk, SKNIS (three different articles), and Freedom
FM -- FOUR separate claims instead of one claim with four citations.
Two root causes, both fixed here:

1. The original version filtered candidates to an EXACT category match
   before ever comparing them. The same real fact got tagged 'Education'
   by one extraction pass and 'Social Protection' by another (a
   genuinely ambiguous call either way) -- so the two claims were never
   even compared. Dropped the category filter; stance is still required
   (an accomplishment and an opposition_statement are never the same
   claim, that's the whole point of the field), but candidates are now
   found across every category for that stance.
2. This only ran inside the article/SKNIS pipeline, never
   run_ingestion.py's video path -- confirmed live: Straight Talk's own
   copy of the voucher claim existed standalone even after SKNIS had
   already been merged into Talk SKN's. Now imported and called from
   both.

Still a two-stage check, same reasoning as oppositionWatch.ts's
isGenuinelyRelevant (a title/summary can share a lot of vocabulary
without being the same specific fact): pg_trgm similarity() on
title+summary combined (not title alone -- two claims describing the
same fact can have quite different titles, confirmed with "2026
Back-to-School Voucher Programme" vs "Government Launches $250 EC
Back-to-School Voucher Initiative") narrows to real candidates, then one
LLM call per candidate confirms it's actually the same fact before
merging. Merging two genuinely different claims under one id would
misattribute a citation, which is worse than the duplicate this is
trying to avoid, so this stays conservative and fails closed (no merge)
on any error.
"""

import json
import sys

import psycopg2.extras

# Lower than the original 0.35 -- that threshold was tuned only against
# title-vs-title comparisons; comparing title+summary combined naturally
# produces lower absolute scores even for genuine matches (more total
# text diluting the same amount of real overlap), and the LLM check is
# the actual correctness gate here, not this number. This is just a
# cheap pre-filter to avoid burning an LLM call on obviously-unrelated
# candidates.
MIN_SIMILARITY = 0.2
CANDIDATE_LIMIT = 5

SAME_CLAIM_SCHEMA = {
    "type": "object",
    "properties": {
        "same_claim": {
            "type": "boolean",
            "description": "true only if both texts describe the exact same specific fact/event/decision -- not just the same general topic or institution.",
        }
    },
    "required": ["same_claim"],
}


def _is_same_claim(client, generate_with_retry, new_title: str, new_summary: str, existing_title: str, existing_summary: str) -> bool:
    try:
        response = generate_with_retry(
            client,
            model="gemini-3.6-flash",
            contents=[{
                "text": (
                    "Do these two claims describe the EXACT SAME specific fact, event, or decision "
                    "(not just the same general topic)?\n\n"
                    f'Claim A: "{new_title}" — {new_summary}\n\n'
                    f'Claim B: "{existing_title}" — {existing_summary}'
                )
            }],
            config={"response_mime_type": "application/json", "response_schema": SAME_CLAIM_SCHEMA},
        )
        return json.loads(response.text).get("same_claim") is True
    except Exception as e:
        print(f"  Warning: same-claim check failed ({e}); treating as not the same, will insert new claim.", file=sys.stderr)
        return False


def find_matching_approved_claim(conn, client, generate_with_retry, title: str, summary: str, stance: str):
    """Returns an existing claim id to link a new source to, or None to
    insert a fresh claim. Candidates are any approved claim with the
    same stance (never cross accomplishment/opposition) and real
    pg_trgm similarity on title+summary combined -- category is
    deliberately NOT filtered on, see module docstring."""
    combined = f"{title} {summary}"
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, summary, similarity(title || ' ' || summary, %s) AS sim
               FROM claims
               WHERE review_status = 'approved' AND stance = %s
                 AND similarity(title || ' ' || summary, %s) > %s
               ORDER BY sim DESC LIMIT %s""",
            (combined, stance, combined, MIN_SIMILARITY, CANDIDATE_LIMIT),
        )
        candidates = cur.fetchall()

    for cand in candidates:
        if _is_same_claim(client, generate_with_retry, title, summary, cand["title"], cand["summary"]):
            return cand["id"]
    return None
