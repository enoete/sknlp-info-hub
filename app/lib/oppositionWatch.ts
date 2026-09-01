import { pool } from './db';
import { withTimestamp } from './youtube';

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
  // The actual named individual (Timothy Harris, Mark Brantley, Kyle
  // Flanders, Ian "Patches" Liburd, ...) — distinct from speaker_name
  // above, which lives on `sources` at one-per-video granularity and is
  // null for every opposition source today (see CLAUDE.md's "Named
  // opposition speaker filtering" decision). This instead comes from
  // transcript_segments.speaker_name_at_time, captured per claim, so a
  // multi-speaker video (a Straight Talk episode playing a government
  // clip, a PLP convention with several speakers) resolves correctly
  // per statement rather than one name for the whole video. Null when
  // genuinely not identified — never guessed, never backfilled from a
  // channel default beyond the one verified "Host" mapping.
  named_speaker: string | null;
  origin_url: string;
  published_at: string | null;
  // Derived from COALESCE(event_date, published_at), same fallback the
  // page already displays with — event_date is human-confirmed-only and
  // usually still NULL for opposition claims (see schema.sql), so a
  // year filter keyed on event_date alone would leave most claims
  // unbucketed. The video's own published_at is reliably known for
  // every scraped source, so it's the honest "when" for filtering here.
  year: number | null;
  record: OppositionRecord | null;
  // 'manual' when an admin explicitly linked `record` via
  // manual_clarification_id (see schema.sql) -- always takes priority
  // over 'auto' (findClosestRecord's same-category heuristic match).
  // null when `record` itself is null (no clarification at all).
  record_source: 'manual' | 'auto' | null;
}

// Below this, "closest" is really "least-unrelated" — noise, not worth
// spending an LLM relevance call on (see isGenuinelyRelevant below, the
// real gate now). Deliberately low -- this is just a cheap pre-filter to
// skip zero-signal candidates, not the correctness boundary anymore. A
// pure numeric threshold turned out NOT to be a reliable correctness
// boundary on its own: raising it to 0.12 fixed one bad live pairing
// ("Terrence Crossman terminated" paired with an unrelated Development
// Bank cash story at rank 0.103) but a second bad pairing surfaced right
// after ("Crossman's compensation contract" paired with unrelated
// National Bank *asset-size* stats) at rank 0.200 -- HIGHER than a
// genuine match ("2,400 NHC housing units", 0.158) -- because both
// texts happened to share the bank's full institutional name verbatim.
// ts_rank rewards exact multi-word phrase overlap regardless of whether
// the two claims are actually about the same specific topic, so no
// single number can separate "real match" from "same institution,
// different story." Real relevance judgment now happens in
// isGenuinelyRelevant() instead.
export const MIN_RELEVANT_RANK = 0.05;

const RELEVANCE_TOOL = {
  name: 'judge_relevance',
  description:
    'Judge whether a candidate government record genuinely addresses the same specific topic as an opposition claim, not just the same organization or general category.',
  input_schema: {
    type: 'object' as const,
    properties: {
      relevant: {
        type: 'boolean',
        description:
          'true only if the record substantively speaks to the same specific matter as the claim (the same event, decision, figure, or allegation) -- false if it just happens to mention the same institution, person, or category without actually addressing what the claim is about.'
      }
    },
    required: ['relevant']
  }
};

