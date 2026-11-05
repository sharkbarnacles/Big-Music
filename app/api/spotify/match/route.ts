import { NextResponse, type NextRequest } from 'next/server';
import { matchSongs, type MatchAsk } from '@/lib/spotifyMatch';
import { errorResponse } from '@/lib/spotifyPlayer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST { songs: [{ key, title, artist }] } → { matches: { key: spotifyId | null } }
// Spotify versions of songs that came from YouTube, for Spotify mode.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const songs: MatchAsk[] = (Array.isArray(body.songs) ? body.songs : [])
      .filter((s: any) => s && typeof s.key === 'string' && typeof s.title === 'string' && typeof s.artist === 'string')
      .map((s: any) => ({ key: s.key, title: s.title.slice(0, 200), artist: s.artist.slice(0, 200) }));
    return NextResponse.json({ matches: await matchSongs(songs) });
  } catch (err) {
    return errorResponse(err);
  }
}
