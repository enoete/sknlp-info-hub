import { pool } from './db';
import { withTimestamp } from './youtube';
import { ValidationError } from './sourceManager';
import { ACCOMPLISHMENT_TYPES } from './accomplishmentType';

export interface ReviewQueueClaim {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
  accomplishment_type: string | null;
  featured: boolean;
  completes_claim_id: string | null;
  completes_claim_title: string | null;
  manual_clarification_id: string | null;
  // Derived: the TITLE of the linked claim (when manual_clarification_id
  // is set), not to be confused with manual_clarification_title below
  // (the admin's own free-text title, used only for the no-linked-claim
  // path -- see schema.sql's comment on the two mutually exclusive
  // clarification mechanisms).
  manual_clarification_claim_title: string | null;
  manual_clarification_title: string | null;
  manual_clarification_text: string | null;
  manual_clarification_url: string | null;
  sentiment: string | null;
  extraction_confidence: string | null;
  extracted_by: string;
  review_status: string;
  citizen_impact: string | null;
  citizen_impact_suggested: string | null;
  event_date: string | null;
  event_date_suggested: string | null;
  source_id: string;
  source_title: string;
  origin_url: string;
  speaker_org: string;
  source_type: string;
  channel: string;
  // How many OTHER claims (including this one) are linked to the same
  // sources row — several claims can legitimately share one source (e.g.
  // one campaign graphic documenting 3-4 accomplishments at once), so
  // editing this source's URL updates all of them at once. Shown in the
  // edit UI so that isn't a surprise.
  source_claim_count: number;
  created_at: string;
}

// Every claim regardless of status — the client filters by pending/
// approved/rejected via pills, same pattern as Dashboard/Opposition
// Watch (fetch once server-side, filter client-side), rather than a
// round-trip per status. One row per claim even though claim_sources is
// technically many-to-many — DISTINCT ON picks a single (most recently
// added) source per claim so a claim linked to more than one source
// can't render as duplicate cards.
export async function getReviewQueueClaims(): Promise<ReviewQueueClaim[]> {
  const { rows } = await pool.query<ReviewQueueClaim & { source_start_seconds: number | null }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.id)
         c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type, c.featured,
         c.completes_claim_id, (SELECT title FROM claims WHERE id = c.completes_claim_id) AS completes_claim_title,
         c.manual_clarification_id, (SELECT title FROM claims WHERE id = c.manual_clarification_id) AS manual_clarification_claim_title,
         c.manual_clarification_title, c.manual_clarification_text, c.manual_clarification_url,
         c.sentiment,
         c.extraction_confidence, c.extracted_by, c.review_status,
         c.citizen_impact,
         c.citizen_impact_suggested,
         to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
         to_char(c.event_date_suggested, 'YYYY-MM-DD') AS event_date_suggested,
         s.id AS source_id, s.title AS source_title, s.origin_url, s.speaker_org, s.source_type, s.channel,
         (SELECT count(*) FROM claim_sources cs2 WHERE cs2.source_id = s.id)::int AS source_claim_count,
         c.created_at,
         (SELECT ts.start_seconds
          FROM claim_transcript_segments cts
          JOIN transcript_segments ts ON ts.id = cts.segment_id
          WHERE cts.claim_id = c.id
          ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds
       FROM claims c
       JOIN claim_sources cs ON cs.claim_id = c.id
       JOIN sources s ON s.id = cs.source_id
       ORDER BY c.id, s.created_at DESC
     ) x
     ORDER BY created_at DESC`
  );
  return rows.map((r) => ({ ...r, origin_url: withTimestamp(r.origin_url, r.source_start_seconds) }));
}

export interface DecisionResult {
  id: string;
  review_status: string;
  citizen_impact_copied: boolean;
  event_date_copied: boolean;
}

// The one moment a human explicitly turns a draft suggestion into a
// published fact. A single atomic UPDATE: review_status flips to
// 'approved', and citizen_impact/event_date are each set from their
// *_suggested counterpart ONLY if a suggested value actually exists —
// COALESCE(suggested, real) leaves the real column untouched (still
// NULL, same as every claim before approval) when there's nothing to
// promote, rather than ever overwriting with an empty value. Guarded to
// only affect a claim that's still pending_review, so double-approving
// or approving-after-reject is a no-op (zero rows), not a silent redo.
export async function approveClaim(id: string): Promise<DecisionResult | null> {
  const { rows } = await pool.query<{
    id: string;
    review_status: string;
    citizen_impact: string | null;
    event_date: string | null;
  }>(
    `UPDATE claims
     SET review_status = 'approved',
         citizen_impact = COALESCE(citizen_impact_suggested, citizen_impact),
         event_date = COALESCE(event_date_suggested, event_date)
     WHERE id = $1 AND review_status = 'pending_review'
     RETURNING id, review_status, citizen_impact, event_date`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    review_status: row.review_status,
    citizen_impact_copied: row.citizen_impact !== null,
    event_date_copied: row.event_date !== null
  };
}

export async function rejectClaim(id: string): Promise<{ id: string; review_status: string } | null> {
  const { rows } = await pool.query<{ id: string; review_status: string }>(
    `UPDATE claims SET review_status = 'rejected'
     WHERE id = $1 AND review_status = 'pending_review'
     RETURNING id, review_status`,
    [id]
  );
  return rows[0] ?? null;
}

// Full retraction, not a soft toggle: review_status goes back to
// pending_review AND citizen_impact/event_date are cleared back to NULL
// — deliberately not left sitting there. If a claim gets unapproved it's
// often because something about it was wrong, so the promoted fields
// shouldn't linger as if nothing happened; whoever re-reviews it sees
// the same *_suggested draft everyone else starts from, not a stale
// published value quietly carried over. Every other public surface
// (Dashboard, Ask the Record, Opposition Watch, both suggestion pools)
// already gates strictly on review_status='approved', so flipping this
// one column is sufficient to pull the claim out of consideration
// everywhere at once — verified by inspecting each query, not assumed.
// Guarded to only affect a claim that's currently approved.
export async function unapproveClaim(id: string): Promise<{ id: string; review_status: string } | null> {
  const { rows } = await pool.query<{ id: string; review_status: string }>(
    `UPDATE claims
     SET review_status = 'pending_review',
         citizen_impact = NULL,
         event_date = NULL
     WHERE id = $1 AND review_status = 'approved'
     RETURNING id, review_status`,
    [id]
  );
  return rows[0] ?? null;
}

// Lets an admin replace a placeholder/generic source URL (e.g. a seed-data
// stand-in like facebook.com/sknismedia/photos) with the real, specific
// permalink once it's tracked down — without needing to unapprove and
// re-approve the claim(s) that cite it. Updates the sources row directly,
// so every claim linked to this same source (there can be several — see
// ReviewQueueClaim.source_claim_count) picks up the new URL at once; that's
// correct when they genuinely came from the same post, not a bug.
export async function updateSourceUrl(
  sourceId: string,
  originUrl: string
): Promise<{ source_id: string; origin_url: string; claims_updated: number } | null> {
  const trimmed = originUrl.trim();
  if (!trimmed) throw new ValidationError('URL is required');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) throw new ValidationError('Must be a real http(s) URL');

  const { rows } = await pool.query<{ id: string; origin_url: string }>(
    `UPDATE sources SET origin_url = $2 WHERE id = $1 RETURNING id, origin_url`,
    [sourceId, trimmed]
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM claim_sources WHERE source_id = $1`,
    [sourceId]
  );
  return { source_id: row.id, origin_url: row.origin_url, claims_updated: Number(countRows[0].count) };
}

