#!/usr/bin/env python3
"""
Guards against the exact drift that happened with citizen_impact: a new
writable column gets added to claims (schema.sql), the Dashboard learns to
render it, and nobody goes back to check whether extract_from_video.py's
RESPONSE_SCHEMA needs the same field. See CLAUDE.md's "Ingestion agent"
section for the incident this test exists to catch.

This is deliberately NOT "every claims column must be in RESPONSE_SCHEMA" —
plenty of columns are legitimately system-managed, generated, or reserved
for a future phase. Instead: every claims column must be EITHER present in
RESPONSE_SCHEMA's candidate_claims fields, OR explicitly listed in
EXCLUDED_COLUMNS with a real reason. A column that's neither is the failure
mode this test exists to catch — silent omission, not a bad-but-documented
answer.

No live DB required — parses schema.sql's CREATE TABLE claims block
directly (via regex, not a real SQL parser) and imports RESPONSE_SCHEMA
from extract_from_video.py as the single source of truth for what the
model actually outputs. Run directly:

    python3 tests/test_extraction_schema_sync.py

Exits non-zero on any mismatch, so this can be wired into CI later.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "ingestion"))

# Columns intentionally absent from RESPONSE_SCHEMA, each with a real reason.
# Adding a column here should be a deliberate decision made while reading
# this file, not a rubber stamp — see CLAUDE.md's "Schema sync is a
# required step, not an afterthought" note.
EXCLUDED_COLUMNS = {
    "id": "system-generated primary key",
    "search_vector": "PostgreSQL GENERATED ALWAYS STORED column — cannot be written directly",
    "extracted_by": "set programmatically by the ingestion script itself (constant 'gemini_agent'), not something the model extracts",
    "citizen_impact": "human-authored/confirmed only (schema.sql) — the ingestion agent drafts into citizen_impact_suggested instead and NEVER writes this column directly",
    "event_date": "human-confirmed only (schema.sql) — the ingestion agent drafts into event_date_suggested instead and NEVER writes this column directly",
    "review_status": "system-managed — ingestion rows always start 'pending_review', not a model output",
    "reviewed_by": "admin-set at review time",
    "reviewed_at": "admin-set at review time",
    "embedding": "reserved for future embedding-based retrieval (no Voyage AI key yet) — nothing populates this today",
    "created_at": "DB-managed timestamp default",
    "updated_at": "DB-managed timestamp default",
    "completes_claim_id": "admin-linked only, after the fact, via the review queue's 'this completes an earlier claim' picker (app/lib/reviewQueue.ts's updateCompletesClaim) — a single video extraction has no visibility into other claims already in the DB to link against, so this can never be a per-video extraction field",
}

# RESPONSE_SCHEMA fields that describe something other than a claims column
# (e.g. video-position metadata used to locate the clip in transcript_segments,
# not a value written onto the claims row itself).
NON_COLUMN_EXTRACTION_FIELDS = {
    "start_timestamp": "video-position metadata for transcript_segments, not a claims column",
}


def get_claims_db_columns() -> set[str]:
    schema_sql = (REPO_ROOT / "schema.sql").read_text()
    match = re.search(r"CREATE TABLE claims \((.*?)\n\);", schema_sql, re.DOTALL)
    if not match:
        raise RuntimeError("Could not find 'CREATE TABLE claims (...)' block in schema.sql — has it been renamed/restructured?")
    body = match.group(1)

    columns = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("--"):
            continue
        # a column line starts with an identifier followed by whitespace then
        # a type token. Types here are sometimes built-ins (TEXT, UUID — start
        # uppercase) and sometimes custom enum types (claim_stance,
        # review_status — start lowercase), so don't assume case; every
        # constraint-only line in this table (PRIMARY KEY, CHECK, etc.)
        # starts uppercase itself and is excluded by requiring the *column
        # name* to start lowercase, which SQL keywords never do here.
        col_match = re.match(r"^([a-z_][a-z0-9_]*)\s+\S", line)
        if col_match:
            columns.add(col_match.group(1))
    return columns


def get_extraction_schema_fields() -> set[str]:
    from extract_from_video import RESPONSE_SCHEMA
    return set(RESPONSE_SCHEMA["properties"]["candidate_claims"]["items"]["properties"].keys())


def get_article_extraction_schema_fields() -> set[str]:
    # extract_from_article.py (SKNIS and similar text sources, added
    # 2026-08-31) is a second, independent path that also writes to
    # `claims` -- checked separately so a field added to one extractor
    # but not the other doesn't silently pass just because the OTHER
    # one covers it. It has no segment/timestamp concept (no video, no
    # NON_COLUMN_EXTRACTION_FIELDS overlap expected), so its own
    # "extras" are checked directly against db_columns, not that list.
    from extract_from_article import RESPONSE_SCHEMA
    return set(RESPONSE_SCHEMA["properties"]["candidate_claims"]["items"]["properties"].keys())


def main() -> int:
    db_columns = get_claims_db_columns()
    extraction_fields = get_extraction_schema_fields()
    article_fields = get_article_extraction_schema_fields()

    # Gap check is against the UNION of both extractors -- a column only
    # extract_from_article.py covers (or vice versa) is still covered,
    # not a gap. Either extractor independently writing a field is
    # enough to satisfy "this column has real extraction coverage."
    unexplained_gap = db_columns - extraction_fields - article_fields - set(EXCLUDED_COLUMNS)
    unexplained_extras = extraction_fields - db_columns - set(NON_COLUMN_EXTRACTION_FIELDS)
    unexplained_article_extras = article_fields - db_columns

    # Sanity-check the exclusion lists themselves don't reference columns/
    # fields that no longer exist (stale entries are their own drift risk).
    stale_exclusions = set(EXCLUDED_COLUMNS) - db_columns
    stale_non_column_fields = set(NON_COLUMN_EXTRACTION_FIELDS) - extraction_fields

    ok = True

    if unexplained_gap:
        ok = False
        print("FAIL: claims columns with no extraction coverage and no documented reason:")
        for col in sorted(unexplained_gap):
            print(f"  - {col}")
        print("  -> Either add this field to RESPONSE_SCHEMA in extract_from_video.py,")
        print("     or add it to EXCLUDED_COLUMNS in this file with a real reason.")

    if unexplained_extras:
        ok = False
        print("FAIL: extract_from_video.py RESPONSE_SCHEMA fields that don't match any claims column:")
        for field in sorted(unexplained_extras):
            print(f"  - {field}")
        print("  -> Likely a naming drift bug (field renamed on one side, not the other),")
        print("     or add it to NON_COLUMN_EXTRACTION_FIELDS if it's genuinely not a claims column.")

    if unexplained_article_extras:
        ok = False
        print("FAIL: extract_from_article.py RESPONSE_SCHEMA fields that don't match any claims column:")
        for field in sorted(unexplained_article_extras):
            print(f"  - {field}")
        print("  -> Likely a naming drift bug -- extract_from_article.py has no segment/timestamp")
        print("     concept, so unlike extract_from_video.py it shouldn't need a NON_COLUMN exclusion.")

    if stale_exclusions:
        ok = False
        print("FAIL: EXCLUDED_COLUMNS references columns that no longer exist in claims:")
        for col in sorted(stale_exclusions):
            print(f"  - {col}")

    if stale_non_column_fields:
        ok = False
        print("FAIL: NON_COLUMN_EXTRACTION_FIELDS references fields no longer in RESPONSE_SCHEMA:")
        for field in sorted(stale_non_column_fields):
            print(f"  - {field}")

    if ok:
        print(f"OK: all {len(db_columns)} claims columns are either extracted or explicitly excluded with a reason.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
