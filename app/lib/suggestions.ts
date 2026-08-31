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
const MOST_ASKED_POOL_SIZE = 10; // wide eligible pool to sample 1-2 from per load, not a fixed top-N
const OPPOSITION_POOL_SIZE = 5;  // ditto, scoped smaller since opposition claims are rarer
const RECENT_ACCOMPLISHMENT_POOL_SIZE = 5; // newest accomplishments — guarantees fresh ingestion surfaces here even before anyone's asked about it (mostAskedPool can't see it yet, and it isn't opposition-stance)
let poolCache: {
  mostAskedPool: string[];
  oppositionPool: string[];
  recentAccomplishmentPool: string[];
  expiresAt: number;
} | null = null;

export interface SampleClaim {
  title: string;
  category: string | null;
  stance: string;
}

function sampleN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Pool for source (b) below: the N most recent Opposition Watch claims
// (not just the single most recent), so getSuggestedQuestions has real
// candidates to randomly pick from rather than always the same one.
async function sampleRecentOppositionClaims(limit: number): Promise<SampleClaim[]> {
  const { rows } = await pool.query<SampleClaim>(
    `SELECT title, category, stance FROM claims
     WHERE review_status = 'approved' AND stance = 'opposition_statement'
     ORDER BY event_date DESC NULLS LAST, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// Mirrors sampleRecentOppositionClaims above, for the accomplishment side —
// ordered by created_at (not event_date) so a claim ingested today surfaces
// here immediately even if its event_date is older than other approved
// claims (the point is "recently added to the record", not "recently
// happened").
async function sampleRecentAccomplishmentClaims(limit: number): Promise<SampleClaim[]> {
  const { rows } = await pool.query<SampleClaim>(
    `SELECT title, category, stance FROM claims
     WHERE review_status = 'approved' AND stance = 'accomplishment'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
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

// Builds (and caches for CACHE_TTL_MS) the three ELIGIBLE POOLS that starting
// suggestions sample from. This is the expensive part — DB queries, an LLM
// phrasing call for the opposition pool, and per-item retrieve() verification
// — so it's cached like the old single-answer cache was. The difference is
// what's cached: a pool of several verified candidates, not one final
// answer, so the random selection below can vary on every page load without
// re-doing any of this work.
async function getPools(): Promise<{
  mostAskedPool: string[];
  oppositionPool: string[];
  recentAccomplishmentPool: string[];
}> {
  const now = Date.now();
  if (poolCache && poolCache.expiresAt > now) {
    return {
      mostAskedPool: poolCache.mostAskedPool,
      oppositionPool: poolCache.oppositionPool,
      recentAccomplishmentPool: poolCache.recentAccomplishmentPool
    };
  }

  // (a) a wide pool of real past questions that led to a found=true answer,
  // re-verified against retrieve() here since DB content can drift after a
  // question was first logged (a claim could be unapproved later).
  const mostAskedRaw = await getMostAskedFoundQuestions(MOST_ASKED_POOL_SIZE).catch(() => [] as string[]);
  const mostAskedPool: string[] = [];
  for (const q of mostAskedRaw) {
    try {
      const hits = await retrieve(q);
      if (hits.length > 0) mostAskedPool.push(q);
    } catch {
      // drop rather than risk shipping a starter that now leads nowhere
    }
  }

  // (b) a pool of recent Opposition Watch claims, phrased and verified the
  // same way every other generated suggestion is.
  const oppositionClaims = await sampleRecentOppositionClaims(OPPOSITION_POOL_SIZE).catch(() => [] as SampleClaim[]);
  let oppositionPool: string[] = [];
  if (oppositionClaims.length > 0) {
    const phrased = (await phraseAsQuestions(oppositionClaims)) ?? oppositionClaims.map((c) => c.title);
    oppositionPool = await verifyPhrasedQuestions(phrased, oppositionClaims);
  }

  // (c) a pool of the most recently ingested accomplishment claims, phrased
  // and verified the same way — without this, a brand-new accomplishment
  // claim (the common case; opposition claims are rare) has no path into
  // starting suggestions until someone happens to ask about it first and
  // that gets logged into chat_queries. This is what actually gets fresh
  // ingestion runs surfaced here on the next page load.
  const recentAccomplishmentClaims = await sampleRecentAccomplishmentClaims(RECENT_ACCOMPLISHMENT_POOL_SIZE).catch(
    () => [] as SampleClaim[]
  );
  let recentAccomplishmentPool: string[] = [];
  if (recentAccomplishmentClaims.length > 0) {
    const phrased = (await phraseAsQuestions(recentAccomplishmentClaims)) ?? recentAccomplishmentClaims.map((c) => c.title);
    recentAccomplishmentPool = await verifyPhrasedQuestions(phrased, recentAccomplishmentClaims);
  }

  poolCache = { mostAskedPool, oppositionPool, recentAccomplishmentPool, expiresAt: now + CACHE_TTL_MS };
  return { mostAskedPool, oppositionPool, recentAccomplishmentPool };
}

// Starting suggestions, shown before any question is asked. Mixes two real
// sources rather than picking one exclusively, and — unlike the pools
// above — samples fresh on every call so the same visitor reloading the
// page, or two different visitors in the same 10-minute cache window, see
// varying suggestions rather than one fixed set every time:
//  (a) 1-2 questions randomly sampled from the most-asked-and-found pool.
//  (b) 1 question randomly sampled from the recent-opposition-claim pool.
//  (c) 1 question randomly sampled from the recent-accomplishment-claim pool.
// Falls back to a static list only if all pools are genuinely empty
// (e.g. a brand-new deployment with no chat history yet) — never padded
// with anything not actually traceable to (a), (b), or (c).
export async function getSuggestedQuestions(): Promise<string[]> {
  const { mostAskedPool, oppositionPool, recentAccomplishmentPool } = await getPools();

  if (mostAskedPool.length === 0 && oppositionPool.length === 0 && recentAccomplishmentPool.length === 0) {
    return FALLBACK_QUESTIONS;
  }

  const mostAskedCount = mostAskedPool.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : mostAskedPool.length;
  const pickedMostAsked = sampleN(mostAskedPool, mostAskedCount);
  const pickedOpposition = sampleN(oppositionPool, Math.min(1, oppositionPool.length));
  const pickedRecentAccomplishment = sampleN(recentAccomplishmentPool, Math.min(1, recentAccomplishmentPool.length));

  const combined = Array.from(new Set([...pickedMostAsked, ...pickedOpposition, ...pickedRecentAccomplishment])).slice(
    0,
    5
  );
  return combined.length > 0 ? combined : FALLBACK_QUESTIONS;
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
