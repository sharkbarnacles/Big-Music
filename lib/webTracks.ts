// Turns songs found on YouTube Music into songs the player can play.
// Ones already in your library come back as your own songs (so stars and
// playlists show as usual); new ones get a temporary "yt:<video id>" ID and
// are remembered in radio_songs, so starring or adding them to a playlist
// saves them to your library (lib/keepDiscovery.ts), same as radio songs.
import { db } from './db';
import { TRACK_COLUMNS, type TrackRowData } from './tracks';
import type { WebSong } from './ytBrowse';

export async function toPlayable(songs: WebSong[]): Promise<TrackRowData[]> {
  if (!songs.length) return [];
  const ids = [...new Set(songs.map((s) => s.videoId))];
  const [byAudio, bySource] = await Promise.all([
    db().from('tracks').select(TRACK_COLUMNS).in('yt_audio_id', ids),
    db().from('track_sources').select(`external_id, tracks(${TRACK_COLUMNS})`).eq('service', 'youtube').in('external_id', ids),
  ]);
  const mine = new Map<string, TrackRowData>();
  for (const t of (byAudio.data ?? []) as any[]) if (t.yt_audio_id) mine.set(t.yt_audio_id, t);
  for (const r of (bySource.data ?? []) as any[]) if (r.tracks) mine.set(r.external_id, r.tracks);

  const fresh = songs
    .filter((s) => !mine.has(s.videoId))
    .map((s) => ({ video_id: s.videoId, title: s.title, artist: s.artist, album: s.album, image_url: s.image, duration_ms: s.durationMs, seen_at: new Date().toISOString() }));
  const unique = [...new Map(fresh.map((f) => [f.video_id, f])).values()];
  if (unique.length) await db().from('radio_songs').upsert(unique, { onConflict: 'video_id' });

  return songs.map((s) => {
    const own = mine.get(s.videoId);
    if (own) return { ...own, yt_audio_id: own.yt_audio_id ?? s.videoId };
    return {
      id: `yt:${s.videoId}`,
      title: s.title,
      artist: s.artist,
      album: s.album,
      duration_ms: s.durationMs,
      image_url: s.image,
      // A video or upload: the player looks for the studio version, and the eye shows the video.
      video_id: s.isVideo ? s.videoId : null,
      yt_audio_id: s.videoId,
      track_sources: [{ service: 'youtube', external_id: s.videoId, url: `https://music.youtube.com/watch?v=${s.videoId}` }],
    };
  });
}
