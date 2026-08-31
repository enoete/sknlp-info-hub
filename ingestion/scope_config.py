"""
App-level scope-window config — see CLAUDE.md's "Scope window — enforce
this" section. This administration's term only: August 5, 2022
(inauguration) through today. The prior Unity administration (2015-2022)
and earlier eras are out of scope until a separate, explicit decision
expands it.

Deliberately a plain Python constant, not a database CHECK constraint —
scope is expected to widen later, and a CHECK would need a migration to
change; this can just be edited.
"""

from datetime import date

ADMINISTRATION_START = date(2022, 8, 5)


def in_scope(d: date | None) -> bool:
    """True if `d` is on/after the scope cutoff. A missing date (None) is
    treated as in-scope — this only ever blocks a CONFIRMED pre-cutoff
    date, never absence of one; callers that have no date signal yet
    should let the item through and let a human judge it in review."""
    if d is None:
        return True
    return d >= ADMINISTRATION_START
