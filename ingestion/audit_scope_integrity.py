"""
Repeatable scope-integrity audit: finds approved claims whose event_date
falls outside this administration's term (before ADMINISTRATION_START,
or in the future) and judges each one individually via Gemini rather than
blanket-rejecting on the date alone.

Built 2026-09-01, turning a one-off manual sweep into a real script --
that sweep (same day) found and fixed 3 genuine scope violations (a 2005
claim quoting Denzil Douglas describing a pre-Team-Unity event, a 2019
Team-Unity-era cannabis decriminalization claim, a May 2022 conference
hosted before the Aug 5 cutoff) and one bad event_date field (a claim
citing a "2010 WIPO study" had the study's own year in event_date instead
of when the citing minister actually spoke). Two different dispositions
for what looks like the same signal -- that's why this stays a judged
audit, not an auto-reject-on-date script: a future/past event_date can
mean the CLAIM is out of scope, or it can mean the date FIELD is simply
wrong while the claim itself is fine. Same "flag for a human, don't
auto-resolve" posture as every other audit in this project -- prints
proposed actions, --apply required to write.

Also expected to keep finding real hits going forward: opposition-side
historical backfills (Straight Talk especially) are still walking back
toward 2022 and will keep surfacing pre-scope content.

**Rejection is never auto-applied, even with --apply** -- found the hard
way running this for the first time (2026-09-01): the same claim got two
different verdicts across a dry run and an --apply run of the identical
prompt (real LLM non-determinism), and the second run's REJECT verdict
was an actual reasoning error -- "Jego Armstrong Selected as Speaker for
28th Independence Lecture Series" (a real, current 2026 SKNIS
announcement) got rejected because the model apparently read "28th
edition of an annual series" as "this happened in the founding year,
therefore ~2011" and concluded it predated this administration. Wrongly
removed a real claim from public view before this was caught and fixed.
Clearing a bad event_date is low-risk and fully reversible (the claim
stays approved and searchable either way); rejecting is not -- it drops
a claim from every public view. So --apply only ever writes
clear_date_only verdicts; every reject_out_of_scope verdict is always
printed for a human to review and act on manually (via the Review Queue
or a direct UPDATE), never written automatically, regardless of --apply.
This is also why this script must never run unattended via cron with
blind trust in its own output -- it's a detector + a safe auto-fix for
one specific failure mode, not an auto-moderator.

Usage:
    python audit_scope_integrity.py            # dry run, prints only
    python audit_scope_integrity.py --apply    # writes clear_date_only verdicts only; reject_out_of_scope always just prints
"""

import argparse
import json
import os
import sys
from datetime import date

import psycopg2
import psycopg2.extras
from google import genai

from extract_from_video import _generate_with_retry
from scope_config import ADMINISTRATION_START

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "disposition": {
            "type": "string",
            "enum": ["reject_out_of_scope", "clear_date_only", "keep_as_is"],
            "description": (
                "'reject_out_of_scope' if the claim's own substance is about a PREVIOUS/different "
                "administration's own record (regardless of who states it, or whether favorably or "
                "critically), or otherwise genuinely predates/postdates this administration's term. "
                "'clear_date_only' if the CLAIM itself is legitimately about this administration's own "
                "current action, but event_date was clearly set to a date mentioned INSIDE the claim's "
                "text (an external study's year, an alleged future deadline, a historical event being "
                "cited as context) rather than when the claim/statement was actually made. "
                "'keep_as_is' if the date is plausibly correct and the claim is genuinely in scope -- "
                "rare given this claim was only flagged because its date already falls outside the "
                "administration's term, but a currently-scheduled future event announcement is a real case."
            ),
        },
        "reasoning": {"type": "string", "description": "One short sentence."},
    },
    "required": ["disposition", "reasoning"],
}


def find_candidates(conn) -> list[dict]:
    today = date.today()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, summary, event_date, stance
               FROM claims
               WHERE review_status = 'approved'
                 AND event_date IS NOT NULL
                 AND (event_date < %s OR event_date > %s)
               ORDER BY event_date""",
            (ADMINISTRATION_START, today),
        )
        return cur.fetchall()


def judge(client, title: str, summary: str, event_date, stance: str) -> dict:
    prompt = f"""
This claim was flagged because its event_date ({event_date}) falls outside
the current SKNLP administration's term (August 5, 2022 - present).

Title: {title}
Summary: {summary}
Stance: {stance}

Judge it. Be careful with recurring annual events/series described by an
edition number (e.g. "28th Independence Lecture Series," "51st CARICOM
Summit") -- the ordinal counts editions of a recurring series, it is NOT
the year the series began, and it says nothing on its own about when
THIS specific instance happened. Judge the instance being described by
the actual dates/context in the claim's own text, never by inferring a
year from an edition number.
"""
    try:
        response = _generate_with_retry(
            client,
            model="gemini-3.6-flash",
            contents=[{"text": prompt}],
            config={"response_mime_type": "application/json", "response_schema": JUDGE_SCHEMA},
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"  Warning: judgment failed ({e}); leaving as-is.", file=sys.stderr)
        return {"disposition": "keep_as_is", "reasoning": f"judgment call failed: {e}"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set DATABASE_URL before running.", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY before running.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    candidates = find_candidates(conn)
    print(f"{len(candidates)} approved claim(s) with event_date outside the administration's term.", file=sys.stderr)

    flagged_for_review, cleared, kept = 0, 0, 0
    for c in candidates:
        verdict = judge(client, c["title"], c["summary"], c["event_date"], c["stance"])
        disposition = verdict.get("disposition", "keep_as_is")
        print(f"{disposition.upper():20s} {c['event_date']} — {c['title']} ({verdict.get('reasoning', '')})")

        if disposition == "reject_out_of_scope":
            # Never auto-applied -- see the module docstring for why
            # (a real false-positive reject, caught the first time this
            # ran). Always just a flagged recommendation for a human.
            flagged_for_review += 1
            print(f"  -> NOT applied. If this looks right, reject manually: UPDATE claims SET review_status='rejected' WHERE id='{c['id']}';")
            continue

        if not args.apply:
            if disposition == "clear_date_only":
                cleared += 1
            else:
                kept += 1
            continue

        with conn:
            with conn.cursor() as cur:
                if disposition == "clear_date_only":
                    cur.execute("UPDATE claims SET event_date = NULL WHERE id = %s", (c["id"],))
                    cleared += 1
                else:
                    kept += 1

    print(
        f"\n{flagged_for_review} flagged as possibly out-of-scope (never auto-applied -- see the recommendations "
        f"above), {cleared} date-cleared (claim kept), {kept} kept as-is. "
        f"{'Date-clears applied.' if args.apply else 'Dry run only -- rerun with --apply to write date-clears.'}",
        file=sys.stderr,
    )
    conn.close()


if __name__ == "__main__":
    main()
