import { pool } from './db';
import { ValidationError } from './sourceManager';

// Never pass an IP address, session id, user agent, or any other
// identity/device signal into this — chat_queries has no column for one
// (see schema.sql), and the Ask the Record UI promises exactly that.
// Logging failure must never break the actual answer being returned, so
// every call site wraps this in .catch(() => {}) rather than awaiting
// it strictly. isSuggestion records whether this question came from
// clicking a pre-filled suggestion pill vs. being typed — see
// getMostClickedSuggestions below, the reason this exists. answerText is
// the exact text the visitor actually saw (answer.summary, or the
// no-record message) — see schema.sql's column comment for why this is
// captured verbatim here rather than derived later from claimId.
export async function logChatQuery(
  question: string,
  found: boolean,
  claimId: string | null,
  isSuggestion: boolean,
  answerText: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_queries (question, found, claim_id, is_suggestion, answer_text) VALUES ($1, $2, $3, $4, $5)`,
    [question, found, claimId, isSuggestion, answerText]
  );
}

// Real questions people already asked that led to a genuine answer,
// most-frequent first. Returned verbatim (no LLM rephrasing) — they're
// already natural, human-typed questions, and rephrasing something that
// already worked risks losing the exact wording that made it match.
//
// Filtered to rows that actually end in '?': before suggestions.ts always
// wrapped its fallback in a question shape, a bare claim title (e.g.
// "Minimum wage increased EC$360 -> EC$500/week") could get served as a
// "suggestion", get clicked, and log itself here as if it were a genuine
// asked question — then keep resurfacing forever since this table is
// append-only and never rewritten. The '?' check keeps that old
// contamination (and any future path that logs a non-question the same
// way) from ever being selected as a "most asked" starter, without having
// to touch the historical rows themselves.
export async function getMostAskedFoundQuestions(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ question: string }>(
    `SELECT question, count(*) AS cnt
     FROM chat_queries
     WHERE found = true AND question ~ '\?\s*$'
     GROUP BY question
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.question);
}

// ------------------------------------------------------------
// ADMIN ANSWER-QUALITY FEEDBACK LOOP (decided 2026-09-04). See
// CLAUDE.md's "Chatbot answer-quality feedback loop" section and
// app/chat-feedback/.
// ------------------------------------------------------------

