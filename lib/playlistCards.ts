// Every playlist as a card for Home and Library's playlist view (cover, counts,
// pins, tags), read page by page so more than 1,000 playlists all arrive.
import type { PlaylistCard } from '@/components/PlaylistBrowser';
import { db, fetchAllRows } from './db';

type PlaylistRow = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  last_added_at: string | null;
  set_aside: boolean;
  pinned_at: string | null;
  playlist_items: { count: number }[];
  playlist_tags: { tag_id: string }[];
};

export async function loadPlaylistCards(): Promise<{ cards: PlaylistCard[]; error: string | null }> {
  const { rows, error } = await fetchAllRows<PlaylistRow>((from, to) =>
    db()
      .from('playlists')
      .select('id, service, name, image_url, last_added_at, set_aside, pinned_at, playlist_items(count), playlist_tags(tag_id)')
      .order('name')
      .range(from, to),
  );
  const cards = rows.map((p) => ({
    id: p.id,
    service: p.service,
    name: p.name,
    image_url: p.image_url,
    count: p.playlist_items?.[0]?.count ?? 0,
    last_added_at: p.last_added_at,
    set_aside: !!p.set_aside,
    pinned_at: p.pinned_at,
    tags: (p.playlist_tags ?? []).map((t) => t.tag_id),
  }));
  return { cards, error };
}
