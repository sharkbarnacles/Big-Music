// Pinned playlists and playlist tags (Home Lab pick L3 + T3 + P2 + G2 + E3).
// Pins: playlists.pinned_at (pinned ones sit at the top of Home, oldest pin first).
// Tags: your own words, in table `tags`, linked to playlists by `playlist_tags`.
import { db, fetchAllRows } from './db';
import { TAG_COLORS, type Tag, type TagColor } from './tagTypes';

export type { Tag, TagColor };

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const ids = (list: unknown): string[] => (Array.isArray(list) ? list.map(String).filter(isId) : []);
const asColor = (c: string | null): TagColor => (TAG_COLORS as readonly string[]).includes(c ?? '') ? (c as TagColor) : 'teal';

// Every tag that's on at least one playlist, A–Z, with how many playlists have it.
export async function listTags(): Promise<Tag[]> {
  const [{ data: tags, error }, { rows: links, error: e2 }] = await Promise.all([
    db().from('tags').select('id, name, color'),
    fetchAllRows<{ tag_id: string }>((from, to) => db().from('playlist_tags').select('tag_id').range(from, to)),
  ]);
  if (error) throw new Error(error.message);
  if (e2) throw new Error(e2);
  const counts = new Map<string, number>();
  for (const l of links) counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1);
  return (tags ?? [])
    .map((t) => ({ id: t.id, name: t.name, color: asColor(t.color), count: counts.get(t.id) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Finds a tag by name (any capitals) or makes it, giving it the next colour.
export async function makeTag(raw: string): Promise<Tag> {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new Error('Type a name for the tag.');
  const { data: all, error } = await db().from('tags').select('id, name, color');
  if (error) throw new Error(error.message);
  const same = (all ?? []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (same) return { id: same.id, name: same.name, color: asColor(same.color), count: 0 };
  const color = TAG_COLORS[(all ?? []).length % TAG_COLORS.length];
  const { data, error: e2 } = await db().from('tags').insert({ name, color }).select('id, name, color').single();
  if (e2) throw new Error(e2.message);
  return { id: data.id, name: data.name, color: asColor(data.color), count: 0 };
}

// Puts one tag on (on: true) or takes it off several playlists.
export async function setPlaylistTag(playlistIds: unknown, tagId: string, on: boolean): Promise<number> {
  const list = ids(playlistIds);
  if (!list.length || !isId(tagId)) return 0;
  if (on) {
    const { error } = await db()
      .from('playlist_tags')
      .upsert(list.map((playlist_id) => ({ playlist_id, tag_id: tagId })), { onConflict: 'playlist_id,tag_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db().from('playlist_tags').delete().eq('tag_id', tagId).in('playlist_id', list);
    if (error) throw new Error(error.message);
  }
  return list.length;
}

// Pins (in the order given, so they line up as picked) or unpins playlists.
export async function setPinned(playlistIds: unknown, pinned: boolean): Promise<number> {
  const list = ids(playlistIds);
  if (!list.length) return 0;
  if (!pinned) {
    const { error } = await db().from('playlists').update({ pinned_at: null }).in('id', list);
    if (error) throw new Error(error.message);
    return list.length;
  }
  // Already-pinned ones keep their place.
  const { data: rows, error } = await db().from('playlists').select('id, pinned_at').in('id', list);
  if (error) throw new Error(error.message);
  const already = new Set((rows ?? []).filter((r) => r.pinned_at).map((r) => r.id));
  const now = Date.now();
  const fresh = list.filter((id) => !already.has(id));
  await Promise.all(
    fresh.map((id, i) =>
      db().from('playlists').update({ pinned_at: new Date(now + i).toISOString() }).eq('id', id),
    ),
  );
  return fresh.length;
}
