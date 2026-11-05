// Every radio you start is saved as a dated edition (kind 'radio') in Discover's
// Past editions, so it never disappears. As the radio keeps going, the songs it
// adds are appended to the same edition.
import { db } from './db';
import type { TrackRowData } from './tracks';

const NY = 'America/New_York';
const todayInNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date());

function rows(editionId: string, start: number, tracks: TrackRowData[]) {
  return tracks.map((t, i) => ({
    edition_id: editionId,
    position: start + i,
    track_id: /^[0-9a-f-]{36}$/i.test(t.id) ? t.id : null,
    yt_video_id: t.yt_audio_id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    image_url: t.image_url,
    duration_ms: t.duration_ms,
  }));
}

export async function createRadioEdition(seed: { title: string; artist: string; videoId: string; label?: string | null; subtitle?: string }, tracks: TrackRowData[]): Promise<string | null> {
  const { data, error } = await db()
    .from('discover_editions')
    .insert({ kind: 'radio', edition_date: todayInNY(), title: (seed.label ? `Radio: ${seed.label}` : `Radio from ${seed.title}`).slice(0, 120), subtitle: (seed.subtitle ?? (seed.label ? `started from ${seed.title}` : seed.artist)).slice(0, 120), seed_video_id: seed.videoId })
    .select('id')
    .single();
  if (error || !data) return null;
  if (tracks.length) await db().from('discover_items').insert(rows(data.id, 0, tracks));
  return data.id as string;
}

export async function appendToRadioEdition(editionId: string, tracks: TrackRowData[]) {
  if (!tracks.length || !/^[0-9a-f-]{36}$/i.test(editionId)) return;
  const { data: have } = await db().from('discover_items').select('position, yt_video_id').eq('edition_id', editionId);
  const seen = new Set((have ?? []).map((r: any) => r.yt_video_id));
  const fresh = tracks.filter((t) => t.yt_audio_id && !seen.has(t.yt_audio_id));
  const start = (have ?? []).reduce((m: number, r: any) => Math.max(m, r.position + 1), 0);
  if (fresh.length) await db().from('discover_items').insert(rows(editionId, start, fresh));
}
