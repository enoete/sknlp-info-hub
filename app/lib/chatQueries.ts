import { pool } from './db';

// Never pass an IP address, session id, user agent, or any other
// identity/device signal into this — chat_queries has no column for one
// (see schema.sql), and the Ask the Record UI promises exactly that.
// Logging failure must never break the actual answer being returned, so
// every call site wraps this in .catch(() => {}) rather than awaiting
// it strictly.
export async function logChatQuery(question: string, found: boolean, claimId: string | null): Promise<void> {
  await pool.query(`INSERT INTO chat_queries (question, found, claim_id) VALUES ($1, $2, $3)`, [
    question,
    found,
    claimId
  ]);
}

// Real questions people already asked that led to a genuine answer,
// most-frequent first. Returned verbatim (no LLM rephrasing) — they're
// already natural, human-typed questions, and rephrasing something that
// already worked risks losing the exact wording that made it match.
export async function getMostAskedFoundQuestions(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ question: string }>(
    `SELECT question, count(*) AS cnt
     FROM chat_queries
     WHERE found = true
     GROUP BY question
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.question);
}
