import { NextRequest, NextResponse } from 'next/server';
import { searchAccomplishmentClaims } from '@/app/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Internal-only: backs the review queue's "this completes an earlier
// claim" picker. GET /api/claims/search?q=...&exclude=<claimId>
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const exclude = req.nextUrl.searchParams.get('exclude') ?? undefined;
  try {
    const results = await searchAccomplishmentClaims(q, exclude);
    return NextResponse.json({ results });
  } catch (err) {
    console.error('searchAccomplishmentClaims failed:', err);
    return NextResponse.json({ error: `Search failed: ${String(err)}` }, { status: 500 });
  }
}
