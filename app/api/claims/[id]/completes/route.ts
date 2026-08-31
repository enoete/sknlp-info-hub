import { NextRequest, NextResponse } from 'next/server';
import { updateCompletesClaim } from '@/app/lib/reviewQueue';
import { ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Internal-only (Review Queue is the sole caller): links this claim to
// the earlier initiative/decision it completes, or unlinks it (pass
// completes_claim_id: null) -- see reviewQueue.ts's updateCompletesClaim
// and schema.sql's completes_claim_id comment.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { completes_claim_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await updateCompletesClaim(params.id, body.completes_claim_id ?? null);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('updateCompletesClaim failed:', err);
    return NextResponse.json({ error: `Could not save completes_claim_id: ${String(err)}` }, { status: 500 });
  }
}
