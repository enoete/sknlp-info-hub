import { pool } from './db';
import { CATEGORIES } from './categories';

// Thrown when the moderation gate actively rejects a submission (spam,
// abuse, gibberish, off-topic) -- distinct from a generic failure so
// app/api/suggestions/route.ts can return a specific 422 rather than a
// 500. Never thrown on a transient LLM error; see submitSuggestion.
export class ModerationError extends Error {}

// "Suggest a Priority" — anonymous public suggestion box + admin review
// workflow. See design-reference/source-manager-mockup.html for the pixel
// spec and schema.sql's suggestion_themes/citizen_suggestions/
// suggestion_acknowledgements comment for the full design writeup.
//
// Clustering approach: same two-stage pattern already proven this session
// for claim de-duplication (ingestion/claim_dedup.py) — a cheap pg_trgm
// pre-filter narrows candidates, then one LLM call confirms it's actually
// the same underlying ask before merging into an existing theme. Reused
// here rather than embeddings because there's no embeddings API key
// configured yet (see retrieve.ts's own comment on the same constraint),
// and because the failure mode is identical: text similarity alone isn't
// reliable enough to cluster on by itself — two people can phrase the
// same ask completely differently, and two different asks can share
// surface vocabulary without being the same priority.

export interface SuggestionTheme {
  id: string;
  label: string;
  category: string | null;
  status: 'new' | 'under_consideration';
  mention_count: number;
  created_at: string;
  updated_at: string;
  acknowledgements: SuggestionAcknowledgement[];
  sample_texts: string[];
}

export interface SuggestionAcknowledgement {
  id: string;
  official_name: string;
  comment: string;
  created_at: string;
}

// How many existing themes get an LLM same-theme check per new
// submission. NOT pre-filtered by pg_trgm similarity first, unlike
// claim_dedup.py's pattern -- confirmed live 2026-08-31 that a trigram
// pre-filter is the wrong tool here: claim titles/summaries usually share
// verbatim entity names, project names, or dollar figures, so lexical
// overlap is a decent proxy for "might be the same thing." Two citizens
// paraphrasing the same wish in their own words often share almost no
// literal substrings at all -- a real test run had "We need more job
// programs for young people who just finished school" and "Youth
// unemployment is a real problem, please create more internship
// opportunities" score too low on similarity() to even reach the LLM
// judgment, landing as two separate themes for the same actual ask. Since
// suggestion volume is expected to stay low-to-moderate (same "slow and
// steady" expectation as opposition-side ingestion elsewhere in this
// project), scanning the N most recently active themes directly with the
// LLM is affordable and far more reliable than a lexical pre-filter that
// actively works against this feature's whole purpose (grouping the same
// ask however differently it's worded). Revisit with a real pre-filter
// (or embeddings, once available) if theme count grows large enough that
// this becomes a real cost/latency concern -- not a problem at demo
// scale.
const THEME_SCAN_LIMIT = 15;

// Combines classification with a moderation gate in one call -- decided
// 2026-09-01, prompted directly: "the suggestions back-end will need
// some refining as it could blow up very quick and we need to weed out
// spam, message bombing, etc, and make sure what is presented is
// something that is fitting." Two-in-one rather than a separate call:
// the model already has to read the text to classify it, so judging
// genuineness at the same time costs nothing extra. Fails OPEN on a
// transient API error (see callClaudeTool's null return, handled in
// submitSuggestion below) -- an outage should never make the public
// submission box appear broken; it only actively rejects when the model
// clearly judges the content spam/abusive/gibberish, which is a much
// smaller risk than blocking all legitimate citizen input.
const CLASSIFY_TOOL = {
  name: 'classify_suggestion',
  description: 'Judge whether a citizen submission is a genuine policy suggestion, and if so, classify it by category and produce a short theme label for grouping it with similar suggestions.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_genuine_suggestion: {
        type: 'boolean',
        description:
          'false for spam, advertising/promotional content, gibberish/keyboard-mashing, hate speech or abuse, or text with no discernible connection to a government policy/service/priority. true for any genuine (even vague, even critical) suggestion about what the government should focus on -- do not reject something merely because it is impolite, poorly written, or a complaint rather than a constructive proposal; those are still real citizen input.'
      },
      rejection_reason: {
        type: 'string',
        description: 'Short (under 15 words) reason, only when is_genuine_suggestion is false. Empty string otherwise.'
      },
      category: {
        type: 'string',
        enum: CATEGORIES as unknown as string[],
        description:
          'The single best-fit policy category for this suggestion (only meaningful when is_genuine_suggestion is true). "Energy" means power generation/electricity specifically, not general utilities or telecoms -- internet/broadband access belongs in "Other" (this taxonomy has no dedicated telecom category), not "Energy". Prefer "Other" over forcing a poor fit into an unrelated category.'
      },
      theme_label: {
        type: 'string',
        description:
          'A short, general phrase (2-6 words, Title Case) capturing the underlying priority, not this specific wording -- e.g. "Better public transport" for "we need buses that actually run on time", not a restatement of the exact submission. Only meaningful when is_genuine_suggestion is true.'
      }
    },
    required: ['is_genuine_suggestion', 'rejection_reason', 'category', 'theme_label']
  }
};

