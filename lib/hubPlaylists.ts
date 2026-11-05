// Playlists you make inside the hub (playlists.service = 'hub').
// Imports never touch them: they only replace Spotify / YouTube playlists.
import { chunk, db, fetchAllRows } from './db';
import { resolveTrackIds } from './keepDiscovery';

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
export async function addToHubPlaylist(id: string, ids: string[]): Promise<{ added: number; skipped: number }> {
  const playlist = await requireHub(id);
  // Songs from Discover are saved to your library first (they have "disc:…" IDs until then).
  const trackIds = await resolveTrackIds(ids);
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

// Removes songs by their places in the playlist (one or many at once).
export async function removeFromHubPlaylist(id: string, positions: number[]) {
  await requireHub(id);
  const clean = [...new Set(positions.filter((n) => Number.isInteger(n)))];
  if (!clean.length) return;
  for (const part of chunk(clean, 500)) {
    const { error } = await db().from('playlist_items').delete().eq('playlist_id', id).in('position', part);
    if (error) throw new Error(error.message);
  }
}

// Puts a hub playlist's songs in a new order. `order` lists the songs'
// current places (positions) in the order you want them. The new order is
// written first at fresh places after the old ones, and only then are the old
// rows removed, so a failure can never lose songs. Returns the new places.
export async function reorderHubPlaylist(id: string, order: number[]): Promise<number[]> {
  await requireHub(id);
  const { rows, error } = await fetchAllRows<{ position: number; track_id: string }>((from, to) =>
    db().from('playlist_items').select('position, track_id').eq('playlist_id', id).order('position').range(from, to),
  );
  if (error) throw new Error(error);
  const byPos = new Map(rows.map((r) => [r.position, r.track_id]));
  const clean = order.map(Number);
  if (clean.length !== rows.length || new Set(clean).size !== clean.length || clean.some((p) => !byPos.has(p))) {
    throw new Error('This playlist changed somewhere else. Pull down to refresh, then try again.');
  }
  const base = rows.length ? rows[rows.length - 1].position + 1 : 0;
  const fresh = clean.map((p, i) => ({ playlist_id: id, position: base + i, track_id: byPos.get(p)! }));
  for (const part of chunk(fresh, 500)) {
    const { error: e } = await db().from('playlist_items').insert(part);
    if (e) throw new Error(e.message);
  }
  const { error: e2 } = await db().from('playlist_items').delete().eq('playlist_id', id).lt('position', base);
  if (e2) throw new Error(e2.message);
  return fresh.map((r) => r.position);
}

// "Set aside" (Playlist Tools Lab F2 + M3): any playlist (Spotify, YouTube or
// yours) can go in the Set aside folder. It still plays, but songs that are
// only in set-aside playlists stop shaping your taste (SQL taste_artists).
export async function setAside(ids: string[], aside: boolean): Promise<number> {
  const clean = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!clean.length) return 0;
  const { error, count } = await db().from('playlists').update({ set_aside: aside }, { count: 'exact' }).in('id', clean);
  if (error) throw new Error(error.message);
  return count ?? clean.length;
}
