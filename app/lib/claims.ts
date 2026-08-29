import { pool } from './db';

export interface DashboardClaim {
  id: string;
  title: string;
  summary: string;
  category: string | null;
  year: number | null;
  event_date: string | null;
  source_org: string;
  source_url: string;
  source_type: string;
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
  const { rows } = await pool.query<DashboardClaim>(
    `SELECT
       c.id, c.title, c.summary, c.category, c.year,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.speaker_org AS source_org, s.origin_url AS source_url, s.source_type
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     WHERE c.review_status = 'approved' AND c.stance = 'accomplishment'
     ORDER BY c.event_date DESC NULLS LAST`
  );
  return rows;
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
       min(c.year) AS min_year,
       max(c.year) AS max_year
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
