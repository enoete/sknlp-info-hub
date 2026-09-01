import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeTheme } from '@/app/lib/citizenSuggestions';

export const dynamic = 'force-dynamic';

// Internal-only. The one official action in the workflow: acknowledge a
// theme with a comment, logged append-only and flipping the theme to
// 'under_consideration' -- see citizenSuggestions.ts's acknowledgeTheme.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { official_name?: string; comment?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const officialName = (body.official_name ?? '').trim();
  const comment = (body.comment ?? '').trim();
  if (!officialName || !comment) {
    return NextResponse.json({ error: 'official_name and comment are both required' }, { status: 400 });
  }

  try {
    await acknowledgeTheme(params.id, officialName, comment);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('acknowledgeTheme failed:', err);
    return NextResponse.json({ error: 'Could not save acknowledgement' }, { status: 500 });
  }
}
