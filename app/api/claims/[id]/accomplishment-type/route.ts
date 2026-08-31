import { NextRequest, NextResponse } from 'next/server';
import { updateAccomplishmentType } from '@/app/lib/reviewQueue';
import { ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Internal-only (Review Queue is the sole caller): lets an admin correct
// the ingestion agent's accomplishment_type call on a claim in any
// review_status -- see reviewQueue.ts's updateAccomplishmentType comment.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { accomplishment_type?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await updateAccomplishmentType(params.id, body.accomplishment_type ?? null);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('updateAccomplishmentType failed:', err);
    return NextResponse.json({ error: `Could not save accomplishment_type: ${String(err)}` }, { status: 500 });
  }
}
