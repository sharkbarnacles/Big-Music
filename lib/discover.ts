// The Discover tab's lists. They're made by scripts/discover.py (a daily
// GitHub job), each with a date, and never change afterwards.
import { db } from './db';
import { createHubPlaylist, addToHubPlaylist } from './hubPlaylists';
import { keepDiscoveryItem } from './keepDiscovery';
import type { TrackRowData } from './tracks';

export type EditionKind = 'daily' | 'weekly' | 'releases' | 'month' | 'forgotten' | 'radio';

export type DiscoverItem = {
  id: string;
  position: number;
  track_id: string | null;
  yt_video_id: string | null;
  title: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  duration_ms: number | null;
  reason: string | null;
  hearted: boolean;
};

export type Edition = {
  id: string;
  kind: EditionKind;
  edition_date: string; // YYYY-MM-DD
  title: string;
  subtitle: string | null;
  playlist_id?: string | null;
  items: DiscoverItem[];
};

const ITEM_COLUMNS = 'id, position, track_id, yt_video_id, title, artist, album, image_url, duration_ms, reason, hearted';
const DISCOVERIES = 'Discoveries';

// A discovery as a song the player can play (in YouTube mode, from its YouTube ID).
export function toTrack(item: DiscoverItem): TrackRowData {
  return {
    id: item.track_id ?? `disc:${item.id}`,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration_ms: item.duration_ms,
    image_url: item.image_url,
    video_id: null,
    yt_audio_id: item.yt_video_id,
    track_sources: item.yt_video_id
      ? [{ service: 'youtube', external_id: item.yt_video_id, url: `https://music.youtube.com/watch?v=${item.yt_video_id}` }]
      : [],
  };
}

// The newest edition of each kind, with its songs.
export async function latestEditions(): Promise<Partial<Record<EditionKind, Edition>>> {
  const kinds: EditionKind[] = ['daily', 'weekly', 'releases', 'month', 'forgotten']; // radios live in Past editions
  const results = await Promise.all(
    kinds.map((kind) =>
      db()
        .from('discover_editions')
        .select(`id, kind, edition_date, title, subtitle, discover_items(${ITEM_COLUMNS})`)
        .eq('kind', kind)
        .order('edition_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  const out: Partial<Record<EditionKind, Edition>> = {};
  results.forEach(({ data }, i) => {
    if (data) out[kinds[i]] = shape(data);
  });
  return out;
}

export async function getEdition(id: string): Promise<Edition | null> {
  const { data } = await db()
    .from('discover_editions')
    .select(`id, kind, edition_date, title, subtitle, playlist_id, discover_items(${ITEM_COLUMNS})`)
    .eq('id', id)
    .maybeSingle();
  return data ? shape(data) : null;
}

function shape(row: any): Edition {
  const items = [...(row.discover_items ?? [])].sort((a: DiscoverItem, b: DiscoverItem) => a.position - b.position);
  return { id: row.id, kind: row.kind, edition_date: row.edition_date, title: row.title, subtitle: row.subtitle, playlist_id: row.playlist_id ?? null, items };
}

// Every edition in one month (for the archive calendar).
export async function editionsInMonth(month: string) {
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const { data, error } = await db()
    .from('discover_editions')
    .select('id, kind, edition_date, title, subtitle, discover_items(count)')
    .gte('edition_date', start)
    .lt('edition_date', end)
    .order('edition_date');
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({
    id: e.id as string,
    kind: e.kind as EditionKind,
    edition_date: e.edition_date as string,
    title: e.title as string,
    subtitle: e.subtitle as string | null,
    count: e.discover_items?.[0]?.count ?? 0,
  }));
}

async function discoveriesPlaylist(): Promise<string> {
  const { data } = await db().from('playlists').select('id').eq('service', 'hub').eq('name', DISCOVERIES).limit(1).maybeSingle();
  return data?.id ?? (await createHubPlaylist(DISCOVERIES));
}

// Heart = keep the song: it becomes a real song in your library and goes into
// the "Discoveries" playlist. Un-heart takes it out of that playlist again.
export async function setHeart(itemId: string, on: boolean): Promise<{ hearted: boolean; trackId: string | null }> {
  const { data: item, error } = await db().from('discover_items').select(ITEM_COLUMNS).eq('id', itemId).maybeSingle();
  if (error || !item) throw new Error('That song isn’t in Discover any more.');
  const playlistId = await discoveriesPlaylist();

  let trackId: string | null = item.track_id;
  if (on && !trackId) trackId = await keepDiscoveryItem(itemId);

  if (on && trackId) await addToHubPlaylist(playlistId, [trackId]);
  if (!on && trackId) await db().from('playlist_items').delete().eq('playlist_id', playlistId).eq('track_id', trackId);

  await db().from('discover_items').update({ hearted: on, track_id: trackId }).eq('id', itemId);
  // The same song can sit in more than one edition (e.g. a month mix); keep them in step.
  if (trackId) await db().from('discover_items').update({ hearted: on }).eq('track_id', trackId);
  return { hearted: on, trackId };
}

// Counts a play (the player calls this after 30 seconds of a song).
export async function logPlay(trackId: string, service: string) {
  if (!/^[0-9a-f-]{36}$/i.test(trackId)) return; // discoveries not kept yet have no song row
  await db().from('plays').insert({ track_id: trackId, service });
}
