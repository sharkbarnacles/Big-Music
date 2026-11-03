import { NextResponse, type NextRequest } from 'next/server';
import { toPlayable } from '@/lib/webTracks';
import { searchSongs } from '@/lib/ytBrowse';

export const dynamic = 'force-dynamic';

// GET ?q=rainy day lo-fi → { tracks } — songs on YouTube Music that match the
// words, to start a radio from. The player picks one of the top few, so the
// same words give a different radio each time.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'Type a genre, mood or artist first.' }, { status: 400 });
  try {
    const songs = (await searchSongs(q)).filter((s) => !s.isVideo).slice(0, 6);
    if (!songs.length) return NextResponse.json({ error: `Nothing found for “${q}”. Try other words.` }, { status: 404 });
    return NextResponse.json({ tracks: await toPlayable(songs) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
