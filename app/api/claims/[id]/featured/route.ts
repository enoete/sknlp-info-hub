import { NextRequest, NextResponse } from 'next/server';
import { updateFeatured } from '@/app/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Internal-only (Review Queue is the sole caller): toggles whether an
// approved claim shows up in the curated Dashboard/Timeline views --
// see reviewQueue.ts's updateFeatured comment. Never touches
// review_status/retrieval.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { featured?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.featured !== 'boolean') {
    return NextResponse.json({ error: 'featured must be a boolean' }, { status: 400 });
  }

  try {
    const result = await updateFeatured(params.id, body.featured);
    if (!result) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('updateFeatured failed:', err);
    return NextResponse.json({ error: `Could not save featured: ${String(err)}` }, { status: 500 });
  }
}
