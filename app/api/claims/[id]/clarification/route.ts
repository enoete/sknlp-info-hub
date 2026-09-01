import { NextRequest, NextResponse } from 'next/server';
import { updateManualClarification, updateManualClarificationText } from '@/app/lib/reviewQueue';
import { ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Internal-only (Review Queue is the sole caller). Two mutually exclusive
// bodies, matching the two clarification mechanisms in schema.sql:
// { manual_clarification_id } links (or, with null, unlinks) an existing
// accomplishment claim -- see updateManualClarification. Any other body
// is treated as the free-text path -- { manual_clarification_title,
// manual_clarification_text, manual_clarification_url }, all null to
// clear -- see updateManualClarificationText.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: {
    manual_clarification_id?: string | null;
    manual_clarification_title?: string | null;
    manual_clarification_text?: string | null;
    manual_clarification_url?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if ('manual_clarification_id' in body) {
      const result = await updateManualClarification(params.id, body.manual_clarification_id ?? null);
      if (!result) {
        return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await updateManualClarificationText(
      params.id,
      body.manual_clarification_title ?? null,
      body.manual_clarification_text ?? null,
      body.manual_clarification_url ?? null
    );
    if (!result) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('updateManualClarification failed:', err);
    return NextResponse.json({ error: `Could not save clarification: ${String(err)}` }, { status: 500 });
  }
}
