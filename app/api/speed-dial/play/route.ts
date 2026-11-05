import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { getEdition, toTrack } from '@/lib/discover';
import { findAlbum } from '@/lib/findAlbum';
import { loadTracks } from '@/lib/libraryQuery';
import { trackQueryString } from '@/lib/libraryParams';
import { TRACK_COLUMNS } from '@/lib/tracks';
import { toPlayable } from '@/lib/webTracks';
import { browseCollection } from '@/lib/ytBrowse';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Songs for a speed-dial play button (Home → Jump back in):
//   ?radio=<edition id>            the radio's saved songs
//   ?album=<name>&artist=<name>    the whole album from YouTube Music (else your songs from it)
//   ?artist=<name>                 your songs by them, shuffled (the whole list, via `source`)
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const radio = q.get('radio');
    if (radio) {
      const ed = await getEdition(radio);
      return NextResponse.json({ tracks: (ed?.items ?? []).map(toTrack), from: ed?.title ?? 'Radio' });
    }
    const album = q.get('album');
    if (album) {
      const artist = q.get('artist') ?? '';
      const hit = await findAlbum(album, artist);
      if (hit) {
        const page = await browseCollection(hit.id).catch(() => null);
        const tracks = page ? await toPlayable(page.songs) : [];
        if (tracks.length) return NextResponse.json({ tracks, from: album });
      }
      const { data } = await db().from('tracks').select(TRACK_COLUMNS).ilike('album', album).limit(100);
      return NextResponse.json({ tracks: data ?? [], from: album });
    }
    const artist = q.get('artist');
    if (artist) {
      const tq = { artist, sort: 'title' };
      const { tracks, total } = await loadTracks(tq, 0, 200);
      // The player shuffles the whole list itself (it fetches more as it goes).
      return NextResponse.json({ tracks, from: artist, shuffle: true, source: { query: trackQueryString(tq), total: total ?? tracks.length } });
    }
    return NextResponse.json({ error: 'Nothing to play.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