// The real relevance gate. ts_rank alone can't tell "same institution,
// different story" apart from a genuine match (see MIN_RELEVANT_RANK's
// comment) -- this asks the actual question directly. Cheap model
// (Haiku), tight token budget, single boolean out -- this is a yes/no
// judgment, not a generative task. Fails closed: no API key, a non-2xx
// response, or any error all return false (no record shown) rather than
// falling back to the old "just show the top ts_rank hit" behavior --
// consistent with the client's explicit instruction that showing
// nothing is correct when there's no real clarification, never a forced
// pairing.
async function isGenuinelyRelevant(oppositionText: string, recordText: string): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-xxxx') return false;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
        system:
          'You judge whether two short statements are substantively about the same specific matter, not merely the same organization, person, or general category.',
        messages: [
          {
            role: 'user',
            content: `Opposition claim: "${oppositionText}"\n\nCandidate government record: "${recordText}"\n\nDoes the record genuinely address the SAME SPECIFIC matter as the claim (the same event, decision, figure, or allegation) -- not just mention the same institution or general category?`
          }
        ],
        tools: [RELEVANCE_TOOL],
        tool_choice: { type: 'tool', name: 'judge_relevance' }
      })
    });
    if (!res.ok) return false;
    const data = await res.json();
    const toolUse = (data.content ?? []).find((b: any) => b.type === 'tool_use');
    return toolUse?.input?.relevant === true;
  } catch {
    return false;
  }
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
export async function findClosestRecord(
  category: string | null,
  oppositionText: string
): Promise<OppositionRecord | null> {
  if (!category) return null;

  const { rows } = await pool.query<OppositionRecord & { rank: number; source_start_seconds: number | null }>(
    `WITH q AS (
       SELECT to_tsquery('english', string_agg(lexeme, ' | ')) AS tsq
       FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
     )
     SELECT
       c.title, c.summary, s.source_type, s.title AS source_title,
       s.speaker_org, s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       coalesce(ts_rank(c.search_vector, q.tsq), 0) AS rank,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds
     FROM claims c
     -- One representative source per claim, same LATERAL pattern as
     -- claims.ts's getDashboardClaims fix -- a plain JOIN here let a
     -- multi-source claim occupy the ORDER BY/LIMIT 1 tie non-
     -- deterministically depending on WHICH of its sources sorted last.
     JOIN LATERAL (
       SELECT s.source_type, s.title, s.speaker_org, s.origin_url, s.published_at
       FROM claim_sources cs
       JOIN sources s ON s.id = cs.source_id
       WHERE cs.claim_id = c.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) s ON true
     CROSS JOIN q
     WHERE c.review_status = 'approved' AND c.stance = 'accomplishment' AND c.category = $2
     ORDER BY rank DESC, c.event_date DESC NULLS LAST
     LIMIT 1`,
    [oppositionText, category]
  );
  const row = rows[0];
  if (!row || row.rank < MIN_RELEVANT_RANK) return null;

  const relevant = await isGenuinelyRelevant(oppositionText, `${row.title}: ${row.summary}`);
  if (!relevant) return null;

  return { ...row, origin_url: withTimestamp(row.origin_url, row.source_start_seconds) };
}

// findClosestRecord now makes a real LLM call per candidate above
// MIN_RELEVANT_RANK (see isGenuinelyRelevant) instead of being a pure,
// free DB query -- getOppositionPairs() calls it once per approved
// opposition claim, so an uncached page load could fire dozens of LLM
// calls on every single visitor. Cached like suggestions.ts's pool --
// same TTL, same tradeoff (content can be up to this stale after a new
// claim is approved) -- deliberately giving up the "always live, never
// stored" property this function used to have in its own comment,
// because that property isn't worth paying for on every page view once
// real relevance judgment is in the loop.
const PAIRS_CACHE_TTL_MS = 10 * 60 * 1000;
let pairsCache: { pairs: OppositionPair[]; expiresAt: number } | null = null;

