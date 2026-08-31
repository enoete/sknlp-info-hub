import { pool } from './db';
import { withTimestamp } from './youtube';
import { findClosestRecord, OppositionRecord } from './oppositionWatch';

export interface DashboardClaim {
  id: string;
  title: string;
  summary: string;
  category: string | null;
  accomplishment_type: string | null;
  citizen_impact: string | null;
  year: number | null;
  event_date: string | null;
  source_org: string;
  source_url: string;
  source_type: string;
  // Set when a later approved claim links to this one via
  // completes_claim_id (see schema.sql) -- i.e. this initiative/decision
  // has since been completed. Null means either not yet completed, or no
  // completing claim has been linked yet.
  completed_by_claim_id: string | null;
  completed_by_title: string | null;
  completed_by_date: string | null;
}

export interface DashboardStats {
  accomplishments: number;
  sourcesIndexed: number;
  oppositionClaims: number;
  yearsLabel: string;
}

// Dashboard shows accomplishment-stance claims only, matching
// design-reference/mockup.html's framing ("WHAT'S ACTUALLY BEEN DONE" /
// "113 Documented accomplishments") and CLAUDE.md's non-negotiable that
// opposition statements are shown but never inside an accomplishment
// checkmark grid. Opposition statements belong to the (not yet built)
// Opposition Watch view.
export async function getDashboardClaims(): Promise<DashboardClaim[]> {
  const { rows } = await pool.query<DashboardClaim & { source_start_seconds: number | null }>(
    `SELECT
       c.id, c.title, c.summary, c.category, c.accomplishment_type, c.citizen_impact,
       EXTRACT(YEAR FROM c.event_date)::INT AS year,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.speaker_org AS source_org, s.origin_url AS source_url, s.source_type,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds,
       done.id AS completed_by_claim_id, done.title AS completed_by_title,
       to_char(done.event_date, 'YYYY-MM-DD') AS completed_by_date
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     LEFT JOIN claims done ON done.completes_claim_id = c.id AND done.review_status = 'approved'
     WHERE c.review_status = 'approved' AND c.stance = 'accomplishment'
     ORDER BY c.event_date DESC NULLS LAST`
  );
  // Deep-link to the exact moment a claim was said when we have a real
  // timestamp (transcript_segments.start_seconds), falling back to the
  // bare video/document URL otherwise — never guessed, only ever real
  // per-claim data from the ingestion agent.
  return rows.map((r) => ({ ...r, source_url: withTimestamp(r.source_url, r.source_start_seconds) }));
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { rows } = await pool.query<{
    accomplishments: string;
    sources_indexed: string;
    opposition_claims: string;
    min_year: number | null;
    max_year: number | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE c.stance = 'accomplishment') AS accomplishments,
       count(DISTINCT s.id) AS sources_indexed,
       count(*) FILTER (WHERE c.stance = 'opposition_statement') AS opposition_claims,
       min(EXTRACT(YEAR FROM c.event_date))::INT AS min_year,
       max(EXTRACT(YEAR FROM c.event_date))::INT AS max_year
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     WHERE c.review_status = 'approved'`
  );
  const row = rows[0];
  const yearsLabel =
    row.min_year && row.max_year
      ? row.min_year === row.max_year
        ? `${row.min_year}`
        : `${row.min_year}–${row.max_year}`
      : 'none yet';

  return {
    accomplishments: Number(row.accomplishments),
    sourcesIndexed: Number(row.sources_indexed),
    oppositionClaims: Number(row.opposition_claims),
    yearsLabel
  };
}

// ------------------------------------------------------------
// Timeline — every approved claim (both stances), ordered by event_date.
// Undated claims are a real, visible gap (see CLAUDE.md's Dashboard fix
// notes: ~49 of ~65 approved accomplishments have no event_date from
// older seed batches) — the client groups them into their own explicit
// section rather than silently dropping them, so the gap stays visible
// and closes naturally as a human confirms dates via the Review Queue's
// event_date_suggested flow, not by hiding the problem.
// ------------------------------------------------------------
export interface TimelineClaim {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
  accomplishment_type: string | null;
  citizen_impact: string | null;
  event_date: string | null;
}

export async function getTimelineClaims(): Promise<TimelineClaim[]> {
  const { rows } = await pool.query<TimelineClaim>(
    `SELECT c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type, c.citizen_impact,
            to_char(c.event_date, 'YYYY-MM-DD') AS event_date
     FROM claims c
     WHERE c.review_status = 'approved'
     ORDER BY c.event_date DESC NULLS LAST, c.created_at DESC`
  );
  return rows;
}

// ------------------------------------------------------------
// Claim detail — the "click through to the actual record" destination
// for the Timeline (and anywhere else that links a single claim). Mirrors
// design-reference/mockup.html's claim-detail-head/detail-grid layout:
// one citation (same one-source-per-claim pattern used everywhere else
// in this app), proof_documents if any were uploaded, and — for an
// opposition-stance claim only — the closest same-category accomplishment
// record via the same matcher Opposition Watch itself uses, so the two
// pages can never disagree about which record a claim gets paired with.
// ------------------------------------------------------------
export interface ClaimProofDocument {
  id: string;
  title: string;
  file_type: string;
  file_url: string;
  document_dated_at: string | null;
}

export interface LinkedClaim {
  id: string;
  title: string;
  event_date: string | null;
}

export interface ClaimDetail {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
  accomplishment_type: string | null;
  citizen_impact: string | null;
  event_date: string | null;
  review_status: string;
  source_type: string;
  source_title: string;
  speaker_org: string;
  speaker_name: string | null;
  source_url: string;
  published_at: string | null;
  source_count: number;
  proof_documents: ClaimProofDocument[];
  closest_record: OppositionRecord | null;
  // See schema.sql's completes_claim_id -- `completes` is the earlier
  // initiative/decision THIS claim fulfills; `completed_by` is the later
  // claim that fulfills THIS one. A claim can have at most one of each.
  completes: LinkedClaim | null;
  completed_by: LinkedClaim | null;
}

export async function getClaimById(id: string): Promise<ClaimDetail | null> {
  const { rows } = await pool.query<
    Omit<ClaimDetail, 'source_url' | 'proof_documents' | 'closest_record' | 'source_count' | 'completes' | 'completed_by'> & {
      origin_url: string;
      source_start_seconds: number | null;
      source_count: string;
      completes_claim_id: string | null;
    }
  >(
    `SELECT
       c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type, c.citizen_impact,
       c.completes_claim_id,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date, c.review_status,
       s.source_type, s.title AS source_title, s.speaker_org, s.speaker_name,
       s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds,
       (SELECT count(*) FROM claim_sources cs2 WHERE cs2.claim_id = c.id) AS source_count
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     WHERE c.id = $1 AND c.review_status = 'approved'
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: proofRows } = await pool.query<ClaimProofDocument>(
    `SELECT pd.id, pd.title, pd.file_type, pd.file_url,
            to_char(pd.document_dated_at, 'YYYY-MM-DD') AS document_dated_at
     FROM claim_proof_documents cpd
     JOIN proof_documents pd ON pd.id = cpd.proof_id
     WHERE cpd.claim_id = $1
     ORDER BY pd.document_dated_at DESC NULLS LAST`,
    [id]
  );

  const closest_record =
    row.stance === 'opposition_statement' ? await findClosestRecord(row.category, `${row.title} ${row.summary}`) : null;

  let completes: LinkedClaim | null = null;
  if (row.completes_claim_id) {
    const { rows: completesRows } = await pool.query<LinkedClaim>(
      `SELECT id, title, to_char(event_date, 'YYYY-MM-DD') AS event_date FROM claims WHERE id = $1`,
      [row.completes_claim_id]
    );
    completes = completesRows[0] ?? null;
  }

  const { rows: completedByRows } = await pool.query<LinkedClaim>(
    `SELECT id, title, to_char(event_date, 'YYYY-MM-DD') AS event_date
     FROM claims WHERE completes_claim_id = $1 AND review_status = 'approved'
     LIMIT 1`,
    [id]
  );

  return {
    ...row,
    source_url: withTimestamp(row.origin_url, row.source_start_seconds),
    source_count: Number(row.source_count),
    proof_documents: proofRows,
    closest_record,
    completes,
    completed_by: completedByRows[0] ?? null
  };
}