// Lets an admin correct the extraction agent's accomplishment_type call
// when it doesn't quite land — the taxonomy is a judgment call (see
// schema.sql's comment), so getting it wrong sometimes is expected, and
// there's no reason to require unapprove-and-re-review just to fix a
// label. Works on a claim in any review_status (pending or already
// approved/live) since a mislabeled claim can be spotted either before or
// after it's published.
export async function updateAccomplishmentType(
  claimId: string,
  accomplishmentType: string | null
): Promise<{ id: string; accomplishment_type: string | null } | null> {
  if (accomplishmentType !== null && !(ACCOMPLISHMENT_TYPES as readonly string[]).includes(accomplishmentType)) {
    throw new ValidationError(`accomplishment_type must be one of: ${ACCOMPLISHMENT_TYPES.join(', ')}`);
  }
  const { rows } = await pool.query<{ id: string; accomplishment_type: string | null }>(
    `UPDATE claims SET accomplishment_type = $2 WHERE id = $1
     RETURNING id, accomplishment_type`,
    [claimId, accomplishmentType]
  );
  return rows[0] ?? null;
}

// Toggles whether an approved claim appears in the curated public
// browsing views (Dashboard/Timeline) -- see schema.sql's claims.featured
// comment. Never affects review_status, retrieval (Ask the Record),
// or Opposition Watch: a claim can be real, sourced, and fully
// approved/searchable while still being excluded from the curated grid
// (e.g. a genuine but off-topic incident report). Works in any
// review_status, same as accomplishment_type, since noise can be
// spotted before or after a claim goes live.
export async function updateFeatured(
  claimId: string,
  featured: boolean
): Promise<{ id: string; featured: boolean } | null> {
  const { rows } = await pool.query<{ id: string; featured: boolean }>(
    `UPDATE claims SET featured = $2 WHERE id = $1
     RETURNING id, featured`,
    [claimId, featured]
  );
  return rows[0] ?? null;
}

