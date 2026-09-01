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
  // Only meaningful on an opposition_statement row -- see schema.sql's
  // manual_clarification_id / manual_clarification_text / _url. Used
  // internally by findRelatedRecordsForOpposition to prefer an admin's
  // explicit clarification (linked claim or written text+URL) over the
  // tsquery/category fallback. Mutually exclusive per-claim.
  manual_clarification_id: string | null;
  manual_clarification_title: string | null;
  manual_clarification_text: string | null;
  manual_clarification_url: string | null;
  // 'direct' = matched the question's own lexemes (the normal case).
  // 'related' = pulled in as a supplementary same-category accomplishment
  // record for an opposition claim that matched directly but had no
  // counterpart in the top hits — see the cross-reference step below.
  // Never omitted so route.ts's context block can warn the model this is
  // a topic-level pairing, not a confirmed match on this specific claim
  // (same "clarification, not a verdict" posture as oppositionWatch.ts's
  // findClosestRecord, just reused inside chat).
  // 'manual_clarification' = an admin explicitly linked this accomplishment
  // claim as the government's own response to a retrieved opposition claim
  // (see schema.sql's manual_clarification_id) -- unlike 'related', this
  // IS a confirmed match, not a topic-adjacent guess, and route.ts's
  // context-block note says so.
  match_type: 'direct' | 'related' | 'manual_clarification';
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
  const { rows } = await pool.query<
    RetrievedRow & { source_start_seconds: number | null; combined_rank: number; manual_clarification_id: string | null }
  >(
    `WITH q AS (
       SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
       FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
     ),
     -- One row per (claim, source) pair, same as before -- kept
     -- deliberately unfiltered on which source matched, since a claim
     -- can have several sources and the query text might only match one
     -- of them (matching against a single "representative" source here
     -- would silently drop real hits, not just duplicate them).
     matches AS (
       SELECT
         c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type,
         c.manual_clarification_id, c.manual_clarification_title, c.manual_clarification_text, c.manual_clarification_url,
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
         (ts_rank(c.search_vector, q.tsq) + ts_rank(s.search_vector, q.tsq)) AS combined_rank
       FROM claims c
       JOIN claim_sources cs ON cs.claim_id = c.id
       JOIN sources s ON s.id = cs.source_id
       LEFT JOIN claims completes ON completes.id = c.completes_claim_id
       LEFT JOIN claims done ON done.completes_claim_id = c.id AND done.review_status = 'approved'
       CROSS JOIN q
       WHERE c.review_status = 'approved'
         AND q.tsq IS NOT NULL
         AND (c.search_vector @@ q.tsq OR s.search_vector @@ q.tsq)
     )
     -- Collapse to one row per claim -- the source that matched best,
     -- via combined_rank -- before applying LIMIT, so a corroborated
     -- claim can't occupy more than one of the top-5 retrieval slots
     -- (confirmed live 2026-08-31: the same fan-out bug found on the
     -- Dashboard was present here too, wasting retrieval budget on the
     -- same fact twice instead of surfacing a genuinely distinct one).
     SELECT DISTINCT ON (id) *
     FROM matches
     ORDER BY id, combined_rank DESC`,
    [question]
  );
  rows.sort((a, b) => Number(b.combined_rank) - Number(a.combined_rank));
  const top5 = rows.slice(0, 5);
  // Deep-link when we have a real per-claim timestamp — see claims.ts for
  // the same pattern. The model is given (and must cite back verbatim) this
  // already-deep-linked URL, so the downstream citation-match validation in
  // /api/ask stays correct without any special-casing there.
  const direct: RetrievedRow[] = top5.map((r) => ({
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
    if (claim.stance !== 'opposition_statement') continue;

    // An admin's manual_clarification_id (see schema.sql) always wins
    // over the tsquery/category fallback below -- same priority order
    // as oppositionWatch.ts's getOppositionPairs, and for the same
    // reason: explicit human judgment outranks a heuristic, and it's a
    // genuinely confirmed pairing, not a topic-adjacent guess.
    if (claim.manual_clarification_id && !seenIds.has(claim.manual_clarification_id)) {
      const { rows: manualRows } = await pool.query<RetrievedRow & { source_start_seconds: number | null }>(
        `SELECT
           c.id, c.stance, c.title, c.summary, c.category, c.accomplishment_type,
           to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
           s.source_type, s.source_title, s.speaker_name, s.speaker_org,
           s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
           (SELECT ts.start_seconds
            FROM claim_transcript_segments cts
            JOIN transcript_segments ts ON ts.id = cts.segment_id
            WHERE cts.claim_id = c.id
            ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds,
           completes.title AS completes_title, to_char(completes.event_date, 'YYYY-MM-DD') AS completes_date,
           done.title AS completed_by_title, to_char(done.event_date, 'YYYY-MM-DD') AS completed_by_date
         FROM claims c
         JOIN LATERAL (
           SELECT s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org, s.origin_url, s.published_at
           FROM claim_sources cs
           JOIN sources s ON s.id = cs.source_id
           WHERE cs.claim_id = c.id
           ORDER BY s.created_at DESC
           LIMIT 1
         ) s ON true
         LEFT JOIN claims completes ON completes.id = c.completes_claim_id
         LEFT JOIN claims done ON done.completes_claim_id = c.id AND done.review_status = 'approved'
         WHERE c.id = $1 AND c.review_status = 'approved'`,
        [claim.manual_clarification_id]
      );
      const manualRow = manualRows[0];
      if (manualRow) {
        seenIds.add(manualRow.id);
        related.push({
          ...manualRow,
          manual_clarification_id: null,
          manual_clarification_title: null,
          manual_clarification_text: null,
          manual_clarification_url: null,
          origin_url: withTimestamp(manualRow.origin_url, manualRow.source_start_seconds),
          match_type: 'manual_clarification'
        });
        continue;
      }
    }

    // Second manual mechanism: an admin-written clarification (title +
    // text + URL, no linked claim -- see schema.sql's comment on why
    // this exists alongside manual_clarification_id). Same priority as
    // the linked-claim case above, just no claims-table row to query.
    if (claim.manual_clarification_url) {
      related.push({
        id: `manual:${claim.id}`,
        stance: 'accomplishment',
        title: claim.manual_clarification_title ?? 'Government clarification',
        summary: claim.manual_clarification_text ?? '',
        category: claim.category,
        accomplishment_type: null,
        event_date: null,
        source_type: 'official_govt',
        source_title: 'Admin-provided source',
        speaker_name: null,
        speaker_org: 'Government (manual entry)',
        origin_url: claim.manual_clarification_url,
        published_at: null,
        completes_title: null,
        completes_date: null,
        completed_by_title: null,
        completed_by_date: null,
        manual_clarification_id: null,
        manual_clarification_title: null,
        manual_clarification_text: null,
        manual_clarification_url: null,
        match_type: 'manual_clarification'
      });
      continue;
    }

    if (!claim.category) continue;
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
         s.source_type, s.source_title, s.speaker_name, s.speaker_org,
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
       -- Same fan-out fix as retrieve()'s main query above -- here the
       -- rank only depends on c.search_vector, not the source, so
       -- picking one representative source (most recently linked) for
       -- display is safe and doesn't risk dropping a real match.
       JOIN LATERAL (
         SELECT s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org, s.origin_url, s.published_at
         FROM claim_sources cs
         JOIN sources s ON s.id = cs.source_id
         WHERE cs.claim_id = c.id
         ORDER BY s.created_at DESC
         LIMIT 1
       ) s ON true
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
      related.push({
        ...row,
        manual_clarification_id: null,
        manual_clarification_title: null,
        manual_clarification_text: null,
        manual_clarification_url: null,
        origin_url: withTimestamp(row.origin_url, row.source_start_seconds),
        match_type: 'related'
      });
    }
  }
  return related;
}
