import { NextRequest, NextResponse } from 'next/server';
import { searchApprovedClaims } from '@/app/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Internal-only: backs the review queue's "this completes an earlier
// claim" / "clarify an opposition claim" pickers, and the chat feedback
// log's "link the actually correct claim" picker.
// GET /api/claims/search?q=...&exclude=<claimId>&stance=accomplishment|any
// stance defaults to 'accomplishment' -- the review queue's existing
// callers never pass it and must keep their current (narrower) results.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const exclude = req.nextUrl.searchParams.get('exclude') ?? undefined;
  const stanceParam = req.nextUrl.searchParams.get('stance');
  const stance = stanceParam === 'any' ? 'any' : 'accomplishment';
  try {
    const results = await searchApprovedClaims(q, exclude, stance);
    return NextResponse.json({ results });
  } catch (err) {
    console.error('searchApprovedClaims failed:', err);
    return NextResponse.json({ error: `Search failed: ${String(err)}` }, { status: 500 });
  }
}
