import { NextRequest, NextResponse } from 'next/server';
import { submitSuggestion, ModerationError } from '@/app/lib/citizenSuggestions';
import { checkRateLimit, getClientIp, SUGGESTION_LIMITER } from '@/app/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_LENGTH = 500;

// Public, anonymous, unauthenticated -- the IP is used only as an
// in-memory rate-limit key (see rate-limit.ts), never persisted. Nothing
// in citizen_suggestions ties a submission back to who sent it. Uses the
// dedicated, stricter SUGGESTION_LIMITER (3/10min) rather than the
// shared default -- a citizen has no legitimate reason to submit many
// suggestions in quick succession, unlike chat follow-ups.
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req.headers), SUGGESTION_LIMITER);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many submissions, please try again shortly.' }, { status: 429 });
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Suggestion text is required' }, { status: 400 });
  }
  if (text.length > MAX_LENGTH) {
    return NextResponse.json({ error: `Suggestions are limited to ${MAX_LENGTH} characters` }, { status: 400 });
  }

  try {
    const result = await submitSuggestion(text);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ModerationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('submitSuggestion failed:', err);
    return NextResponse.json({ error: 'Could not save suggestion' }, { status: 500 });
  }
}