// Links a later claim to the earlier initiative/decision it completes
// (see schema.sql's completes_claim_id comment) -- pass null to unlink.
// Manual only: an admin searches for and picks the earlier claim (see
// searchAccomplishmentClaims below), never auto-matched.
export async function updateCompletesClaim(
  claimId: string,
  completesClaimId: string | null
): Promise<{ id: string; completes_claim_id: string | null } | null> {
  if (completesClaimId === claimId) {
    throw new ValidationError('A claim cannot complete itself');
  }
  const { rows } = await pool.query<{ id: string; completes_claim_id: string | null }>(
    `UPDATE claims SET completes_claim_id = $2 WHERE id = $1
     RETURNING id, completes_claim_id`,
    [claimId, completesClaimId]
  );
  return rows[0] ?? null;
}

// Links an opposition_statement claim to the accomplishment claim an
// admin has manually confirmed IS the government's own clarification --
// pass null to unlink. Manual only, same posture as updateCompletesClaim
// above: an admin searches for and picks the claim (searchAccomplishmentClaims
// below). Deliberately doesn't check c.stance here (mirrors
// updateCompletesClaim's own lack of a stance guard) -- the review queue
// UI only ever shows this control for opposition_statement claims, and
// the FK/self-reference check is the real DB-level guarantee. Clears the
// free-text clarification fields below when linking a claim -- the two
// mechanisms are mutually exclusive, see schema.sql's comment.
export async function updateManualClarification(
  claimId: string,
  clarificationClaimId: string | null
): Promise<{ id: string; manual_clarification_id: string | null } | null> {
  if (clarificationClaimId === claimId) {
    throw new ValidationError('A claim cannot be its own clarification');
  }
  const { rows } = await pool.query<{ id: string; manual_clarification_id: string | null }>(
    `UPDATE claims
     SET manual_clarification_id = $2,
         manual_clarification_title = CASE WHEN $2::uuid IS NULL THEN manual_clarification_title ELSE NULL END,
         manual_clarification_text = CASE WHEN $2::uuid IS NULL THEN manual_clarification_text ELSE NULL END,
         manual_clarification_url = CASE WHEN $2::uuid IS NULL THEN manual_clarification_url ELSE NULL END
     WHERE id = $1
     RETURNING id, manual_clarification_id`,
    [claimId, clarificationClaimId]
  );
  return rows[0] ?? null;
}

export interface ManualClarificationText {
  id: string;
  manual_clarification_title: string | null;
  manual_clarification_text: string | null;
  manual_clarification_url: string | null;
}

// The lighter-weight path: an admin writes the clarification directly
// (title + body + a source URL) rather than linking an existing ingested
// claim -- decided 2026-09-01, prompted directly: "the search to link
// for a clarification is searching for keywords and to be honest, if
// your LLM could not find a cogent match, I dont think a human would...
// leave the option for manual clarification, with the option to add a
// URL pointing to where they can get the proof." Pass all three null to
// clear. Still citation-gated at the application layer, not the DB --
// url is required whenever title/text are non-empty (never bare
// unsourced text), enforced here rather than a CHECK constraint so a
// clearer error message reaches the admin. Clears manual_clarification_id
// -- the two mechanisms are mutually exclusive, see schema.sql's comment.
export async function updateManualClarificationText(
  claimId: string,
  title: string | null,
  text: string | null,
  url: string | null
): Promise<ManualClarificationText | null> {
  const hasContent = !!(title || text || url);
  if (hasContent && !url) {
    throw new ValidationError('A source URL is required for a manual clarification -- never publish unsourced text');
  }
  const { rows } = await pool.query<ManualClarificationText>(
    `UPDATE claims
     SET manual_clarification_id = NULL,
         manual_clarification_title = $2,
         manual_clarification_text = $3,
         manual_clarification_url = $4
     WHERE id = $1
     RETURNING id, manual_clarification_title, manual_clarification_text, manual_clarification_url`,
    [claimId, title || null, text || null, url || null]
  );
  return rows[0] ?? null;
}

export interface ClaimSearchResult {
  id: string;
  title: string;
  accomplishment_type: string | null;
  event_date: string | null;
}

// Backing the review queue's "this completes an earlier claim" picker --
// searches approved accomplishment claims (the only kind a later claim
// can meaningfully "complete") by title, excluding the claim being edited
// itself. Plain ILIKE, not full-text: this is a small, admin-facing
// autocomplete, not the public retrieval path (see lib/retrieve.ts for
// that), so a simpler match is fine.
export async function searchAccomplishmentClaims(query: string, excludeId?: string): Promise<ClaimSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { rows } = await pool.query<ClaimSearchResult>(
    `SELECT id, title, accomplishment_type, to_char(event_date, 'YYYY-MM-DD') AS event_date
     FROM claims
     WHERE stance = 'accomplishment' AND review_status = 'approved'
       AND title ILIKE $1
       AND ($2::uuid IS NULL OR id != $2)
     ORDER BY event_date DESC NULLS LAST
     LIMIT 10`,
    [`%${trimmed}%`, excludeId ?? null]
  );
  return rows;
}
