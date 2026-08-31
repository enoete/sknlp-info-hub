import { NextRequest, NextResponse } from 'next/server';
import { approveClaim, rejectClaim } from '@/app/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Minimal review queue actions: approve (review_status -> approved, plus
// the one-time citizen_impact_suggested/event_date_suggested -> real
// column copy — see approveClaim's own comment) or reject (review_status
// -> rejected). Nothing else. Both are guarded server-side to only affect
// a claim still at pending_review, so a stale/double click is a no-op,
// not a silent re-decision.
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

  return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
}
