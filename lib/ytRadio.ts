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
};

function toMs(text?: string): number | null {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

function parseItem(raw: any): RadioSong | null {
  const r = raw?.playlistPanelVideoRenderer ?? raw?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
  if (!r?.videoId) return null;
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
