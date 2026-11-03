import { NextResponse, type NextRequest } from 'next/server';
import { parseTrackQuery } from '@/lib/libraryParams';
import { loadTracks } from '@/lib/libraryQuery';

export const dynamic = 'force-dynamic';

// GET /api/library/tracks?q=&videos=1&both=1&artist=&sort=&seed=&offset=&limit=
// One page of songs (used when scrolling and by the player).
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(qs.get('offset')) || 0);
  const limit = Math.min(500, Math.max(1, Number(qs.get('limit')) || 200));
  const result = await loadTracks(parseTrackQuery(qs), offset, limit, qs.get('seed') || null);
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}
