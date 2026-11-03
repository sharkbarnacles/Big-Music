// Reads any slice of the library, in any order, straight from the database
// (SQL functions library_page and artist_page). Used by the Library page
// and by /api/library/* when you scroll or the player needs more songs.
import { chunk, db } from './db';
import type { TrackQuery } from './libraryParams';
import { TRACK_COLUMNS, type TrackRowData } from './tracks';

export type ArtistRow = { artist: string; songs: number; videos: number; image_url: string | null };

// Removes characters that would confuse the database search.
const clean = (s?: string | null) => (s ?? '').replace(/[%\\]/g, ' ').trim() || null;

export async function loadTracks(
  query: TrackQuery,
  offset: number,
  limit: number,
  seed: string | null = null,
): Promise<{ tracks: TrackRowData[]; total: number | null; error: string | null }> {
  const { data, error } = await db().rpc('library_page', {
    q: clean(query.q),
    only_videos: Boolean(query.videos),
    both_services: Boolean(query.both),
    main_artist: query.artist?.trim() || null,
    sort_by: query.sort || 'artist',
    seed,
    off_n: offset,
    lim_n: limit,
  });
  if (error) return { tracks: [], total: null, error: error.message };
  const rows = (data ?? []) as { id: string; total: number }[];
  const total = rows.length ? Number(rows[0].total) : offset === 0 ? 0 : null;

  // Fetch the full details for these songs, then put them back in order.
  const parts = await Promise.all(
    chunk(rows.map((r) => r.id), 150).map((ids) => db().from('tracks').select(TRACK_COLUMNS).in('id', ids)),
  );
  const byId = new Map<string, TrackRowData>();
  for (const p of parts) {
    if (p.error) return { tracks: [], total, error: p.error.message };
    for (const t of (p.data ?? []) as unknown as TrackRowData[]) byId.set(t.id, t);
  }
  const tracks = rows.map((r) => byId.get(r.id)).filter((t): t is TrackRowData => Boolean(t));
  return { tracks, total, error: null };
}

export async function loadArtists(
  search: string,
  byName: boolean,
  offset: number,
  limit: number,
): Promise<{ artists: ArtistRow[]; error: string | null }> {
  const { data, error } = await db().rpc('artist_page', {
    search: clean(search),
    by_name: byName,
    off_n: offset,
    limit_n: limit,
  });
  const artists = ((data ?? []) as ArtistRow[]).map((a) => ({ ...a, songs: Number(a.songs), videos: Number(a.videos) }));
  return { artists, error: error?.message ?? null };
}
