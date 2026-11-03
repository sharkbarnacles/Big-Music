import { chunk, db } from './db';
import type { Service } from './oauth';

// One song as it comes from Spotify or YouTube, before saving.
export type ImportedTrack = {
  service: Service;
  externalId: string; // Spotify track ID or YouTube video ID
  url: string;
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
  imageUrl?: string | null;
  // Set when this upload IS a music video (a YouTube music upload that isn't an
  // audio-only "Artist - Topic" track). Saved as the song's video.
  musicVideoId?: string | null;
};

// ── Duplicate matching ────────────────────────────────────────────────
// The same song on both services should become ONE row in `tracks`.
// We build a simplified "artist|title" key so small differences don't matter:
//   "Daft Punk" + "Get Lucky (feat. Pharrell) - Radio Edit"  →  "daft punk|get lucky"

export function simplify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // é → e
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // drop (anything) and [anything]
    .replace(/\s(feat|ft|featuring)\.?\s.*$/, ' ') // drop "feat. X" to the end
    .replace(/\s-\s.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo)\b.*$/, ' ') // "- 2011 Remaster"
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // punctuation → space (keeps all alphabets, incl. Korean)
    .trim();
}

export function primaryArtist(artist: string): string {
  return artist.split(/,|&|\s+x\s+|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim();
}

export function matchKey(t: ImportedTrack): string {
  const a = simplify(primaryArtist(t.artist));
  const b = simplify(t.title);
  return a && b ? `${a}|${b}` : `${t.service}:${t.externalId}`;
}

// ── Saving ────────────────────────────────────────────────────────────

// Saves songs (merging duplicates) and returns a map: externalId → our track id.
export async function saveTracks(tracks: ImportedTrack[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (tracks.length === 0) return result;

  // 1. One row per match key within this batch.
  const byKey = new Map<string, ImportedTrack>();
  for (const t of tracks) {
    const key = matchKey(t);
    if (!byKey.has(key)) byKey.set(key, t);
  }

  // 2. Insert new songs; songs already in the library are left as they are.
  for (const part of chunk([...byKey.entries()], 500)) {
    const rows = part.map(([key, t]) => ({
      match_key: key,
      title: t.title,
      artist: t.artist,
      album: t.album ?? null,
      duration_ms: t.durationMs ?? null,
      isrc: t.isrc ?? null,
      image_url: t.imageUrl ?? null,
    }));
    const { error } = await db().from('tracks').upsert(rows, { onConflict: 'match_key', ignoreDuplicates: true });
    if (error) throw new Error(`Saving songs failed: ${error.message}`);
  }

  // 3. Look up the ids of every song in this batch (new and old).
  const idByKey = new Map<string, string>();
  // (Small batches keep the request URL short enough for the server.)
  for (const keys of chunk([...byKey.keys()], 50)) {
    const { data, error } = await db().from('tracks').select('id, match_key').in('match_key', keys);
    if (error) throw new Error(`Reading songs failed: ${error.message}`);
    for (const row of data ?? []) idByKey.set(row.match_key, row.id);
  }

  // 4. Record where each song lives (Spotify ID / YouTube ID).
  const sources = new Map<string, { track_id: string; service: Service; external_id: string; url: string }>();
  for (const t of tracks) {
    const trackId = idByKey.get(matchKey(t));
    if (!trackId) continue;
    result.set(t.externalId, trackId);
    sources.set(`${t.service}:${t.externalId}`, {
      track_id: trackId,
      service: t.service,
      external_id: t.externalId,
      url: t.url,
    });
  }
  for (const part of chunk([...sources.values()], 500)) {
    const { error } = await db().from('track_sources').upsert(part, { onConflict: 'service,external_id' });
    if (error) throw new Error(`Saving song links failed: ${error.message}`);
  }

  // 5. Music videos spotted during the import become the song's video.
  const videos = new Map<string, { track_id: string; video_id: string; source: string }>();
  for (const t of tracks) {
    const trackId = result.get(t.externalId);
    if (trackId && t.musicVideoId && !videos.has(trackId)) {
      videos.set(trackId, { track_id: trackId, video_id: t.musicVideoId, source: 'youtube-import' });
    }
  }
  for (const part of chunk([...videos.values()], 500)) {
    const { error } = await db().rpc('set_track_videos', { items: part });
    if (error) throw new Error(`Saving music videos failed: ${error.message} (did you re-run schema.sql?)`);
  }

  return result;
}

// ── Choosing which playlists to import ────────────────────────────────

// YouTube playlists import automatically when at least this share of their
// videos is music. You can override any playlist on the "Choose playlists" page.
export const MUSIC_THRESHOLD = 0.7;

export function autoInclude(service: Service, externalId: string, musicRatio: number | null): boolean {
  if (service === 'spotify' || externalId === 'liked') return true;
  return (musicRatio ?? 0) >= MUSIC_THRESHOLD;
}

export type SourceDecision = {
  include: boolean;
  // true when you ticked it yourself: then non-music videos are kept too.
  forced: boolean;
};

// Records a playlist seen on a service and decides whether to import it.
export async function recordSource(
  service: Service,
  externalId: string,
  name: string,
  itemCount: number,
  musicRatio: number | null,
): Promise<SourceDecision> {
  const { data, error } = await db()
    .from('source_playlists')
    .upsert(
      {
        service,
        external_id: externalId,
        name,
        item_count: itemCount,
        music_ratio: musicRatio,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'service,external_id' }, // keeps your existing user_choice
    )
    .select('user_choice')
    .single();
  if (error) throw new Error(`Saving playlist list failed: ${error.message} (did you re-run schema.sql?)`);

  const choice = (data?.user_choice ?? null) as boolean | null;
  return { include: choice ?? autoInclude(service, externalId, musicRatio), forced: choice === true };
}

// Takes a playlist out of your library (it stays on Spotify/YouTube).
export async function removePlaylist(service: Service, externalId: string) {
  const { error } = await db().from('playlists').delete().eq('service', service).eq('external_id', externalId);
  if (error) throw new Error(`Removing playlist failed: ${error.message}`);
}

// Deletes songs that are no longer in any playlist. Returns how many.
export async function cleanupOrphans(): Promise<number> {
  const { data, error } = await db().rpc('delete_orphan_tracks');
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
  return (data as number) ?? 0;
}

export type PlaylistMeta = {
  service: Service;
  externalId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  lastAddedAt?: string | null; // when a song was last added (for "Recently updated")
};

// The newest of a list of dates (ignores missing or broken ones).
export function newestDate(dates: (string | null | undefined)[]): string | null {
  let best = 0;
  for (const d of dates) {
    const t = d ? Date.parse(d) : NaN;
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString() : null;
}

// Saves a playlist and replaces its song list with the fresh import.
export async function savePlaylist(meta: PlaylistMeta, tracks: ImportedTrack[]): Promise<number> {
  const idMap = await saveTracks(tracks);

  const { data, error } = await db()
    .from('playlists')
    .upsert(
      {
        service: meta.service,
        external_id: meta.externalId,
        name: meta.name,
        description: meta.description ?? null,
        image_url: meta.imageUrl ?? null,
        last_added_at: meta.lastAddedAt ?? null,
        imported_at: new Date().toISOString(),
      },
      { onConflict: 'service,external_id' },
    )
    .select('id')
    .single();
  if (error || !data) throw new Error(`Saving playlist failed: ${error?.message}`);

  const playlistId = data.id as string;
  const { error: delError } = await db().from('playlist_items').delete().eq('playlist_id', playlistId);
  if (delError) throw new Error(`Clearing playlist failed: ${delError.message}`);

  const items = tracks
    .map((t) => idMap.get(t.externalId))
    .filter((id): id is string => Boolean(id))
    .map((trackId, position) => ({ playlist_id: playlistId, position, track_id: trackId }));

  for (const part of chunk(items, 500)) {
    const { error: insError } = await db().from('playlist_items').insert(part);
    if (insError) throw new Error(`Saving playlist songs failed: ${insError.message}`);
  }
  return items.length;
}

export type ImportSummary = {
  service: Service;
  playlists: number;
  songs: number;
  excluded: number; // playlists left out (not music, or you unticked them)
  skipped: { name: string; reason: string }[];
};
