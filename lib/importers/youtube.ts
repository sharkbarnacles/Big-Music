import { getAccessToken } from '../connections';
import { chunk, db } from '../db';
import {
  cleanupOrphans,
  recordSource,
  removePlaylist,
  savePlaylist,
  type ImportedTrack,
  type ImportSummary,
  type PlaylistMeta,
} from '../library';

// Uses the official YouTube Data API. YouTube Music playlists you create are
// regular YouTube playlists behind the scenes, so all your playlists show up.
// To keep only MUSIC, every video's category is checked: category 10 = Music.
// Daily quota is 10,000 "units"; each page of 50 items costs 1 unit,
// so even a big library uses only a few hundred.

const API = 'https://www.googleapis.com/youtube/v3';
const MUSIC_CATEGORY = '10';

async function call(token: string, path: string, params: Record<string, string>): Promise<any> {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    if (text.includes('quotaExceeded')) throw new Error('YouTube daily quota used up; try again tomorrow.');
    throw new Error(`YouTube ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function collect(token: string, path: string, params: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  let pageToken = '';
  do {
    const page = await call(token, path, { ...params, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return all;
}

// "PT3M45S" → 225000 milliseconds
export function parseDuration(iso: string | undefined): number | null {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

// Removes "(Official Video)", "[Lyrics]", "| Live at …" and similar from titles.
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\(\[][^\)\]]*\b(official|lyrics?|audio|video|visualizer|mv|m\/v|hd|4k|hq)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\|.*$/, '')
    .trim();
}

// "Artist - Topic" channels hold YouTube Music's audio-only song uploads.
export function isTopicChannel(channel: string): boolean {
  return /\s-\sTopic$/i.test(channel);
}

// YouTube has no "artist" field, so we work it out:
//  - "Artist - Topic" channels are YouTube Music's official song uploads.
//  - Otherwise many titles look like "Artist - Song".
//  - Otherwise fall back to the channel name.
export function guessArtistAndTitle(rawTitle: string, channel: string): { artist: string; title: string } {
  if (isTopicChannel(channel)) {
    return { artist: channel.replace(/\s-\sTopic$/i, '').trim(), title: cleanTitle(rawTitle) };
  }
  const dash = rawTitle.indexOf(' - ');
  if (dash > 0) {
    return { artist: rawTitle.slice(0, dash).trim(), title: cleanTitle(rawTitle.slice(dash + 3)) };
  }
  return { artist: channel.replace(/\s*VEVO$/i, '').trim() || 'Unknown artist', title: cleanTitle(rawTitle) };
}

function thumb(snippet: any): string | null {
  const t = snippet?.thumbnails;
  return t?.medium?.url ?? t?.high?.url ?? t?.default?.url ?? null;
}

type VideoInfo = { categoryId: string | null; durationMs: number | null };

// A video counts as music if it's in the Music category or from a Topic channel.
function isMusic(info: VideoInfo | undefined, channel: string): boolean {
  return info?.categoryId === MUSIC_CATEGORY || isTopicChannel(channel);
}

function toTrack(videoId: string, snippet: any, channel: string, info: VideoInfo | undefined): ImportedTrack {
  const { artist, title } = guessArtistAndTitle(snippet.title ?? '', channel);
  // A music upload that isn't audio-only is a video of the song.
  const isVideo = info?.categoryId === MUSIC_CATEGORY && !isTopicChannel(channel);
  return {
    service: 'youtube',
    externalId: videoId,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    title: title || snippet.title || 'Untitled',
    artist,
    durationMs: info?.durationMs ?? null,
    imageUrl: thumb(snippet),
    musicVideoId: isVideo ? videoId : null,
  };
}

// Looks up category and length, 50 videos per request (1 quota unit each).
async function videoInfo(token: string, ids: string[]): Promise<Map<string, VideoInfo>> {
  const out = new Map<string, VideoInfo>();
  for (const part of chunk([...new Set(ids)], 50)) {
    const page = await call(token, 'videos', { part: 'snippet,contentDetails', id: part.join(','), maxResults: '50' });
    for (const v of page.items ?? []) {
      out.set(v.id, {
        categoryId: v.snippet?.categoryId ?? null,
        durationMs: parseDuration(v.contentDetails?.duration),
      });
    }
  }
  return out;
}

type Entry = { videoId: string; snippet: any; channel: string };

// Decides whether to import, then keeps only music videos — unless you
// ticked the playlist yourself, in which case everything in it is kept.
async function keepOrSkip(
  meta: PlaylistMeta,
  entries: Entry[],
  info: Map<string, VideoInfo>,
  summary: ImportSummary,
) {
  const musicCount = entries.filter((e) => isMusic(info.get(e.videoId), e.channel)).length;
  const ratio = entries.length ? musicCount / entries.length : 0;
  const decision = await recordSource('youtube', meta.externalId, meta.name, entries.length, ratio);

  if (!decision.include) {
    await removePlaylist('youtube', meta.externalId);
    summary.excluded++;
    return;
  }
  const kept = decision.forced ? entries : entries.filter((e) => isMusic(info.get(e.videoId), e.channel));
  const tracks = kept.map((e) => toTrack(e.videoId, e.snippet, e.channel, info.get(e.videoId)));
  summary.songs += await savePlaylist(meta, tracks);
  summary.playlists++;
}

export async function importYouTube(): Promise<ImportSummary> {
  const token = await getAccessToken('youtube');
  const summary: ImportSummary = { service: 'youtube', playlists: 0, songs: 0, excluded: 0, skipped: [] };

  // 1. Liked videos (non-music likes are filtered out by keepOrSkip).
  const likedVideos = await collect(token, 'videos', { part: 'snippet,contentDetails', myRating: 'like' });
  const likedInfo = new Map<string, VideoInfo>();
  const likedEntries: Entry[] = likedVideos.map((v) => {
    likedInfo.set(v.id, { categoryId: v.snippet?.categoryId ?? null, durationMs: parseDuration(v.contentDetails?.duration) });
    return { videoId: v.id, snippet: v.snippet, channel: v.snippet?.channelTitle ?? '' };
  });
  await keepOrSkip(
    { service: 'youtube', externalId: 'liked', name: 'Liked Music (YouTube)' },
    likedEntries,
    likedInfo,
    summary,
  );

  // 2. Your playlists.
  const playlists = await collect(token, 'playlists', { part: 'snippet,contentDetails', mine: 'true' });
  for (const p of playlists) {
    try {
      const items = await collect(token, 'playlistItems', { part: 'snippet,contentDetails', playlistId: p.id });
      // Deleted or private videos have no owner channel; skip them.
      const entries: Entry[] = items
        .filter((it) => it.contentDetails?.videoId && it.snippet?.videoOwnerChannelTitle)
        .map((it) => ({
          videoId: it.contentDetails.videoId,
          snippet: it.snippet,
          channel: it.snippet.videoOwnerChannelTitle,
        }));
      const info = await videoInfo(token, entries.map((e) => e.videoId));
      await keepOrSkip(
        {
          service: 'youtube',
          externalId: p.id,
          name: p.snippet?.title || 'Untitled playlist',
          description: p.snippet?.description || null,
          imageUrl: thumb(p.snippet),
        },
        entries,
        info,
        summary,
      );
    } catch (err) {
      summary.skipped.push({ name: p.snippet?.title ?? p.id, reason: (err as Error).message });
    }
  }
  await cleanupOrphans();
  // Songs you have on YouTube can be played in YouTube mode right away.
  await db().rpc('fill_yt_audio_from_sources');
  return summary;
}
