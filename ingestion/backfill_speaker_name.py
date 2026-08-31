"""
One-time backfill: populate transcript_segments.speaker_name_at_time for
claims ingested before that column existed (see schema.sql's comment and
segment_utils.py's compute_segment_window(), which now captures this
directly for everything ingested going forward).

Prompted by a real request: "on the opposition, we need to filter by WHO
said it -- Timothy Harris, Patches, Kyle, that granular." The only
reliably-populated speaker field before this was speaker_org (the
channel/outlet -- Straight Talk, Talk SKN, PLP, ZIZOnline), which isn't
granular enough once a single channel features multiple named people
(a host's own commentary, a played clip of a government minister, a
caller, another politician's convention speech). speaker_title_at_time
already captures a ROLE per claim ("Host", "Member for Nevis 9", "Prime
Minister of St. Kitts and Nevis") but not a NAME -- this backfill fills
that in from the claim's own title/summary text (which almost always
already names the actual speaker in plain language, e.g. "Mark Brantley
argued that...") plus the known-figures/channel-host context below.

Never touches a claim whose speaker_title_at_time is 'Caller' -- callers
are deliberately never named (see CLAUDE.md's "Call-in callers"
decision) -- and never guesses: returns the sentinel UNKNOWN (not an
empty string -- Gemini's schema validator rejects empty enum values,
confirmed earlier this session) when the text genuinely doesn't name
anyone, rather than force a plausible-sounding wrong name onto a citation
someone will actually filter and read by.

Usage:
    python backfill_speaker_name.py            # dry run, prints only
    python backfill_speaker_name.py --apply    # writes to the DB
"""

import argparse
import json
import os
import sys

import psycopg2
import psycopg2.extras
from google import genai

from extract_from_video import KNOWN_FIGURES, _generate_with_retry

BATCH_SIZE = 15
UNKNOWN = "UNKNOWN"

# The two solo-commentary channel hosts -- not in KNOWN_FIGURES (that
# list is political figures), but exactly who "Host" resolves to on
# their respective channels. Verified via each channel's own About text
# earlier this session (see CLAUDE.md's "Fourth source category").
CHANNEL_HOSTS = {
    "Talk SKN - Kyle Flanders": "Kyle Flanders",
    "Straight Talk": "Ian \"Patches\" Liburd",
}

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "identifications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "speaker_name": {"type": "string"},
                },
                "required": ["id", "speaker_name"],
            },
        }
    },
    "required": ["identifications"],
}


def build_prompt(batch: list) -> str:
    figures_list = "\n".join(f"- {f}" for f in KNOWN_FIGURES)
    hosts_list = "\n".join(f"- On {org}, an unnamed 'Host' role is always {name}" for org, name in CHANNEL_HOSTS.items())
    items = "\n".join(
        f"- id={c['id']}: role_at_time={c['speaker_title_at_time']!r}, source={c['speaker_org']!r}, "
        f"video={c['source_title']!r}\n  \"{c['title']}\" — {c['summary']}"
        for c in batch
    )
    return f"""
For each claim below, identify the actual named individual who made THIS
specific statement -- not who the statement is about, the person actually
speaking. The title/summary usually already names them directly (e.g.
"Mark Brantley argued that...", "Prime Minister Dr. Terrance Drew stated
that..." -- return "Mark Brantley" / "Dr. Terrance Drew").

Known figures who may appear:
{figures_list}

{hosts_list}

If the text genuinely does not name anyone identifiable -- a vague
attribution, a generic role with no name given, anything you'd be
guessing at -- return the literal string "{UNKNOWN}" for that id. Never
invent or guess a plausible-sounding name.

Claims:
{items}
"""


def identify_batch(client, batch: list) -> dict:
    response = _generate_with_retry(
        client,
        model="gemini-3.6-flash",
        contents=[{"text": build_prompt(batch)}],
        config={"response_mime_type": "application/json", "response_schema": CLASSIFY_SCHEMA},
    )
    result = json.loads(response.text)
    return {c["id"]: c["speaker_name"].strip() for c in result["identifications"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write to the DB (default: dry run, print only)")
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

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT ts.id AS segment_id, c.id AS claim_id, c.title, c.summary,
                      ts.speaker_title_at_time, s.speaker_org, s.title AS source_title
               FROM claims c
               JOIN claim_transcript_segments cts ON cts.claim_id = c.id
               JOIN transcript_segments ts ON ts.id = cts.segment_id
               JOIN claim_sources cs ON cs.claim_id = c.id
               JOIN sources s ON s.id = cs.source_id
               WHERE c.review_status = 'approved'
                 AND ts.speaker_name_at_time IS NULL
                 AND coalesce(ts.speaker_title_at_time, '') != 'Caller'
               ORDER BY c.created_at"""
        )
        rows = cur.fetchall()

    print(f"{len(rows)} approved claim(s) with a segment but no speaker_name_at_time yet.", file=sys.stderr)
    if not rows:
        conn.close()
        return

    all_ids: dict = {}
    for i in range(0, len(rows), BATCH_SIZE):
        batch = [dict(r, id=str(r["claim_id"])) for r in rows[i:i + BATCH_SIZE]]
        print(f"Identifying batch {i // BATCH_SIZE + 1} ({len(batch)} claims)...", file=sys.stderr)
        result = identify_batch(client, batch)
        all_ids.update(result)

    by_claim_id = {str(r["claim_id"]): r for r in rows}
    resolved = 0
    for claim_id, name in all_ids.items():
        title = by_claim_id.get(claim_id, {}).get("title", "?")
        if name and name != UNKNOWN:
            resolved += 1
            print(f"{name:30s} {title}")
        else:
            print(f"{'(unknown)':30s} {title}")

    missing = [str(r["claim_id"]) for r in rows if str(r["claim_id"]) not in all_ids]
    if missing:
        print(f"WARNING: {len(missing)} claim(s) got no response back, left untouched: {missing}", file=sys.stderr)

    print(f"\n{resolved} of {len(rows)} resolved to a real name; the rest stay NULL (never guessed).", file=sys.stderr)

    if not args.apply:
        print("\nDry run only -- rerun with --apply to write these to the DB.", file=sys.stderr)
        conn.close()
        return

    with conn:
        with conn.cursor() as cur:
            for claim_id, name in all_ids.items():
                if not name or name == UNKNOWN:
                    continue
                segment_id = by_claim_id[claim_id]["segment_id"]
                cur.execute(
                    "UPDATE transcript_segments SET speaker_name_at_time = %s WHERE id = %s",
                    (name, segment_id),
                )
    print(f"\nApplied {resolved} identification(s).", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
