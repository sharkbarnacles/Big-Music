import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { addToHubPlaylist, createHubPlaylist } from '@/lib/hubPlaylists';
import { keepDiscoveryItem } from '@/lib/keepDiscovery';

export const maxDuration = 60;

// POST { editionId }: turns a saved radio (or any Discover edition) into one of
// your hub playlists. Saving again later adds any songs the radio has gained.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const editionId = typeof body.editionId === 'string' ? body.editionId : '';
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return NextResponse.json({ error: 'Missing list' }, { status: 400 });
  try {
    const { data: ed } = await db().from('discover_editions').select('id, title, edition_date, playlist_id').eq('id', editionId).maybeSingle();
    if (!ed) return NextResponse.json({ error: 'That list can’t be found.' }, { status: 404 });

    let playlistId: string | null = ed.playlist_id ?? null;
    let name = ed.title as string;
    if (playlistId) {
      const { data: p } = await db().from('playlists').select('id, name').eq('id', playlistId).maybeSingle();
      if (p) name = p.name;
      else playlistId = null; // the playlist was deleted since; make a new one
    }
    if (!playlistId) {
      const day = new Date(`${ed.edition_date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      name = `${ed.title} · ${day}`.slice(0, 100);
      playlistId = await createHubPlaylist(name);
      await db().from('discover_editions').update({ playlist_id: playlistId }).eq('id', editionId);
    }

    // Every song needs to be in your library to sit in a playlist.
    const { data: items } = await db().from('discover_items').select('id, track_id').eq('edition_id', editionId).order('position');
    const ids: string[] = [];
    for (const it of items ?? []) {
      try {
        ids.push((it.track_id as string | null) ?? (await keepDiscoveryItem(it.id as string)));
      } catch {
        /* a song without a YouTube version is skipped */
      }
    }
    const r = await addToHubPlaylist(playlistId, ids);
    return NextResponse.json({ playlistId, name, added: r.added });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