const SAME_THEME_TOOL = {
  name: 'judge_same_theme',
  description: 'Judge whether a new citizen suggestion expresses the same SPECIFIC underlying priority as an existing theme.',
  input_schema: {
    type: 'object' as const,
    properties: {
      same_theme: {
        type: 'boolean',
        description:
          'true only if the new suggestion asks for the exact same specific thing as the existing theme (e.g. both specifically about childcare costs, or both specifically about bus routes). false if they only share a general problem area but ask for different specific things -- confirmed real failure mode: "childcare is unaffordable" and "housing is unaffordable" and "groceries are unaffordable" are each a DIFFERENT specific ask even though all three relate to cost of living broadly; do not merge them just because they share that broader theme. Being about the same sector/institution or the same broad complaint is NOT enough -- it must be the same specific request.'
      }
    },
    required: ['same_theme']
  }
};

async function callClaudeTool(system: string, userText: string, tool: typeof CLASSIFY_TOOL | typeof SAME_THEME_TOOL): Promise<any | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-xxxx') return null;

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
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: userText }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const toolUse = (data.content ?? []).find((b: any) => b.type === 'tool_use');
    return toolUse?.input ?? null;
  } catch {
    return null;
  }
}

// The one write path for a new public submission: moderate, classify,
// find or create its theme, insert. The moderation half fails CLOSED
// (rejects) only on an explicit false verdict; a transient LLM failure
// (classification === null) fails OPEN the same as classification always
// has -- a citizen submitting a suggestion should never see an error
// because of an API hiccup, and it still lands in its own new theme
// ungrouped (visible to admins, just not clustered/moderated), never
// silently dropped.
export async function submitSuggestion(text: string): Promise<{ id: string; theme_id: string | null }> {
  const classification = await callClaudeTool(
    'You classify and moderate citizen policy suggestions for a government priorities dashboard. Be concise and literal -- do not editorialize or add commentary.',
    `Citizen suggestion: "${text}"`,
    CLASSIFY_TOOL
  );

  if (classification?.is_genuine_suggestion === false) {
    throw new ModerationError(
      classification.rejection_reason?.trim() || "This doesn't look like a policy suggestion -- please describe what you'd like the government to focus on."
    );
  }
  const category: string | null =
    classification?.category && (CATEGORIES as readonly string[]).includes(classification.category) ? classification.category : null;
  const themeLabel: string = classification?.theme_label?.trim() || text.slice(0, 60);

  const themeId = await findOrCreateTheme(text, themeLabel, category);
  // Bump the matched theme's updated_at so THEME_SCAN_LIMIT's "most
  // recently active first" ordering reflects real activity, not just
  // creation order -- a theme that keeps getting new mentions should
  // keep surfacing early in future same-theme scans.
  if (themeId) await pool.query(`UPDATE suggestion_themes SET updated_at = now() WHERE id = $1`, [themeId]);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO citizen_suggestions (text, category, theme_id) VALUES ($1, $2, $3) RETURNING id`,
    [text, category, themeId]
  );
  return { id: rows[0].id, theme_id: themeId };
}

async function findOrCreateTheme(text: string, themeLabel: string, category: string | null): Promise<string | null> {
  const { rows: candidates } = await pool.query<{ id: string; label: string; sample_text: string }>(
    `SELECT st.id, st.label,
            (SELECT cs.text FROM citizen_suggestions cs WHERE cs.theme_id = st.id ORDER BY cs.submitted_at DESC LIMIT 1) AS sample_text
     FROM suggestion_themes st
     ORDER BY st.updated_at DESC
     LIMIT $1`,
    [THEME_SCAN_LIMIT]
  );

  for (const cand of candidates) {
    const judgment = await callClaudeTool(
      'You judge whether two citizen suggestions are asking for the same SPECIFIC government priority, even if worded very differently -- not merely the same general problem area (see the tool description for what counts as too broad).',
      `Existing theme: "${cand.label}" (example submission: "${cand.sample_text}")\n\nNew suggestion: "${text}"\n\nIs the new suggestion asking for the same underlying priority as the existing theme?`,
      SAME_THEME_TOOL
    );
    if (judgment?.same_theme === true) return cand.id;
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO suggestion_themes (label, category) VALUES ($1, $2) RETURNING id`,
    [themeLabel, category]
  );
  return rows[0].id;
}

