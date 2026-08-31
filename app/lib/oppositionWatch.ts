import { pool } from './db';

export interface OppositionRecord {
  title: string;
  summary: string;
  source_type: string;
  source_title: string;
  speaker_org: string;
  origin_url: string;
  published_at: string | null;
}

export interface OppositionPair {
  id: string;
  category: string | null;
  title: string;
  summary: string;
  event_date: string | null;
  source_type: string;
  source_title: string;
  speaker_name: string | null;
  speaker_org: string;
  origin_url: string;
  published_at: string | null;
  record: OppositionRecord | null;
}

// Same category-matching approach as getFollowUpQuestions in suggestions.ts
// (same category, approved, excludes nothing else) — but "closest" here
// needs to be a single, stable pick, not a random sample, since this page
// isn't ephemeral suggestion pills, it's a public claim-vs-record pairing
// that has to look the same on every load. Ranked with the same
// OR-of-stemmed-lexemes tsquery retrieve.ts uses (not plainto_tsquery's
// implicit AND, which was tested here first and returned a useless tied
// near-zero rank for every candidate — a single real keyword match like
// "crime" got diluted into nothing by the rest of the AND-ed sentence).
async function findClosestRecord(
  category: string | null,
  oppositionText: string
): Promise<OppositionRecord | null> {
  if (!category) return null;

  const { rows } = await pool.query<OppositionRecord & { rank: number }>(
    `WITH q AS (
       SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
       FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
     )
     SELECT
       c.title, c.summary, s.source_type, s.title AS source_title,
       s.speaker_org, s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       coalesce(ts_rank(c.search_vector, q.tsq), 0) AS rank
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     CROSS JOIN q
     WHERE c.review_status = 'approved' AND c.stance = 'accomplishment' AND c.category = $2
     ORDER BY rank DESC, c.event_date DESC NULLS LAST
     LIMIT 1`,
    [oppositionText, category]
  );
  return rows[0] ?? null;
}

// Public Opposition Watch data: every approved opposition_statement claim,
// each paired with its closest same-category accomplishment record (or
// null — never forced). No repeat-clustering yet (see CLAUDE.md/commit
// message) — that's for when ingestion produces real volume; with 2 real
// claims today, every "claim" here is its own thread of exactly one.
export async function getOppositionPairs(): Promise<OppositionPair[]> {
  const { rows: claims } = await pool.query<{
    id: string;
    category: string | null;
    title: string;
    summary: string;
    event_date: string | null;
    source_type: string;
    source_title: string;
    speaker_name: string | null;
    speaker_org: string;
    origin_url: string;
    published_at: string | null;
  }>(
    `SELECT
       c.id, c.category, c.title, c.summary,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org,
       s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     WHERE c.review_status = 'approved' AND c.stance = 'opposition_statement'
     ORDER BY c.event_date DESC NULLS LAST, c.created_at DESC`
  );

  const pairs: OppositionPair[] = [];
  for (const c of claims) {
    const record = await findClosestRecord(c.category, `${c.title} ${c.summary}`);
    pairs.push({ ...c, record });
  }
  return pairs;
}
