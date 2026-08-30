import { pool } from './db';

export interface RetrievedRow {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
  event_date: string | null;
  source_type: string;
  source_title: string;
  speaker_name: string | null;
  speaker_org: string;
  origin_url: string;
  published_at: string | null;
}

// Real retrieval against Postgres full-text search — no embeddings (no
// Voyage AI key yet). Builds an OR-of-stemmed-lexemes tsquery rather than
// websearch_to_tsquery's implicit AND: AND semantics turned out to exclude
// the actual best-matching claim whenever the question contained one
// incidental word ("actually") absent from that claim's text — verified
// against real seeded data before this was chosen. OR is deliberately
// recall-favoring (a shared word like "government" is enough to retrieve
// a candidate); precision is enforced downstream by the LLM's found/
// not-found judgment on the actual candidates, not by retrieval alone.
//
// Shared by /api/ask and the suggested-questions generator (lib/suggestions.ts)
// so "will this question find something" is answered by the exact same logic
// in both places — no risk of a suggestion promising a hit the real endpoint
// wouldn't actually produce.
export async function retrieve(question: string): Promise<RetrievedRow[]> {
  const { rows } = await pool.query<RetrievedRow>(
    `WITH q AS (
       SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
       FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
     )
     SELECT
       c.id, c.stance, c.title, c.summary, c.category,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org,
       s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     CROSS JOIN q
     WHERE c.review_status = 'approved'
       AND q.tsq IS NOT NULL
       AND (c.search_vector @@ q.tsq OR s.search_vector @@ q.tsq)
     ORDER BY (ts_rank(c.search_vector, q.tsq) + ts_rank(s.search_vector, q.tsq)) DESC
     LIMIT 3`,
    [question]
  );
  return rows;
}
