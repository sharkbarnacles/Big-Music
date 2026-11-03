import { NextResponse, type NextRequest } from 'next/server';
import { loadArtists } from '@/lib/libraryQuery';

export const dynamic = 'force-dynamic';

// GET /api/library/artists?q=&sort=name&offset= — one page of artists.
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(qs.get('offset')) || 0);
  const result = await loadArtists(qs.get('q') ?? '', qs.get('sort') === 'name', offset, 200);
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}
