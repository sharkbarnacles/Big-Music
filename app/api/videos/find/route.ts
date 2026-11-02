import { NextResponse, type NextRequest } from 'next/server';
import { findVideosWithSearch } from '@/lib/videos';

export const maxDuration = 300;

// POST /api/videos/find?limit=40 → checks up to 40 songs with official YouTube search.
export async function POST(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 40, 1), 90);
  try {
    return NextResponse.json(await findVideosWithSearch(limit));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