// Public Opposition Watch data: every approved opposition_statement claim,
// each paired with its closest same-category accomplishment record (or
// null — never forced). No repeat-clustering yet (see CLAUDE.md/commit
// message) — that's for when ingestion produces real volume; with 2 real
// claims today, every "claim" here is its own thread of exactly one.
export async function getOppositionPairs(): Promise<OppositionPair[]> {
  const now = Date.now();
  if (pairsCache && pairsCache.expiresAt > now) return pairsCache.pairs;

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
    year: number | null;
    named_speaker: string | null;
    source_start_seconds: number | null;
    manual_clarification_id: string | null;
    manual_clarification_title: string | null;
    manual_clarification_text: string | null;
    manual_clarification_url: string | null;
  }>(
    `SELECT
       c.id, c.category, c.title, c.summary, c.manual_clarification_id,
       c.manual_clarification_title, c.manual_clarification_text, c.manual_clarification_url,
       to_char(c.event_date, 'YYYY-MM-DD') AS event_date,
       s.source_type, s.source_title, s.speaker_name, s.speaker_org,
       s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       EXTRACT(YEAR FROM coalesce(c.event_date, s.published_at))::INT AS year,
       (SELECT ts.speaker_name_at_time
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS named_speaker,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds
     FROM claims c
     -- Same fan-out fix as getDashboardClaims/findClosestRecord above --
     -- confirmed live 2026-08-31 this rendered a corroborated opposition
     -- claim as one Opposition Watch card per linked source.
     JOIN LATERAL (
       SELECT s.source_type, s.title AS source_title, s.speaker_name, s.speaker_org, s.origin_url, s.published_at
       FROM claim_sources cs
       JOIN sources s ON s.id = cs.source_id
       WHERE cs.claim_id = c.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) s ON true
     WHERE c.review_status = 'approved' AND c.stance = 'opposition_statement'
     ORDER BY c.event_date DESC NULLS LAST, c.created_at DESC`
  );

  // Parallel, not sequential -- findClosestRecord now makes a real LLM
  // call per claim (isGenuinelyRelevant), and awaiting each one in turn
  // made a cold page load take ~48s with ~60 opposition claims (verified
  // live 2026-08-31). Each claim's lookup is fully independent, so
  // running them concurrently is safe and turns that into roughly one
  // call's latency instead of N.
  //
  // An admin's manual clarification -- either a linked claim
  // (manual_clarification_id) or a written one (manual_clarification_text
  // + url, see schema.sql) -- always wins over the automated match, both
  // because explicit human judgment should outrank a heuristic, and
  // because it saves an LLM relevance call for every claim an admin has
  // already resolved. The two manual mechanisms are mutually exclusive
  // per-claim (enforced in reviewQueue.ts), so at most one applies.
  const manualIds = Array.from(new Set(claims.map((c) => c.manual_clarification_id).filter((id): id is string => id !== null)));
  const manualRecords = manualIds.length ? await fetchClaimsAsRecords(manualIds) : new Map<string, OppositionRecord>();

  const needsAutoMatch = (c: (typeof claims)[number]) => !c.manual_clarification_id && !c.manual_clarification_url;
  const records = await Promise.all(
    claims.map((c) => (needsAutoMatch(c) ? findClosestRecord(c.category, `${c.title} ${c.summary}`) : Promise.resolve(null)))
  );
  const pairs: OppositionPair[] = claims.map((c, i) => {
    const linked = c.manual_clarification_id ? manualRecords.get(c.manual_clarification_id) ?? null : null;
    const written: OppositionRecord | null = c.manual_clarification_url
      ? {
          title: c.manual_clarification_title ?? 'Government clarification',
          summary: c.manual_clarification_text ?? '',
          source_type: 'official_govt',
          source_title: 'Admin-provided source',
          speaker_org: 'Government (manual entry)',
          origin_url: c.manual_clarification_url,
          published_at: null
        }
      : null;
    const manual = linked ?? written;
    const record = manual ?? records[i];
    return {
      ...c,
      origin_url: withTimestamp(c.origin_url, c.source_start_seconds),
      record,
      record_source: manual ? 'manual' : record ? 'auto' : null
    };
  });
  pairsCache = { pairs, expiresAt: now + PAIRS_CACHE_TTL_MS };
  return pairs;
}

// Batch-fetches OppositionRecord-shaped data for a set of manually-linked
// clarification claim ids -- same shape findClosestRecord returns, so the
// UI doesn't need to know whether a record came from the heuristic match
// or an admin's explicit link. Exported for claims.ts's getClaimById,
// which needs the identical manual-clarification lookup for a single
// claim on the detail page.
export async function fetchClaimsAsRecords(claimIds: string[]): Promise<Map<string, OppositionRecord>> {
  const { rows } = await pool.query<OppositionRecord & { id: string; source_start_seconds: number | null }>(
    `SELECT
       c.id, c.title, c.summary, s.source_type, s.title AS source_title,
       s.speaker_org, s.origin_url, to_char(s.published_at, 'YYYY-MM-DD') AS published_at,
       (SELECT ts.start_seconds
        FROM claim_transcript_segments cts
        JOIN transcript_segments ts ON ts.id = cts.segment_id
        WHERE cts.claim_id = c.id
        ORDER BY ts.start_seconds ASC LIMIT 1) AS source_start_seconds
     FROM claims c
     JOIN LATERAL (
       SELECT s.source_type, s.title, s.speaker_org, s.origin_url, s.published_at
       FROM claim_sources cs
       JOIN sources s ON s.id = cs.source_id
       WHERE cs.claim_id = c.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) s ON true
     WHERE c.id = ANY($1::uuid[])`,
    [claimIds]
  );
  const map = new Map<string, OppositionRecord>();
  for (const r of rows) {
    map.set(r.id, { ...r, origin_url: withTimestamp(r.origin_url, r.source_start_seconds) });
  }
  return map;
}
