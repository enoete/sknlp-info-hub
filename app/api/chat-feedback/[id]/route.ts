import { NextRequest, NextResponse } from 'next/server';
import {
  submitChatFeedback,
  linkChatFeedbackClaim,
  writeChatFeedbackCorrection
} from '@/app/lib/chatQueries';
import { ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Internal-only (the /chat-feedback admin page is the sole caller).
// Three mutually-distinct bodies, matching the three things an admin can
// do to one logged question — see app/lib/chatQueries.ts for the
// mechanics of each:
//  { feedback_rating, feedback_context?, feedback_reviewed_by? } — rate
//    how well the bot answered, optionally leaving a search-guidance note.
//  { feedback_claim_id } — link (or, with null, unlink) the actually-
//    correct claim found via search.
//  { feedback_correction_title, feedback_correction_text, feedback_correction_url }
//    — write the correct answer directly when no existing claim covers
//    it (all null/empty to clear).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: {
    feedback_rating?: string | null;
    feedback_context?: string | null;
    feedback_reviewed_by?: string | null;
    feedback_claim_id?: string | null;
    feedback_correction_title?: string | null;
    feedback_correction_text?: string | null;
    feedback_correction_url?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if ('feedback_rating' in body) {
      const result = await submitChatFeedback(
        params.id,
        body.feedback_rating ?? null,
        body.feedback_context ?? null,
        body.feedback_reviewed_by ?? null
      );
      if (!result) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
      return NextResponse.json({ ok: true, ...result });
    }

    if ('feedback_claim_id' in body) {
      const result = await linkChatFeedbackClaim(params.id, body.feedback_claim_id ?? null);
      if (!result) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await writeChatFeedbackCorrection(
      params.id,
      body.feedback_correction_title ?? null,
      body.feedback_correction_text ?? null,
      body.feedback_correction_url ?? null
    );
    if (!result) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('chat feedback update failed:', err);
    return NextResponse.json({ error: `Could not save feedback: ${String(err)}` }, { status: 500 });
  }
}
