import { pool } from './db';
import { withTimestamp } from './youtube';
import { ValidationError } from './sourceManager';

export interface ReviewQueueClaim {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
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
         c.id, c.stance, c.title, c.summary, c.category, c.sentiment,
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
