// Albums you've starred (on a YouTube Music album page). Listed under the
// "Albums" chip on Home / Library playlists, newest first.
import { db } from './db';

export type SavedAlbum = {
  browse_id: string; // YouTube Music album id (MPRE…), opens /web/album/<id>
  title: string;
  artist: string | null;
  subtitle: string | null; // e.g. "Album · 2019"
  image_url: string | null;
  song_count: number | null;
  saved_at: string;
};

export const ALBUM_ID = /^MPRE[\w-]{4,76}$/;

export async function loadSavedAlbums(): Promise<{ albums: SavedAlbum[]; error?: string }> {
  const { data, error } = await db().from('saved_albums').select('*').order('saved_at', { ascending: false }).limit(1000);
  if (error) return { albums: [], error: error.message };
  return { albums: (data ?? []) as SavedAlbum[] };
}

export async function isAlbumSaved(id: string): Promise<boolean> {
  const { data } = await db().from('saved_albums').select('browse_id').eq('browse_id', id).maybeSingle();
  return Boolean(data);
}

export async function saveAlbum(a: Omit<SavedAlbum, 'saved_at'>) {
  const { error } = await db().from('saved_albums').upsert(a, { onConflict: 'browse_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function unsaveAlbum(id: string) {
  const { error } = await db().from('saved_albums').delete().eq('browse_id', id);
  if (error) throw new Error(error.message);
}
