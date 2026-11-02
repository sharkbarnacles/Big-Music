import { getAccessToken } from '../connections';
import {
  cleanupOrphans,
  recordSource,
  removePlaylist,
  savePlaylist,
  type ImportedTrack,
  type ImportSummary,
  type PlaylistMeta,
} from '../library';

const API = 'https://api.spotify.com/v1';

class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// One API call, waiting and retrying if Spotify says "slow down" (HTTP 429).
async function call(token: string, pathOrUrl: string): Promise<any> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new SpotifyError(res.status, `Spotify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new SpotifyError(429, 'Spotify kept asking us to slow down; try again in a few minutes.');
}

// Follows Spotify's "next page" links until every item is collected.
async function collect(token: string, firstPath: string): Promise<any[]> {
  const all: any[] = [];
  let next: string | null = firstPath;
  while (next) {
    const page: any = await call(token, next);
    all.push(...(page.items ?? []));
    next = page.next ?? null;
  }
  return all;
}

function toTrack(t: any): ImportedTrack | null {
  // Skip podcasts, local files and songs no longer available.
  if (!t || t.type !== 'track' || t.is_local || !t.id) return null;
  return {
    service: 'spotify',
    externalId: t.id,
    url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    title: t.name,
    artist: (t.artists ?? []).map((a: any) => a.name).join(', ') || 'Unknown artist',
    album: t.album?.name ?? null,
    durationMs: t.duration_ms ?? null,
    isrc: t.external_ids?.isrc ?? null,
    imageUrl: t.album?.images?.[0]?.url ?? null,
  };
}

// Saves the playlist if you've chosen to include it (Spotify playlists are
// included unless you untick them on the "Choose playlists" page).
async function keepOrSkip(meta: PlaylistMeta, tracks: ImportedTrack[], summary: ImportSummary) {
  const decision = await recordSource('spotify', meta.externalId, meta.name, tracks.length, 1);
  if (!decision.include) {
    await removePlaylist('spotify', meta.externalId);
    summary.excluded++;
    return;
  }
  summary.songs += await savePlaylist(meta, tracks);
  summary.playlists++;
}

export async function importSpotify(): Promise<ImportSummary> {
  const token = await getAccessToken('spotify');
  const summary: ImportSummary = { service: 'spotify', playlists: 0, songs: 0, excluded: 0, skipped: [] };

  // 1. Liked Songs, saved as its own playlist.
  const liked = (await collect(token, '/me/tracks?limit=50'))
    .map((item) => toTrack(item.track))
    .filter((t): t is ImportedTrack => t !== null);
  await keepOrSkip({ service: 'spotify', externalId: 'liked', name: 'Liked Songs (Spotify)' }, liked, summary);

  // 2. Every playlist you made or follow.
  const playlists = await collect(token, '/me/playlists?limit=50');
  for (const p of playlists) {
    if (!p?.id) continue;
    try {
      // Spotify renamed this endpoint in Feb 2026 (/tracks → /items) and the
      // song may arrive as `item` or `track`, so we accept both, and fall back
      // to the old address if the new one isn't found.
      let items: any[];
      try {
        items = await collect(token, `/playlists/${p.id}/items?limit=50`);
      } catch (err) {
        if (!(err instanceof SpotifyError && err.status === 404)) throw err;
        items = await collect(token, `/playlists/${p.id}/tracks?limit=50`);
      }
      const tracks = items
        .map((it) => toTrack(it.item ?? it.track))
        .filter((t): t is ImportedTrack => t !== null);
      await keepOrSkip(
        {
          service: 'spotify',
          externalId: p.id,
          name: p.name || 'Untitled playlist',
          description: p.description || null,
          imageUrl: p.images?.[0]?.url ?? null,
        },
        tracks,
        summary,
      );
    } catch (err) {
      // Spotify blocks some playlists (e.g. its own "Discover Weekly") for developer apps.
      const reason =
        err instanceof SpotifyError && (err.status === 403 || err.status === 404)
          ? 'Spotify does not let apps read this playlist'
          : (err as Error).message;
      summary.skipped.push({ name: p.name ?? p.id, reason });
    }
  }
  await cleanupOrphans();
  return summary;
}
