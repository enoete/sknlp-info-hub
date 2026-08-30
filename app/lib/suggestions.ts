import { pool } from './db';
import { retrieve } from './retrieve';

// One deliberately-undocumented example kept in every suggestion set so the
// "no record" path stays demonstrated, not just the happy path. Can't be
// derived from real data by definition — it's testing the absence of it.
// Verified periodically (see getSuggestedQuestions) that it still actually
// returns nothing as the dataset grows, rather than assumed forever.
const NO_RECORD_EXAMPLE = 'Did the government build a new international airport?';

const FALLBACK_QUESTIONS = [
  'Did the minimum wage actually increase?',
  'Is it true crime has doubled since 2022?',
  NO_RECORD_EXAMPLE
];

const CACHE_TTL_MS = 10 * 60 * 1000; // real content changes rarely enough that regenerating every page load is wasted API spend
let cache: { questions: string[]; expiresAt: number } | null = null;

interface SampleClaim {
  title: string;
  category: string | null;
  stance: string;
}

async function sampleClaims(): Promise<SampleClaim[]> {
  const { rows } = await pool.query<SampleClaim>(
    `SELECT title, category, stance FROM claims
     WHERE review_status = 'approved'
     ORDER BY random()
     LIMIT 5`
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

async function phraseAsQuestions(claims: SampleClaim[]): Promise<string[] | null> {
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

// Generates suggestions from real approved claims, then verifies each one
// through the exact same retrieval path /api/ask uses — if an LLM paraphrase
// happens to drop the keyword that would've matched, that slot falls back to
// the claim's own title (guaranteed to match itself) rather than shipping a
// "suggested" question that would ironically return "no record" when clicked.
export async function getSuggestedQuestions(): Promise<string[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.questions;

  const claims = await sampleClaims().catch(() => [] as SampleClaim[]);
  if (claims.length === 0) return FALLBACK_QUESTIONS;

  const phrased = (await phraseAsQuestions(claims)) ?? claims.map((c) => c.title);

  const verified: string[] = [];
  for (let i = 0; i < phrased.length; i++) {
    try {
      const hits = await retrieve(phrased[i]);
      verified.push(hits.length > 0 ? phrased[i] : claims[i].title);
    } catch {
      verified.push(claims[i].title);
    }
  }

  // Re-confirm the no-record example still finds nothing as real content
  // grows — if it now accidentally matches something, drop it rather than
  // ship a "no record" suggestion that would actually return an answer.
  let noRecordExample: string | null = NO_RECORD_EXAMPLE;
  try {
    const hits = await retrieve(NO_RECORD_EXAMPLE);
    if (hits.length > 0) noRecordExample = null;
  } catch {
    noRecordExample = null;
  }

  const finalQuestions = noRecordExample ? [...verified.slice(0, 4), noRecordExample] : verified.slice(0, 5);

  cache = { questions: finalQuestions, expiresAt: now + CACHE_TTL_MS };
  return finalQuestions;
}
