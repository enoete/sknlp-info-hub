import { NextResponse } from 'next/server';
import { getSuggestionThemes } from '@/app/lib/citizenSuggestions';

export const dynamic = 'force-dynamic';

// Internal-only (Trending Suggestions admin panel is the sole caller).
export async function GET() {
  try {
    const themes = await getSuggestionThemes();
    return NextResponse.json({ themes });
  } catch (err) {
    console.error('getSuggestionThemes failed:', err);
    return NextResponse.json({ error: 'Could not load suggestion themes' }, { status: 500 });
  }
}
