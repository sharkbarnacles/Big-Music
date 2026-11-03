// A YouTube Music "radio" from any song: about 50 songs like it, and more as
// you go. Uses the same request the YouTube Music website makes (no login,
// unofficial, the same approach as the ytmusicapi library). If YouTube
// changes it, this is the one file to fix.

const ENDPOINT = 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false';
const CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251015.03.00', hl: 'en', gl: 'US' } };

export type RadioSong = {
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  image: string | null;
  durationMs: number | null;
  // YouTube Music pairs a song's studio audio ("song") with its music video.
  audioId: string | null; // the studio audio, if YouTube Music knows one
  mvId: string | null; // the music video (official or fan upload), if any
};

const VIDEO_TYPES = /MUSIC_VIDEO_TYPE_(OMV|UGC|OFFICIAL_SOURCE_MUSIC)/;
const typeOf = (r: any): string =>
  r?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? '';

function toMs(text?: string): number | null {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

function parseItem(raw: any): RadioSong | null {
  const r = raw?.playlistPanelVideoRenderer ?? raw?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
  if (!r?.videoId) return null;
  // The other version of the same song (audio ↔ video), when there is one.
  const other = raw?.playlistPanelVideoWrapperRenderer?.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer;
  const isVideo = VIDEO_TYPES.test(typeOf(r));
  const otherIsVideo = other?.videoId ? VIDEO_TYPES.test(typeOf(other)) : false;
  let audioId: string | null = isVideo ? null : r.videoId;
  let mvId: string | null = isVideo ? r.videoId : null;
  if (other?.videoId) {
    if (otherIsVideo && !mvId) mvId = other.videoId;
    if (!otherIsVideo && !audioId) audioId = other.videoId;
  }
  // The line under the title reads "Artist • Album • 2019" for songs,
  // or "Artist • 12M views • 80K likes" for videos.
  const byline: string = (r.longBylineText?.runs ?? []).map((x: any) => x.text).join('');
  const parts = byline.split(' • ').map((s) => s.trim());
  const album = parts[1] && !/views|likes|plays/i.test(parts[1]) && !/^\d{4}$/.test(parts[1]) ? parts[1] : null;
  const thumbs = r.thumbnail?.thumbnails ?? [];
  let image: string | null = thumbs.length ? thumbs[thumbs.length - 1].url : null;
  if (image) image = image.replace(/=w\d+-h\d+/, '=w400-h400');
  return {
    videoId: r.videoId,
    title: r.title?.runs?.[0]?.text ?? 'Unknown song',
    artist: parts[0] || 'Unknown artist',
    album,
    image,
    durationMs: toMs(r.lengthText?.runs?.[0]?.text),
    audioId,
    mvId,
  };
}

export async function fetchRadio(opts: { videoId?: string; continuation?: string }): Promise<{ songs: RadioSong[]; continuation: string | null }> {
  const body: Record<string, unknown> = { context: CONTEXT, enablePersistentPlaylistPanel: true, isAudioOnly: true };
  if (opts.continuation) body.continuation = opts.continuation;
  else if (opts.videoId) {
    body.videoId = opts.videoId;
    body.playlistId = `RDAMVM${opts.videoId}`;
    body.tunerSettingValue = 'AUTOMIX_SETTING_NORMAL';
  } else throw new Error('No song to start the radio from.');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://music.youtube.com',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`YouTube Music radio didn’t answer (${res.status}).`);
  const data = await res.json();
  const panel = opts.continuation
    ? data?.continuationContents?.playlistPanelContinuation
    : data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
  if (!panel) throw new Error('YouTube Music sent a radio the hub couldn’t read.');
  const songs = (panel.contents ?? []).map(parseItem).filter((s: RadioSong | null): s is RadioSong => s !== null);
  const next = panel.continuations?.[0]?.nextRadioContinuationData?.continuation ?? null;
  return { songs, continuation: next };
}

// Both versions of one song: asks for a radio from it and reads the first
// entry, which is the song itself with its counterpart.
export async function fetchVersions(videoId: string): Promise<{ audioId: string | null; mvId: string | null }> {
  const { songs } = await fetchRadio({ videoId });
  const me = songs.find((s) => s.videoId === videoId || s.audioId === videoId || s.mvId === videoId);
  return { audioId: me?.audioId ?? null, mvId: me?.mvId ?? null };
}

// When a song only exists as a music video on YouTube (a fan or channel
// upload), look for its studio version with a YouTube Music "songs" search.
// Only a result whose name appears in the video's title is accepted, so a
// wrong song is never swapped in.
const SEARCH_ENDPOINT = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
const norm = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

export async function searchStudioSong(title: string, artist: string): Promise<string | null> {
  const clean = title
    .replace(/[\[(（【][^\])）】]*[\])）】]/g, ' ')
    .replace(/\b(official|music|video|mv|m\/v|lyrics?|audio|hd|4k)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const res = await fetch(SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://music.youtube.com',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
    body: JSON.stringify({ context: CONTEXT, query: `${clean} ${artist}`.trim(), params: SONGS_FILTER }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const sections =
    data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const items: any[] = sections.flatMap((s: any) => s?.musicShelfRenderer?.contents ?? []);
  const whole = norm(title);
  for (const it of items.slice(0, 5)) {
    const r = it?.musicResponsiveListItemRenderer;
    const id = r?.playlistItemData?.videoId;
    const name: string = r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
    const n = norm(name);
    if (id && n.length >= 2 && (whole.includes(n) || n.includes(norm(clean)))) return id;
  }
  return null;
}
