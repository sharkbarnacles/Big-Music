// Searching and browsing all of YouTube Music (not just your library): songs,
// artists, albums and playlists other people made. Uses the same requests the
// YouTube Music website makes (no login, no quota, unofficial — the same
// approach as the ytmusicapi library). If YouTube changes its answers, this is
// the file to fix; `scripts/probe_ytm.mjs` saves fresh real answers to look at.

const BASE = 'https://music.youtube.com/youtubei/v1/';
const CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251015.03.00', hl: 'en', gl: 'US' } };
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://music.youtube.com',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

// Search filters (from ytmusicapi).
const FILTER = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  community: 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=',
  featured: 'EgeKAQQoADgBagwQDhAKEAMQBBAJEAU=',
};

export type WebSong = {
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  image: string | null;
  durationMs: number | null;
  isVideo: boolean; // a music video or upload, not the studio audio
};
export type WebItem = {
  kind: 'playlist' | 'album' | 'artist';
  id: string; // VL…/MPRE…/UC…
  title: string;
  subtitle: string;
  image: string | null;
};
export type WebCollection = {
  kind: 'playlist' | 'album';
  id: string;
  title: string;
  subtitle: string; // "Playlist • 2026" / "Album • 2010"
  owner: string | null; // who made it, or the album's artist
  details: string; // "137 tracks • 7+ hours"
  image: string | null;
  songs: WebSong[];
};
export type WebArtist = {
  id: string;
  name: string;
  image: string | null;
  songs: WebSong[];
  shelves: { title: string; items: WebItem[] }[];
};

async function call(endpoint: 'search' | 'browse', body: Record<string, unknown>): Promise<any> {
  const res = await fetch(BASE + endpoint + '?prettyPrint=false', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ context: CONTEXT, ...body }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`YouTube Music didn’t answer (${res.status}).`);
  return res.json();
}

const text = (t: any): string => (t?.runs ?? []).map((r: any) => r.text).join('');
const VIDEO_TYPES = /MUSIC_VIDEO_TYPE_(OMV|UGC|OFFICIAL_SOURCE_MUSIC)/;

// Covers come small (120px) in lists; ask for one big enough for Now Playing.
// Lists shrink it again (lib/img.ts).
function bigImage(thumbs: any[] | undefined): string | null {
  const url: string | undefined = thumbs?.length ? thumbs[thumbs.length - 1].url : undefined;
  if (!url) return null;
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, '=w544-h544');
  if (/=s\d+/.test(url)) return url.replace(/=s\d+/, '=s544');
  const yt = url.match(/i\.ytimg\.com\/vi\/([\w-]+)\//);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`;
  return url;
}

function toMs(t: string | undefined): number | null {
  if (!t || !/^\d+(:\d+)+$/.test(t)) return null;
  return t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0) * 1000;
}