// Admin "Trending Suggestions" view — every theme, ranked by mention
// count (the "most pressing" signal the client asked for), with its full
// acknowledgement history and a few sample raw submissions so an admin
// can read actual citizen wording, not just the AI-generated label.
export async function getSuggestionThemes(): Promise<SuggestionTheme[]> {
  const { rows: themes } = await pool.query<{
    id: string;
    label: string;
    category: string | null;
    status: 'new' | 'under_consideration';
    created_at: string;
    updated_at: string;
    mention_count: string;
  }>(
    `SELECT st.id, st.label, st.category, st.status,
            to_char(st.created_at, 'YYYY-MM-DD') AS created_at,
            to_char(st.updated_at, 'YYYY-MM-DD') AS updated_at,
            (SELECT count(*) FROM citizen_suggestions cs WHERE cs.theme_id = st.id) AS mention_count
     FROM suggestion_themes st
     ORDER BY mention_count DESC, st.created_at DESC`
  );

  if (themes.length === 0) return [];

  const { rows: acks } = await pool.query<{ theme_id: string; id: string; official_name: string; comment: string; created_at: string }>(
    `SELECT theme_id, id, official_name, comment, to_char(created_at, 'YYYY-MM-DD') AS created_at
     FROM suggestion_acknowledgements ORDER BY created_at DESC`
  );
  const { rows: samples } = await pool.query<{ theme_id: string; text: string }>(
    `SELECT theme_id, text FROM (
       SELECT theme_id, text, row_number() OVER (PARTITION BY theme_id ORDER BY submitted_at DESC) AS rn
       FROM citizen_suggestions WHERE theme_id IS NOT NULL
     ) x WHERE rn <= 3`
  );

  const acksByTheme = new Map<string, SuggestionAcknowledgement[]>();
  for (const a of acks) {
    const list = acksByTheme.get(a.theme_id) ?? [];
    list.push({ id: a.id, official_name: a.official_name, comment: a.comment, created_at: a.created_at });
    acksByTheme.set(a.theme_id, list);
  }
  const samplesByTheme = new Map<string, string[]>();
  for (const s of samples) {
    const list = samplesByTheme.get(s.theme_id) ?? [];
    list.push(s.text);
    samplesByTheme.set(s.theme_id, list);
  }

  return themes.map((t) => ({
    ...t,
    mention_count: Number(t.mention_count),
    acknowledgements: acksByTheme.get(t.id) ?? [],
    sample_texts: samplesByTheme.get(t.id) ?? []
  }));
}

// The one official action: acknowledge a theme with a comment, which logs
// an append-only acknowledgement row and flips the theme to
// 'under_consideration' (never back to 'new' -- once flagged for
// consideration, it stays flagged even if a later comment is added).
export async function acknowledgeTheme(themeId: string, officialName: string, comment: string): Promise<void> {
  // pool.query() can hand sequential calls to different pooled
  // connections, so BEGIN/COMMIT only actually wrap the statements
  // between them if run on one checked-out client -- pool.connect() is
  // required here, not pool.query() three times in a row.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO suggestion_acknowledgements (theme_id, official_name, comment) VALUES ($1, $2, $3)`,
      [themeId, officialName, comment]
    );
    await client.query(`UPDATE suggestion_themes SET status = 'under_consideration', updated_at = now() WHERE id = $1`, [themeId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
