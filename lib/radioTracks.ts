// Turns YouTube Music radio songs into songs the player can play.
// Songs already in your library come back as your own songs; new ones get a
// temporary "yt:<video id>" ID and are remembered in radio_songs so you can
// keep them or add them to a playlist. The dial decides how many of yours stay:
//   familiar = everything YouTube suggests
//   mixed    = mostly new to you, with about one song in three you have
//   new      = only songs that aren't in your library
import { db } from './db';
import { matchKey } from './library';
import { TRACK_COLUMNS, type TrackRowData } from './tracks';
import type { RadioSong } from './ytRadio';

export type RadioMode = 'familiar' | 'mixed' | 'new';
export const RADIO_SIZE = 50; // every radio starts with this many songs

export const radioMode = (m: string | null): RadioMode => (m === 'new' ? 'new' : m === 'familiar' ? 'familiar' : 'mixed');

// `skip`: track IDs or video IDs to leave out (for example the songs of the
// playlist a radio was made from). `libSeen` carries the dial's count across calls.
export async function toRadioTracks(
  songs: RadioSong[],
  mode: RadioMode,
  skip: Set<string> = new Set(),
  libSeen = { n: 0 },
): Promise<TrackRowData[]> {
  if (!songs.length) return [];
  // Studio audio first when YouTube Music has it; the music video is kept for the eye button.
  for (const s of songs) if (s.audioId && s.audioId !== s.videoId) s.videoId = s.audioId;
  const videoIds = [...new Set(songs.flatMap((s) => [s.videoId, s.mvId].filter(Boolean) as string[]))];
  const keys = songs.map((s) => matchKey({ service: 'youtube', externalId: s.videoId, url: '', title: s.title, artist: s.artist }));
  const [byAudio, bySource, byKey] = await Promise.all([
    db().from('tracks').select(TRACK_COLUMNS).in('yt_audio_id', videoIds),
    db().from('track_sources').select(`external_id, tracks(${TRACK_COLUMNS})`).eq('service', 'youtube').in('external_id', videoIds),
    db().from('tracks').select(`match_key, ${TRACK_COLUMNS}`).in('match_key', keys),
  ]);
  const mine = new Map<string, TrackRowData>();
  for (const t of (byAudio.data ?? []) as any[]) if (t.yt_audio_id) mine.set(t.yt_audio_id, t);
  for (const r of (bySource.data ?? []) as any[]) if (r.tracks) mine.set(r.external_id, r.tracks);
  const byMatch = new Map<string, TrackRowData>(((byKey.data ?? []) as any[]).map((t) => [t.match_key, t]));

  const fresh: any[] = [];
  const tracks: TrackRowData[] = [];
  songs.forEach((s, i) => {
    if (skip.has(s.videoId) || (s.mvId && skip.has(s.mvId))) return;
    const own = mine.get(s.videoId) ?? (s.mvId ? mine.get(s.mvId) : undefined) ?? byMatch.get(keys[i]);
    if (own) {
      if (skip.has(own.id)) return;
      if (mode === 'new') return;
      if (mode === 'mixed' && libSeen.n++ % 3 !== 0) return;
      tracks.push({ ...own, yt_audio_id: own.yt_audio_id ?? s.videoId, video_id: own.video_id ?? s.mvId });
      return;
    }
    fresh.push({ video_id: s.videoId, title: s.title, artist: s.artist, album: s.album, image_url: s.image, duration_ms: s.durationMs, seen_at: new Date().toISOString() });
    tracks.push({
      id: `yt:${s.videoId}`,
      title: s.title,
      artist: s.artist,
      album: s.album,
      duration_ms: s.durationMs,
      image_url: s.image,
      video_id: s.mvId,
      yt_audio_id: s.videoId,
      track_sources: [{ service: 'youtube', external_id: s.videoId, url: `https://music.youtube.com/watch?v=${s.videoId}` }],
    });
  });
  if (fresh.length) await db().from('radio_songs').upsert(fresh, { onConflict: 'video_id' });
  // The same song twice in one batch (audio and video both suggested) → once.
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const k = t.yt_audio_id ?? t.id;
    if (seen.has(k) || seen.has(t.id)) return false;
    seen.add(k);
    seen.add(t.id);
    return true;
  });
}
