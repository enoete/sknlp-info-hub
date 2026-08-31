import { NextRequest, NextResponse } from 'next/server';
import { approveClaim, rejectClaim, unapproveClaim } from '@/app/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Review queue actions: approve (review_status -> approved, plus the
// one-time citizen_impact_suggested/event_date_suggested -> real column
// copy), reject (review_status -> rejected), or unapprove (full
// retraction: review_status back to pending_review AND citizen_impact/
// event_date cleared — see unapproveClaim's own comment). Every action is
// guarded server-side to only affect a claim in the expected starting
// status, so a stale/double click is a no-op, not a silent re-decision.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'approve') {
    const result = await approveClaim(params.id);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found or no longer pending review' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === 'reject') {
    const result = await rejectClaim(params.id);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found or no longer pending review' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === 'unapprove') {
    const result = await unapproveClaim(params.id);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found or not currently approved' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "action must be 'approve', 'reject', or 'unapprove'" }, { status: 400 });
}
