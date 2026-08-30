import { pool } from './db';
import { retrieve } from './retrieve';
import { getMostAskedFoundQuestions } from './chatQueries';

// Last-resort only — used when there's truly nothing to build starting
// suggestions from yet (empty chat_queries AND no opposition claims), not
// mixed in alongside real ones. Includes one deliberate no-record example
// so a brand-new deployment still demonstrates that path once.
const FALLBACK_QUESTIONS = [
  'Did the minimum wage actually increase?',
  'Did the government build a new international airport?'
];

const CACHE_TTL_MS = 10 * 60 * 1000; // real content changes rarely enough that regenerating every page load is wasted API spend
const MOST_ASKED_LIMIT = 4;
let cache: { questions: string[]; expiresAt: number } | null = null;

export interface SampleClaim {
  title: string;
  category: string | null;
  stance: string;
}

// Source (b) for getSuggestedQuestions: one live/recent Opposition Watch
// claim. "Recent" = most recent by the date the event actually happened,
// falling back to when it was added if that's unset.
async function sampleRecentOppositionClaim(): Promise<SampleClaim[]> {
  const { rows } = await pool.query<SampleClaim>(
    `SELECT title, category, stance FROM claims
     WHERE review_status = 'approved' AND stance = 'opposition_statement'
     ORDER BY event_date DESC NULLS LAST, created_at DESC
     LIMIT 1`
  );
  return rows;
}

const SUGGESTION_TOOL = {
  name: 'suggest_questions',
  description:
    'Rephrase each provided claim as a natural, conversational question a curious or skeptical citizen might type — not a restatement of the claim title.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exactly one question per input claim, same order, same count as the input list.'
      }
    },
    required: ['questions']
  }
};

export async function phraseAsQuestions(claims: SampleClaim[]): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-xxxx') return null;

  const claimList = claims.map((c, i) => `${i + 1}. [${c.category ?? 'General'}] ${c.title}`).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 512,
        system:
          'You write short, natural questions a person might type into a fact-check tool after hearing a rumor or claim. Never invent facts, numbers, or details beyond what is given.',
        messages: [
          {
            role: 'user',
            content: `Here are ${claims.length} documented claims. Write one natural, conversational question per claim that someone might ask to verify it, under 14 words each. Keep at least one distinctive word, name, or number from the claim in your question (a program name, a dollar figure, a place) so it stays specific and findable — don't paraphrase away everything concrete.\n\n${claimList}`
          }
        ],
        tools: [SUGGESTION_TOOL],
        tool_choice: { type: 'tool', name: 'suggest_questions' }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const toolUse = (data.content ?? []).find((b: any) => b.type === 'tool_use');
    const questions = toolUse?.input?.questions;
    if (!Array.isArray(questions) || questions.length !== claims.length) return null;
    return questions;
  } catch {
    return null;
  }
}

// Verifies each phrased question through the exact same retrieval path
// /api/ask uses — if an LLM paraphrase happens to drop the keyword that
// would've matched, that slot falls back to the claim's own title
// (guaranteed to match itself) rather than shipping a "suggested" question
// that would ironically return "no record" when clicked. Shared by the
// starting-suggestions path below and the per-answer follow-up path
// (getFollowUpQuestions) — same reliability bar in both places.
export async function verifyPhrasedQuestions(phrased: string[], claims: SampleClaim[]): Promise<string[]> {
  const verified: string[] = [];
  for (let i = 0; i < phrased.length; i++) {
    try {
      const hits = await retrieve(phrased[i]);
      verified.push(hits.length > 0 ? phrased[i] : claims[i].title);
    } catch {
      verified.push(claims[i].title);
    }
  }
  return verified;
}

// Starting suggestions, shown before any question is asked. Mixes two real
// sources rather than picking one exclusively:
//  (a) the most-asked questions in chat_queries that actually led to a
//      found=true answer — shown verbatim, re-verified against retrieve()
//      here since DB content can drift after a question was first logged
//      (a claim could be unapproved later); anything that no longer
//      retrieves is dropped, not kept on faith.
//  (b) one live/recent Opposition Watch claim, phrased as a question and
//      verified the same way every other generated suggestion is.
// Falls back to a static list only if both sources are genuinely empty
// (e.g. a brand-new deployment with no chat history yet) — never padded
// with anything not actually traceable to (a) or (b).
export async function getSuggestedQuestions(): Promise<string[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.questions;

  const mostAsked = await getMostAskedFoundQuestions(MOST_ASKED_LIMIT).catch(() => [] as string[]);
  const verifiedMostAsked: string[] = [];
  for (const q of mostAsked) {
    try {
      const hits = await retrieve(q);
      if (hits.length > 0) verifiedMostAsked.push(q);
    } catch {
      // drop rather than risk shipping a starter that now leads nowhere
    }
  }

  const oppositionClaims = await sampleRecentOppositionClaim().catch(() => [] as SampleClaim[]);
  let oppositionQuestion: string[] = [];
  if (oppositionClaims.length > 0) {
    const phrased = (await phraseAsQuestions(oppositionClaims)) ?? oppositionClaims.map((c) => c.title);
    oppositionQuestion = await verifyPhrasedQuestions(phrased, oppositionClaims);
  }

  const combined = Array.from(new Set([...verifiedMostAsked, ...oppositionQuestion])).slice(0, 5);
  const finalQuestions = combined.length > 0 ? combined : FALLBACK_QUESTIONS;

  cache = { questions: finalQuestions, expiresAt: now + CACHE_TTL_MS };
  return finalQuestions;
}

// Follow-up suggestions shown after an answered question: 2-3 real
// questions drawn from OTHER approved claims sharing the just-cited
// claim's category. No category, or no other claims in it, means no
// follow-ups — returns [] rather than inventing something not actually
// in the database (the client keeps whatever suggestions were already
// showing in that case; see ChatClient.tsx).
export async function getFollowUpQuestions(excludeClaimId: string, category: string | null): Promise<string[]> {
  if (!category) return [];

  const { rows: claims } = await pool.query<SampleClaim>(
    `SELECT title, category, stance FROM claims
     WHERE review_status = 'approved' AND category = $1 AND id != $2
     ORDER BY random()
     LIMIT 3`,
    [category, excludeClaimId]
  );
  if (claims.length === 0) return [];

  const phrased = (await phraseAsQuestions(claims)) ?? claims.map((c) => c.title);
  return verifyPhrasedQuestions(phrased, claims);
}
