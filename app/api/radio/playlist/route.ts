import { NextResponse, type NextRequest } from 'next/server';
import { playlistRadio } from '@/lib/playlistRadio';
import { createRadioEdition } from '@/lib/radioEditions';
import { radioMode } from '@/lib/radioTracks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET ?id=<playlist>&mode=familiar|mixed|new: start a radio from a whole
// playlist (50 songs like it, none of its own). More come from
// /api/radio?continuation=pl:… as you listen. Saved in Past editions.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const { name, tracks, continuation } = await playlistRadio({ playlistId: q.get('id') ?? '', mode: radioMode(q.get('mode')) });
    if (!tracks.length) return NextResponse.json({ error: 'YouTube Music had no songs for this playlist’s radio. Try again in a moment.' }, { status: 502 });
    const first = tracks[0];
    const editionId = await createRadioEdition(
      { title: first.title, artist: first.artist, videoId: first.yt_audio_id ?? '', label: name, subtitle: 'from your playlist' },
      tracks,
    ).catch(() => null);
    return NextResponse.json({ tracks, continuation, editionId, name });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
