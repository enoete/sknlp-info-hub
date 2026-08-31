import { pool } from './db';
import { withTimestamp } from './youtube';
import { MIN_RELEVANT_RANK } from './oppositionWatch';

export interface RetrievedRow {
  id: string;
  stance: string;
  title: string;
  summary: string;
  category: string | null;
  accomplishment_type: string | null;
  event_date: string | null;
  source_type: string;
  source_title: string;
  speaker_name: string | null;
  speaker_org: string;
  origin_url: string;
  published_at: string | null;
  // See schema.sql's completes_claim_id / DashboardClaim's
  // completed_by_* fields — lets the chatbot report an initiative's
  // up-to-date status (e.g. "launched in March 2023, completed as of
  // [date]") instead of only ever quoting the older, now-stale claim.
  completes_title: string | null;
  completes_date: string | null;
  completed_by_title: string | null;
  completed_by_date: string | null;
  // 'direct' = matched the question's own lexemes (the normal case).
  // 'related' = pulled in as a supplementary same-category accomplishment
  // record for an opposition claim that matched directly but had no
  // counterpart in the top hits — see the cross-reference step below.
  // Never omitted so route.ts's context block can warn the model this is
  // a topic-level pairing, not a confirmed match on this specific claim
  // (same "clarification, not a verdict" posture as oppositionWatch.ts's
  // findClosestRecord, just reused inside chat).
  match_type: 'direct' | 'related';
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
  const { rows } = await pool.query<RetrievedRow & { source_start_seconds: number | null }>(
    `WITH q AS (
       SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
       FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
     )
     SELECT
       c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org,
       s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds,
       completes.title AS completes_title, to_char(completes.event_date, 'YYYY-MM-DD') AS completes_date,
       done.title AS completed_by_title, to_char(done.event_date, 'YYYY-MM-DD') AS completed_by_date
     FROM claims c
     JOIN claim_sources cs ON cs.claim_id = c.id
     JOIN sources s ON s.id = cs.source_id
     LEFT JOIN claims completes ON completes.id = c.completes_claim_id
     LEFT JOIN claims done ON done.completes_claim_id = c.id AND done.review_status = 'approved'
     CROSS JOIN q
     WHERE c.review_status = 'approved'
       AND q.tsq IS NOT NULL
       AND (c.search_vector @@ q.tsq OR s.search_vector @@ q.tsq)
     ORDER BY (ts_rank(c.search_vector, q.tsq) + ts_rank(s.search_vector, q.tsq)) DESC
     LIMIT 3`,
    [question]
  );
  // Deep-link when we have a real per-claim timestamp — see claims.ts for
  // the same pattern. The model is given (and must cite back verbatim) this
  // already-deep-linked URL, so the downstream citation-match validation in
  // /api/ask stays correct without any special-casing there.
  const direct: RetrievedRow[] = rows.map((r) => ({
    ...r,
    origin_url: withTimestamp(r.origin_url, r.source_start_seconds),
    match_type: 'direct'
  }));

  const related = await findRelatedRecordsForOpposition(direct);
  return [...direct, ...related];
}

// Cross-reference step: an opposition claim that matched the question
// directly often has no accomplishment counterpart in the top-3 lexeme
// hits above, purely because the two sides describe the same topic in
// different words (e.g. "Marriott loan" vs. "hotel financing package") —
// tsquery only rewards shared vocabulary. This mirrors what
// oppositionWatch.ts's findClosestRecord already does for the public
// /opposition-watch page (same category, same OR-of-stemmed-lexemes
// ranking on title+summary) so the chatbot gives the same "closest
// documented record" pairing instead of a narrower, lexeme-luck-dependent
// one. Capped to one supplementary lookup per opposition claim in the
// direct set, and skipped entirely when a same-category accomplishment
// claim is already present (nothing to add).
async function findRelatedRecordsForOpposition(direct: RetrievedRow[]): Promise<RetrievedRow[]> {
  const related: RetrievedRow[] = [];
  const seenIds = new Set(direct.map((r) => r.id));

  for (const claim of direct) {
    if (claim.stance !== 'opposition_statement' || !claim.category) continue;
    const hasCounterpart = direct.some((r) => r.stance === 'accomplishment' && r.category === claim.category);
    if (hasCounterpart) continue;

    const { rows } = await pool.query<RetrievedRow & { source_start_seconds: number | null; rank: number }>(
      `WITH q AS (
         SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
         FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
       )
       SELECT
         c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type,
         to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
         s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org,
         s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
         (SELECT ts.start_seconds
          FROM claim_transcript_segments cts
          JOIN transcript_segments ts ON ts.id = cts.segment_id
          WHERE cts.claim_id = c.id
          ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds,
         completes.title AS completes_title, to_char(completes.event_date, 'YYYY-MM-DD') AS completes_date,
         done.title AS completed_by_title, to_char(done.event_date, 'YYYY-MM-DD') AS completed_by_date,
         coalesce(ts_rank(c.search_vector, q.tsq), 0) AS rank
       FROM claims c
       JOIN claim_sources cs ON cs.claim_id = c.id
       JOIN sources s ON s.id = cs.source_id
       LEFT JOIN claims completes ON completes.id = c.completes_claim_id
       LEFT JOIN claims done ON done.completes_claim_id = c.id AND done.review_status = 'approved'
       CROSS JOIN q
       WHERE c.review_status = 'approved' AND c.stance = 'accomplishment' AND c.category = $2
       ORDER BY rank DESC, c.event_date DESC NULLS LAST
       LIMIT 1`,
      [`${claim.title} ${claim.summary}`, claim.category]
    );
    const row = rows[0];
    if (row && row.rank >= MIN_RELEVANT_RANK && !seenIds.has(row.id)) {
      seenIds.add(row.id);
      related.push({ ...row, origin_url: withTimestamp(row.origin_url, row.source_start_seconds), match_type: 'related' });
    }
  }
  return related;
}
