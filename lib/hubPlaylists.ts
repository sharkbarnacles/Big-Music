// Playlists you make inside the hub (playlists.service = 'hub').
// Imports never touch them: they only replace Spotify / YouTube playlists.
import { chunk, db, fetchAllRows } from './db';

export type HubPlaylist = { id: string; name: string; count: number; image_url: string | null };

export async function listHubPlaylists(): Promise<HubPlaylist[]> {
  const { data, error } = await db()
    .from('playlists')
    .select('id, name, image_url, last_added_at, playlist_items(count)')
    .eq('service', 'hub')
    .order('last_added_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    image_url: p.image_url,
    count: p.playlist_items?.[0]?.count ?? 0,
  }));
}

async function requireHub(id: string) {
  const { data } = await db().from('playlists').select('id, image_url').eq('id', id).eq('service', 'hub').maybeSingle();
  if (!data) throw new Error('That playlist isn’t one of your hub playlists.');
  return data as { id: string; image_url: string | null };
}

export async function createHubPlaylist(name: string): Promise<string> {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new Error('Give the playlist a name.');
  const { data, error } = await db()
    .from('playlists')
    .insert({ service: 'hub', external_id: crypto.randomUUID(), name: clean, last_added_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function renameHubPlaylist(id: string, name: string) {
  await requireHub(id);
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new Error('Give the playlist a name.');
  const { error } = await db().from('playlists').update({ name: clean }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteHubPlaylist(id: string) {
  await requireHub(id);
  const { error } = await db().from('playlists').delete().eq('id', id).eq('service', 'hub');
  if (error) throw new Error(error.message);
}

// Adds songs to the end. Songs already in the playlist are skipped.
export async function addToHubPlaylist(id: string, trackIds: string[]): Promise<{ added: number; skipped: number }> {
  const playlist = await requireHub(id);
  const { rows, error } = await fetchAllRows<{ position: number; track_id: string }>((from, to) =>
    db().from('playlist_items').select('position, track_id').eq('playlist_id', id).order('position').range(from, to),
  );
  if (error) throw new Error(error);
  const have = new Set(rows.map((r) => r.track_id));
  const wanted = [...new Set(trackIds)].filter((t) => !have.has(t));
  let pos = rows.length ? rows[rows.length - 1].position + 1 : 0;
  for (const part of chunk(wanted, 500)) {
    const { error: e } = await db()
      .from('playlist_items')
      .insert(part.map((track_id) => ({ playlist_id: id, position: pos++, track_id })));
    if (e) throw new Error(e.message);
  }
  if (wanted.length) {
    const update: Record<string, string> = { last_added_at: new Date().toISOString() };
    if (!playlist.image_url) {
      // The first song's cover becomes the playlist's picture.
      const { data } = await db().from('tracks').select('image_url').in('id', wanted.slice(0, 20)).not('image_url', 'is', null).limit(1);
      if (data?.[0]?.image_url) update.image_url = data[0].image_url;
    }
    await db().from('playlists').update(update).eq('id', id);
  }
  return { added: wanted.length, skipped: trackIds.length - wanted.length };
}

export async function removeFromHubPlaylist(id: string, position: number) {
  await requireHub(id);
  const { error } = await db().from('playlist_items').delete().eq('playlist_id', id).eq('position', position);
  if (error) throw new Error(error.message);
}