export const FEEDBACK_RATINGS = ['not_answered', 'partially_answered', 'fully_answered'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export interface ChatQueryLogRow {
  id: string;
  question: string;
  found: boolean;
  answer_text: string | null;
  is_suggestion: boolean;
  claim_id: string | null;
  claim_title: string | null;
  claim_stance: string | null;
  feedback_rating: FeedbackRating | null;
  feedback_context: string | null;
  feedback_claim_id: string | null;
  feedback_claim_title: string | null;
  feedback_correction_title: string | null;
  feedback_correction_text: string | null;
  feedback_correction_url: string | null;
  feedback_reviewed_at: string | null;
  feedback_reviewed_by: string | null;
  created_at: string;
}

const LOG_LIMIT = 300;

// Most recent first, capped so the admin page never has to render the
// entire history at once — 300 is generous for a demo-stage volume and
// cheap to raise later if it isn't. Joins in both the claim the bot
// actually cited (what a live visitor saw) and the admin's own
// corrected/linked claim (if a review already happened), so a repeat
// visit to this page shows the prior verdict rather than a blank form.
export async function getChatQueryLog(): Promise<ChatQueryLogRow[]> {
  const { rows } = await pool.query<ChatQueryLogRow>(
    `SELECT q.id, q.question, q.found, q.answer_text, q.is_suggestion, q.claim_id,
            c.title AS claim_title, c.stance AS claim_stance,
            q.feedback_rating, q.feedback_context,
            q.feedback_claim_id, fc.title AS feedback_claim_title,
            q.feedback_correction_title, q.feedback_correction_text, q.feedback_correction_url,
            to_char(q.feedback_reviewed_at, 'YYYY-MM-DD HH24:MI') AS feedback_reviewed_at,
            q.feedback_reviewed_by,
            to_char(q.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
     FROM chat_queries q
     LEFT JOIN claims c ON c.id = q.claim_id
     LEFT JOIN claims fc ON fc.id = q.feedback_claim_id
     ORDER BY q.created_at DESC
     LIMIT $1`,
    [LOG_LIMIT]
  );
  return rows;
}

export interface MostClickedSuggestion {
  question: string;
  click_count: number;
}

// The page always asks for exactly this many -- a shared constant (not
// two places quietly agreeing on the number 10) so the panel's own
// title stays honest if this is ever changed. This is a display cap
// only: the query below still aggregates every is_suggestion=true row
// to rank them (backed by idx_chat_queries_suggestion_question, a
// partial index scoped to exactly those rows), it just only returns the
// top MOST_CLICKED_LIMIT — the panel never grows past this regardless
// of how many total questions accumulate in chat_queries.
export const MOST_CLICKED_LIMIT = 10;

// "Which pre-filled questions get clicked the most" — grouped on the
// exact question text, since a suggestion pill's label IS the question
// that gets logged when clicked (see ChatClient.tsx's ask()).
export async function getMostClickedSuggestions(limit: number): Promise<MostClickedSuggestion[]> {
  const { rows } = await pool.query<MostClickedSuggestion>(
    `SELECT question, count(*)::int AS click_count
     FROM chat_queries
     WHERE is_suggestion = true
     GROUP BY question
     ORDER BY click_count DESC, max(created_at) DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// Sets/clears the rating + admin's free-text search-guidance note +
// reviewer name in one call — the three fields an admin fills in
// together on the rating card, distinct from linking/writing a
// correction below (a separate action, not always taken in the same
// pass — e.g. rating alone is enough for "fully_answered").
export async function submitChatFeedback(
  id: string,
  rating: string | null,
  context: string | null,
  reviewedBy: string | null
): Promise<{ id: string; feedback_rating: FeedbackRating | null } | null> {
  if (rating !== null && !(FEEDBACK_RATINGS as readonly string[]).includes(rating)) {
    throw new ValidationError(`feedback_rating must be one of: ${FEEDBACK_RATINGS.join(', ')}`);
  }
  const { rows } = await pool.query<{ id: string; feedback_rating: FeedbackRating | null }>(
    `UPDATE chat_queries
     SET feedback_rating = $2,
         feedback_context = $3,
         feedback_reviewed_by = $4,
         feedback_reviewed_at = now()
     WHERE id = $1
     RETURNING id, feedback_rating`,
    [id, rating, context || null, reviewedBy || null]
  );
  return rows[0] ?? null;
}

// Links the actually-correct claim an admin found via search — pass
// null to unlink. Clears feedback_correction_* (mutually exclusive, same
// CASE pattern as reviewQueue.ts's updateManualClarification, and for
// the same reason: a linked real claim and an admin's own written
// answer are two different mechanisms for the same slot, never both at
// once).
export async function linkChatFeedbackClaim(
  id: string,
  claimId: string | null
): Promise<{ id: string; feedback_claim_id: string | null } | null> {
  const { rows } = await pool.query<{ id: string; feedback_claim_id: string | null }>(
    `UPDATE chat_queries
     SET feedback_claim_id = $2,
         feedback_correction_title = CASE WHEN $2::uuid IS NULL THEN feedback_correction_title ELSE NULL END,
         feedback_correction_text  = CASE WHEN $2::uuid IS NULL THEN feedback_correction_text  ELSE NULL END,
         feedback_correction_url   = CASE WHEN $2::uuid IS NULL THEN feedback_correction_url   ELSE NULL END,
         feedback_reviewed_at = now()
     WHERE id = $1
     RETURNING id, feedback_claim_id`,
    [id, claimId]
  );
  return rows[0] ?? null;
}

export interface ChatFeedbackCorrection {
  id: string;
  feedback_correction_title: string | null;
  feedback_correction_text: string | null;
  feedback_correction_url: string | null;
}

// The lighter-weight path when a search turns up nothing worth linking —
// same posture as claims.manual_clarification_title/_text/_url (see
// reviewQueue.ts's updateManualClarificationText and its comment): still
// citation-gated at the application layer, url required whenever
// title/text are non-empty, never a bare unsourced correction. Pass all
// three null/empty to clear. Clears feedback_claim_id — the two
// mechanisms are mutually exclusive.
export async function writeChatFeedbackCorrection(
  id: string,
  title: string | null,
  text: string | null,
  url: string | null
): Promise<ChatFeedbackCorrection | null> {
  const hasContent = !!(title || text || url);
  if (hasContent && !url) {
    throw new ValidationError('A source URL is required for a written correction — never store an unsourced answer');
  }
  const { rows } = await pool.query<ChatFeedbackCorrection>(
    `UPDATE chat_queries
     SET feedback_claim_id = NULL,
         feedback_correction_title = $2,
         feedback_correction_text = $3,
         feedback_correction_url = $4,
         feedback_reviewed_at = now()
     WHERE id = $1
     RETURNING id, feedback_correction_title, feedback_correction_text, feedback_correction_url`,
    [id, title || null, text || null, url || null]
  );
  return rows[0] ?? null;
}

// Feeds an admin's feedback_context note back into retrieval for a
// future similarly-worded question — see /api/ask/route.ts, which
// appends this to the text actually sent to retrieve() (never to what's
// shown to the model as "the question", so this can only broaden what
// gets searched, never change what the citizen is told they asked).
// Uses pg_trgm similarity rather than an LLM call — this sits in the hot
// path on EVERY question, unlike the one-time admin review that wrote
// the hint, so it needs to be cheap. Known gap, not hidden: two citizens
// rarely phrase the same missed topic identically, so this only reliably
// catches a near-identical re-ask, not a true paraphrase — an LLM-based
// semantic match would catch more but adds real latency/cost to every
// single question asked, not just the ones with a hint available.
// Revisit if admin-curated hints accumulate and paraphrase-misses turn
// out to be common in practice.
const HINT_MIN_SIMILARITY = 0.4;

export async function getAdminSearchHint(question: string): Promise<string | null> {
  const { rows } = await pool.query<{ feedback_context: string }>(
    `SELECT feedback_context
     FROM chat_queries
     WHERE feedback_context IS NOT NULL AND feedback_context != ''
       AND similarity(question, $1) >= $2
     ORDER BY similarity(question, $1) DESC, feedback_reviewed_at DESC NULLS LAST
     LIMIT 1`,
    [question, HINT_MIN_SIMILARITY]
  );
  return rows[0]?.feedback_context ?? null;
}
