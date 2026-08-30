import { NextRequest, NextResponse } from 'next/server';
import { createSource, ValidationError } from '@/app/lib/sourceManager';

export const dynamic = 'force-dynamic';

// Stage 2 of the Source Manager: writes a new sources_registry row only.
// No "run now" (Stage 4) and no source_attachments/proof_documents writes
// (those come once one-off content upload is actually built) — this is
// purely "register the source," matching the scope in CLAUDE.md.
export async function POST(req: NextRequest) {
  let body: { type?: string; sourceType?: string; label?: string; urlOrHandle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { id } = await createSource({
      type: body.type ?? '',
      sourceType: body.sourceType ?? '',
      label: body.label ?? '',
      urlOrHandle: body.urlOrHandle ?? ''
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Covers a real Postgres enum mismatch (invalid_text_representation,
    // 22P02) among other DB failures — never let a raw stack trace back
    // to the client, but don't swallow the cause server-side either.
    console.error('createSource failed:', err);
    return NextResponse.json({ error: `Could not save source: ${String(err)}` }, { status: 500 });
  }
}
