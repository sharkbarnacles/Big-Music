import { getAccessToken } from '../connections';
import { db } from '../db';
import {
  cleanupOrphans,
  newestDate,
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

// Spotify asked us to wait a long time (minutes or hours). `until` is when we may ask again.
export class SpotifyPaused extends Error {
  constructor(public until: Date) {
    super('Spotify asked the hub to wait before importing more.');
  }
}

// Keep a slow pace (about 1 request a second) so Spotify doesn't put the
// app on a long time-out. A time-out blocks playback in Spotify mode too
// (it happened twice with a big library at ~3 requests a second).
const MIN_GAP_MS = 1000;
let lastCallAt = 0;
async function pace() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

// One API call, waiting and retrying if Spotify says "slow down" (HTTP 429).
async function call(token: string, pathOrUrl: string): Promise<any> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    await pace();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2;
      // Anything but a short wait: stop and leave Spotify alone for at least an
      // hour, so playing music in Spotify mode isn't blocked by the import.
      if (wait > 10) throw new SpotifyPaused(new Date(Date.now() + Math.max(wait, 3600) * 1000));
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

// ── Importing in rounds ───────────────────────────────────────────────
// Vercel stops any request after 5 minutes, and a big library (thousands of
// playlists) takes longer than that. So each request does one "round" of
// about 4 minutes, saves where it got to in `import_progress`, and the
// Import button asks for the next round until everything is done. If the
// phone sleeps in between, pressing Import again carries on from there.
//
// Unchanged playlists are skipped: Spotify gives every playlist a
// `snapshot_id` that changes whenever its songs change. We store it, and
// next time only fetch songs for playlists whose snapshot is different.

const ROUND_MS = 240_000; // stop starting new playlists after 4 minutes
const PLAYBACK_QUIET_MS = 3 * 60 * 60 * 1000; // no importing within 3 h of Spotify-mode playback
const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // an unfinished import older than a week starts over

export type RoundResult = ImportSummary & {
  done: boolean;
  paused?: boolean; // Spotify asked us to wait; carries on by itself after `blockedUntil`
  blockedUntil?: string | null;
  total: number; // playlists on Spotify (plus Liked Songs)
  processed: number; // how many of them are done so far
  unchanged: number;
};

type Progress = {
  next_offset: number;
  total: number;
  playlists: number;
  unchanged: number;
  songs: number;
  excluded: number;
  skipped: { name: string; reason: string }[];
  done: boolean;
  blocked_until?: string | null;
  updated_at: string;
};

async function loadProgress(): Promise<Progress | null> {
  const { data } = await db().from('import_progress').select('*').eq('service', 'spotify').maybeSingle();
  return (data as Progress | null) ?? null;
}

async function saveProgress(p: Omit<Progress, 'updated_at'>, fresh: boolean) {
  const row: Record<string, unknown> = { service: 'spotify', ...p, updated_at: new Date().toISOString() };
  if (fresh) row.started_at = new Date().toISOString();
  const { error } = await db().from('import_progress').upsert(row, { onConflict: 'service' });
  if (error) throw new Error(`Saving import progress failed: ${error.message} (did you re-run schema.sql?)`);
}

async function setSnapshot(externalId: string, snapshot: string) {
  await db().from('source_playlists').update({ snapshot }).eq('service', 'spotify').eq('external_id', externalId);
}

// Saves the playlist if you've chosen to include it (Spotify playlists are
// included unless you untick them on the "Choose playlists" page).
async function keepOrSkip(meta: PlaylistMeta, tracks: ImportedTrack[], prog: Progress) {
  const decision = await recordSource('spotify', meta.externalId, meta.name, tracks.length, 1);
  if (!decision.include) {
    await removePlaylist('spotify', meta.externalId);
    prog.excluded++;
    return;
  }
  prog.songs += await savePlaylist(meta, tracks);
  prog.playlists++;
}

// Liked Songs has no snapshot, so "how many songs + newest date" stands in for one.
async function importLiked(token: string, prog: Progress) {
  const first = await call(token, '/me/tracks?limit=1');
  const snapshot = `${first.total ?? 0}|${first.items?.[0]?.added_at ?? ''}`;
  const [{ data: src }, { data: row }] = await Promise.all([
    db().from('source_playlists').select('snapshot').eq('service', 'spotify').eq('external_id', 'liked').maybeSingle(),
    db().from('playlists').select('id').eq('service', 'spotify').eq('external_id', 'liked').maybeSingle(),
  ]);
  if (src?.snapshot === snapshot && row) {
    prog.unchanged++;
    return;
  }
  const likedItems = await collect(token, '/me/tracks?limit=50');
  const liked = likedItems.map((item) => toTrack(item.track)).filter((t): t is ImportedTrack => t !== null);
  await keepOrSkip(
    { service: 'spotify', externalId: 'liked', name: 'Liked Songs (Spotify)', lastAddedAt: newestDate(likedItems.map((it) => it.added_at)) },
    liked,
    prog,
  );
  await setSnapshot('liked', snapshot);
}

async function importOne(token: string, p: any, prog: Progress) {
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
  const tracks = items.map((it) => toTrack(it.item ?? it.track)).filter((t): t is ImportedTrack => t !== null);
  await keepOrSkip(
    {
      service: 'spotify',
      externalId: p.id,
      name: p.name || 'Untitled playlist',
      description: p.description || null,
      imageUrl: p.images?.[0]?.url ?? null,
      lastAddedAt: newestDate(items.map((it) => it.added_at)),
    },
    tracks,
    prog,
  );
  if (p.snapshot_id) await setSnapshot(p.id, p.snapshot_id);
}

// Runs one round. `next_offset` counts Liked Songs as 0 and playlist n as n+1.
export async function importSpotify(): Promise<RoundResult> {
  const began = Date.now();
  const token = await getAccessToken('spotify');

  const saved = await loadProgress();
  // Still inside Spotify's time-out: don't ask again (that can make it longer).
  if (saved && !saved.done && saved.blocked_until && Date.parse(saved.blocked_until) > Date.now()) {
    return {
      service: 'spotify', playlists: saved.playlists, songs: saved.songs, excluded: saved.excluded,
      skipped: saved.skipped ?? [], unchanged: saved.unchanged, done: false, total: saved.total,
      processed: saved.next_offset, paused: true, blockedUntil: saved.blocked_until,
    };
  }
  // Music is playing (or played recently) through Spotify: playback comes
  // first, so the import waits until Spotify mode has been idle for 3 hours.
  const { data: qs } = await db().from('spotify_queue_state').select('updated_at').eq('id', 1).maybeSingle();
  const playedAt = qs?.updated_at ? Date.parse(qs.updated_at) : 0;
  if (saved && !saved.done && Date.now() - playedAt < PLAYBACK_QUIET_MS) {
    return {
      service: 'spotify', playlists: saved.playlists, songs: saved.songs, excluded: saved.excluded,
      skipped: saved.skipped ?? [], unchanged: saved.unchanged, done: false, total: saved.total,
      processed: saved.next_offset, paused: true, blockedUntil: new Date(playedAt + PLAYBACK_QUIET_MS).toISOString(),
    };
  }
  const resume = saved && !saved.done && Date.now() - Date.parse(saved.updated_at) < RESUME_WINDOW_MS;
  const prog: Progress = resume
    ? { ...saved!, skipped: saved!.skipped ?? [] }
    : { next_offset: 0, total: 0, playlists: 0, unchanged: 0, songs: 0, excluded: 0, skipped: [], done: false, updated_at: '' };
  prog.blocked_until = null;
  const fresh = !resume;
  const result = (): RoundResult => ({
    service: 'spotify',
    playlists: prog.playlists,
    songs: prog.songs,
    excluded: prog.excluded,
    skipped: prog.skipped,
    unchanged: prog.unchanged,
    done: prog.done,
    total: prog.total,
    processed: prog.done ? prog.total : prog.next_offset,
  });
  if (fresh) await saveProgress(toSaveOf(prog), true);

  try {
    if (prog.next_offset === 0) {
      await importLiked(token, prog);
      prog.next_offset = 1;
    }

    while (true) {
      const offset = prog.next_offset - 1; // position in Spotify's playlist list
      const page = await call(token, `/me/playlists?limit=50&offset=${offset}`);
      prog.total = (page.total ?? 0) + 1;
      const list: any[] = (page.items ?? []).filter((p: any) => p?.id);
      if ((page.items ?? []).length === 0) break;

      // What we already know about this page's playlists, in two queries.
      const ids = list.map((p) => p.id);
      const [{ data: srcRows }, { data: plRows }] = await Promise.all([
        db().from('source_playlists').select('external_id, snapshot, user_choice').eq('service', 'spotify').in('external_id', ids),
        db().from('playlists').select('external_id').eq('service', 'spotify').in('external_id', ids),
      ]);
      const src = new Map<string, any>((srcRows ?? []).map((r: any) => [r.external_id as string, r] as [string, any]));
      const have = new Set<string>((plRows ?? []).map((r: any) => r.external_id as string));

      // Unchanged and already in the hub (or deliberately left out): just mark them as seen.
      const unchanged = list.filter((p) => {
        const r: any = src.get(p.id);
        if (!r || !p.snapshot_id || r.snapshot !== p.snapshot_id) return false;
        return r.user_choice === false || have.has(p.id);
      });
      const unchangedIds = new Set(unchanged.map((p) => p.id));
      if (unchanged.length) {
        await db()
          .from('source_playlists')
          .upsert(
            unchanged.map((p) => ({
              service: 'spotify',
              external_id: p.id,
              name: p.name || 'Untitled playlist',
              item_count: p.items?.total ?? p.tracks?.total ?? 0,
              music_ratio: 1,
              last_seen: new Date().toISOString(),
            })),
            { onConflict: 'service,external_id' },
          );
      }

      for (let i = 0; i < (page.items ?? []).length; i++) {
        const p = page.items[i];
        if (Date.now() - began > ROUND_MS) {
          await saveProgress(toSaveOf(prog), false);
          return result();
        }
        prog.next_offset = offset + i + 2; // counts this one as done once handled
        if (!p?.id) continue;
        if (unchangedIds.has(p.id)) {
          prog.unchanged++;
          continue;
        }
        try {
          await importOne(token, p, prog);
        } catch (err) {
          if (err instanceof SpotifyPaused || (err instanceof SpotifyError && err.status === 429)) {
            prog.next_offset = offset + i + 1; // try this one again next round
            throw err;
          }
          // Spotify blocks some playlists (e.g. its own "Discover Weekly") for developer apps.
          const reason =
            err instanceof SpotifyError && (err.status === 403 || err.status === 404)
              ? 'Spotify does not let apps read this playlist'
              : (err as Error).message;
          prog.skipped.push({ name: p.name ?? p.id, reason });
        }
      }
      if (!page.next) break;
    }

    prog.done = true;
    await cleanupOrphans();
    await saveProgress(toSaveOf(prog), false);
    return result();
  } catch (err) {
    if (err instanceof SpotifyPaused) {
      prog.blocked_until = err.until.toISOString();
      await saveProgress(toSaveOf(prog), false).catch(() => {});
      return { ...result(), paused: true, blockedUntil: prog.blocked_until };
    }
    // Keep what was done so pressing Import again carries on from here.
    await saveProgress(toSaveOf(prog), false).catch(() => {});
    throw err;
  }
}

function toSaveOf(p: Progress): Omit<Progress, 'updated_at'> {
  const { updated_at: _u, ...rest } = p;
  void _u;
  return rest;
}
