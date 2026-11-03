import { getAccessToken } from './connections';
import { db } from './db';
import { primaryArtist, simplify } from './library';
import { isTopicChannel } from './importers/youtube';

// Finds music videos using the OFFICIAL YouTube search.
// Each search costs 100 of your 10,000 daily quota units, so this is the slow
// backup. The faster way is scripts/find_videos.py (see README).

export const SEARCH_COST = 100;

type Candidate = { videoId: string; title: string; channel: string };

// Does this search result look like a video of this song?
// The artist must appear in the title or channel, and the song title in the title.
export function looksLikeMatch(artist: string, title: string, c: Candidate): boolean {
  const a = simplify(primaryArtist(artist));
  const t = simplify(title);
  if (!a || !t) return false;
  const videoTitle = simplify(c.title);
  return videoTitle.includes(t) && `${videoTitle} ${simplify(c.channel)}`.includes(a);
}

// Prefers uploads that say "official" or "MV"; skips audio-only Topic uploads.
export function pickVideo(artist: string, title: string, candidates: Candidate[]): string | null {
  const ok = candidates.filter((c) => !isTopicChannel(c.channel) && looksLikeMatch(artist, title, c));
  const official = ok.find((c) => /official|\bm\/?v\b|music video/i.test(c.title) || /vevo$/i.test(c.channel));
  return (official ?? ok[0])?.videoId ?? null;
}

// For listening: prefers YouTube Music's audio-only upload ("Artist - Topic"),
// then an official video, then any upload whose title and artist match.
export function pickAudio(artist: string, title: string, candidates: Candidate[]): string | null {
  const ok = candidates.filter((c) => looksLikeMatch(artist, title, c));
  const topic = ok.find((c) => isTopicChannel(c.channel));
  const official = ok.find((c) => /official|\bm\/?v\b|music video|audio/i.test(c.title) || /vevo$/i.test(c.channel));
  return (topic ?? official ?? ok[0])?.videoId ?? null;
}

// Looks up one song's YouTube audio version with the official search
// (100 quota units) and saves it. Used when you play a song in YouTube mode
// before the background finder has reached it.
export async function findAudioForTrack(trackId: string): Promise<{ audioId: string | null; message?: string }> {
  const { data: track, error } = await db()
    .from('tracks')
    .select('id, title, artist, yt_audio_id, yt_audio_status')
    .eq('id', trackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!track) return { audioId: null, message: 'Song not found.' };
  if (track.yt_audio_id) return { audioId: track.yt_audio_id };
  if (track.yt_audio_status === 'none') return { audioId: null, message: 'No YouTube version of this song was found.' };

  const token = await getAccessToken('youtube');
  const params = new URLSearchParams({
    part: 'snippet',
    q: `${primaryArtist(track.artist)} ${track.title}`,
    type: 'video',
    videoCategoryId: '10',
    maxResults: '6',
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      audioId: null,
      message: text.includes('quota')
        ? 'YouTube’s daily search limit is used up; the background finder will catch this song tonight.'
        : `YouTube error ${res.status}.`,
    };
  }
  const json = await res.json();
  const candidates: Candidate[] = (json.items ?? [])
    .map((it: any) => ({ videoId: it.id?.videoId, title: it.snippet?.title ?? '', channel: it.snippet?.channelTitle ?? '' }))
    .filter((c: Candidate) => c.videoId);
  const audioId = pickAudio(track.artist, track.title, candidates);

  await db()
    .from('tracks')
    .update({
      yt_audio_id: audioId,
      yt_audio_status: audioId ? 'found' : 'none',
      yt_audio_source: 'youtube-search',
      yt_audio_checked_at: new Date().toISOString(),
    })
    .eq('id', track.id);
  return { audioId, message: audioId ? undefined : 'No YouTube version of this song was found.' };
}

export type FindResult = { checked: number; found: number; message: string };

export async function findVideosWithSearch(limit: number): Promise<FindResult> {
  const token = await getAccessToken('youtube');

  const { data, error } = await db()
    .from('tracks')
    .select('id, title, artist')
    .is('video_status', null)
    .order('created_at')
    .limit(limit);
  if (error) throw new Error(`${error.message} (did you re-run schema.sql?)`);

  let checked = 0;
  let found = 0;
  for (const track of data ?? []) {
    const params = new URLSearchParams({
      part: 'snippet',
      q: `${primaryArtist(track.artist)} ${track.title}`,
      type: 'video',
      videoCategoryId: '10',
      maxResults: '5',
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      const reason = text.includes('quota')
        ? 'YouTube daily quota used up; the rest will continue tomorrow.'
        : `YouTube ${res.status}: ${text.slice(0, 150)}`;
      return { checked, found, message: `Checked ${checked}, found ${found} videos. Stopped: ${reason}` };
    }
    const json = await res.json();
    const candidates: Candidate[] = (json.items ?? []).map((it: any) => ({
      videoId: it.id?.videoId,
      title: it.snippet?.title ?? '',
      channel: it.snippet?.channelTitle ?? '',
    }));
    const videoId = pickVideo(track.artist, track.title, candidates.filter((c) => c.videoId));

    await db()
      .from('tracks')
      .update({
        video_id: videoId,
        video_status: videoId ? 'found' : 'none',
        video_source: 'youtube-search',
        video_checked_at: new Date().toISOString(),
      })
      .eq('id', track.id);
    checked++;
    if (videoId) found++;
  }
  return {
    checked,
    found,
    message: checked === 0 ? 'Every song has already been checked.' : `Checked ${checked} songs, found ${found} music videos.`,
  };
}
