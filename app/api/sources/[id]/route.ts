import { NextRequest, NextResponse } from 'next/server';
import { updateSourceUrl } from '@/app/lib/reviewQueue';
import { ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Internal-only (Review Queue is the sole caller): replaces a source's
// origin_url. Used to swap a placeholder/generic seed-data link for the
// real per-post permalink once it's found, without touching review_status
// on any claim that cites it.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { origin_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await updateSourceUrl(params.id, body.origin_url ?? '');
    if (!result) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('updateSourceUrl failed:', err);
    return NextResponse.json({ error: `Could not save source URL: ${String(err)}` }, { status: 500 });
  }
}