// One song row (search results, playlist and album pages, artist top songs).
function parseSong(r: any, fallbackArtist = '', fallbackImage: string | null = null, fallbackAlbum: string | null = null): WebSong | null {
  const videoId = r?.playlistItemData?.videoId ?? r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;
  const cols = (r.flexColumns ?? []).map((c: any) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const title = cols[0]?.map((x: any) => x.text).join('') || 'Unknown song';
  const line: any[] = cols[1] ?? [];
  const pageType = (x: any) => x?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
  const artists = line.filter((x) => /ARTIST|USER_CHANNEL/.test(pageType(x)) || /^UC/.test(x?.navigationEndpoint?.browseEndpoint?.browseId ?? '')).map((x) => x.text);
  const album = line.find((x) => /ALBUM/.test(pageType(x)))?.text ?? fallbackAlbum;
  // Without links, the first part of the line is the artist ("Song • Artist • …" in mixed results).
  const parts = line.map((x) => x.text).join('').split(' • ').map((s) => s.trim()).filter(Boolean);
  const plain = parts.find((p) => !/^(Song|Video|Episode)$/i.test(p) && !/views|plays|^\d+(:\d+)+$/i.test(p));
  const fixed = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
  const dur = fixed ?? parts.find((p) => /^\d+(:\d+)+$/.test(p));
  const type = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? '';
  return {
    videoId,
    title,
    artist: artists.join(', ') || plain || fallbackArtist || 'Unknown artist',
    album,
    image: bigImage(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ?? fallbackImage,
    durationMs: toMs(dur),
    isVideo: VIDEO_TYPES.test(type),
  };
}

function parseListItem(r: any, kind: WebItem['kind']): WebItem | null {
  const id = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (!id) return null;
  const cols = (r.flexColumns ?? []).map((c: any) => text(c?.musicResponsiveListItemFlexColumnRenderer?.text));
  return { kind, id, title: cols[0] ?? '', subtitle: cols.slice(1).join(' • '), image: bigImage(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) };
}

function kindOf(browseId: string): WebItem['kind'] | null {
  if (browseId.startsWith('VL')) return 'playlist';
  if (browseId.startsWith('MPRE')) return 'album';
  if (browseId.startsWith('UC')) return 'artist';
  return null;
}

function parseTwoRow(r: any): WebItem | null {
  const id = r?.navigationEndpoint?.browseEndpoint?.browseId;
  const kind = id ? kindOf(id) : null;
  if (!id || !kind) return null;
  return { kind, id, title: text(r.title), subtitle: text(r.subtitle), image: bigImage(r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails) };
}

function shelfItems(data: any): any[] {
  const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  return sections.flatMap((s: any) => s?.musicShelfRenderer?.contents ?? []).map((c: any) => c?.musicResponsiveListItemRenderer).filter(Boolean);
}

export type WebSearch = { songs: WebSong[]; artists: WebItem[]; albums: WebItem[]; playlists: WebItem[] };

export async function searchEverywhere(query: string): Promise<WebSearch> {
  const q = query.trim().slice(0, 150);
  const run = (params: string) => call('search', { query: q, params }).then(shelfItems).catch(() => [] as any[]);
  const [songs, artists, albums, community, featured] = await Promise.all([
    run(FILTER.songs),
    run(FILTER.artists),
    run(FILTER.albums),
    run(FILTER.community),
    run(FILTER.featured),
  ]);
  const seen = new Set<string>();
  const playlists = [...featured.slice(0, 4), ...community]
    .map((r) => parseListItem(r, 'playlist'))
    .filter((p): p is WebItem => Boolean(p) && !seen.has(p!.id) && Boolean(seen.add(p!.id)));
  return {
    songs: songs.map((r) => parseSong(r)).filter((s): s is WebSong => s !== null).slice(0, 20),
    artists: artists.map((r) => parseListItem(r, 'artist')).filter((a): a is WebItem => a !== null).slice(0, 6),
    albums: albums.map((r) => parseListItem(r, 'album')).filter((a): a is WebItem => a !== null).slice(0, 12),
    playlists: playlists.slice(0, 16),
  };
}

// A playlist ("VL…") or an album ("MPRE…"), with up to `max` songs.
export async function browseCollection(id: string, max = 500): Promise<WebCollection> {
  const kind: WebCollection['kind'] = id.startsWith('MPRE') ? 'album' : 'playlist';
  const data = await call('browse', { browseId: id });
  const two = data?.contents?.twoColumnBrowseResultsRenderer;
  const head = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
  if (!two || !head) throw new Error('YouTube Music sent a page the hub couldn’t read.');
  const title = text(head.title);
  const owner = text(head.straplineTextOne) || head.facepile?.avatarStackViewModel?.text?.content || null;
  const image = bigImage(head.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  const shelf = two.secondaryContents?.sectionListRenderer?.contents?.[0];
  const list = shelf?.musicPlaylistShelfRenderer ?? shelf?.musicShelfRenderer;
  let rows: any[] = list?.contents ?? [];
  const songs: WebSong[] = [];
  // Album rows have no artist or cover of their own: use the album's.
  const take = (items: any[]) => {
    for (const it of items) {
      const s = parseSong(it?.musicResponsiveListItemRenderer, kind === 'album' ? owner ?? '' : '', kind === 'album' ? image : null, kind === 'album' ? title : null);
      if (s) songs.push(s);
    }
  };
  take(rows);
  // Long playlists come 100 at a time.
  let token = rows[rows.length - 1]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  while (token && songs.length < max) {
    const more = await call('browse', { continuation: token }).catch(() => null);
    rows = more?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ?? [];
    if (!rows.length) break;
    take(rows);
    token = rows[rows.length - 1]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  }
  return { kind, id, title, subtitle: text(head.subtitle), owner, details: text(head.secondSubtitle), image, songs: songs.slice(0, max) };
}

export async function browseArtist(id: string): Promise<WebArtist> {
  const data = await call('browse', { browseId: id });
  const head = data?.header?.musicImmersiveHeaderRenderer ?? data?.header?.musicVisualHeaderRenderer;
  const name = text(head?.title) || 'Artist';
  const thumbs = head?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const image: string | null = thumbs?.length ? thumbs[thumbs.length - 1].url : null;
  const sections = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  let songs: WebSong[] = [];
  const shelves: WebArtist['shelves'] = [];
  for (const s of sections) {
    if (s.musicShelfRenderer && !songs.length) {
      songs = (s.musicShelfRenderer.contents ?? [])
        .map((c: any) => parseSong(c?.musicResponsiveListItemRenderer, name))
        .filter((x: WebSong | null): x is WebSong => x !== null);
    }
    const car = s.musicCarouselShelfRenderer;
    if (car) {
      const items = (car.contents ?? []).map((c: any) => parseTwoRow(c?.musicTwoRowItemRenderer)).filter((x: WebItem | null): x is WebItem => x !== null);
      if (items.length) shelves.push({ title: text(car.header?.musicCarouselShelfBasicHeaderRenderer?.title), items });
    }
  }
  return { id, name, image, songs, shelves };
}
