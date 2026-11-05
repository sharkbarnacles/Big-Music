// A radio from a whole playlist: YouTube Music radios from several of its
// songs at once, woven together (one from each in turn), leaving out the
// playlist's own songs so everything is "more like this". Each round uses
// five songs not used yet; when every song has been used it starts over.
// Continuations are "pl:<state>" tokens handled by /api/radio.
import { db, fetchAllRows } from './db';
import { RADIO_SIZE, toRadioTracks, type RadioMode } from './radioTracks';
import type { TrackRowData } from './tracks';
import { fetchRadio, type RadioSong } from './ytRadio';

type State = { p: string; u: string[] }; // playlist id, seed songs used so far
const SEEDS_PER_ROUND = 5;

export const encodePlaylistState = (s: State) => 'pl:' + Buffer.from(JSON.stringify(s)).toString('base64url');
export function decodePlaylistState(token: string): State | null {
  try {
    const s = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    return typeof s?.p === 'string' && Array.isArray(s.u) ? { p: s.p, u: s.u.map(String) } : null;
  } catch {
    return null;
  }
}

function shuffled<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function playlistRadio(opts: { playlistId?: string; token?: string; mode: RadioMode }) {
  const state = opts.token ? decodePlaylistState(opts.token) : null;
  const playlistId = state?.p ?? opts.playlistId ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(playlistId)) throw new Error('That playlist wasn’t found.');

  const [{ data: playlist }, { rows }] = await Promise.all([
    db().from('playlists').select('id, name').eq('id', playlistId).maybeSingle(),
    fetchAllRows<{ tracks: { id: string; yt_audio_id: string | null; video_id: string | null } | null }>((from, to) =>
      db().from('playlist_items').select('tracks(id, yt_audio_id, video_id)').eq('playlist_id', playlistId).range(from, to),
    ),
  ]);
  if (!playlist) throw new Error('That playlist wasn’t found.');
  const songs = rows.map((r) => r.tracks).filter(Boolean) as { id: string; yt_audio_id: string | null; video_id: string | null }[];
  const skip = new Set<string>(songs.flatMap((t) => [t.id, t.yt_audio_id, t.video_id].filter(Boolean) as string[]));
  const pool = [...new Set(songs.map((t) => t.yt_audio_id).filter(Boolean) as string[])];
  if (!pool.length) throw new Error('None of this playlist’s songs have a YouTube version yet, so a radio can’t start.');

  let used = state?.u ?? [];
  const libSeen = { n: 0 };
  const out: TrackRowData[] = [];
  const have = new Set<string>();
  const target = state ? 25 : RADIO_SIZE; // a fresh radio starts with 50; each top-up adds about 25

  for (let round = 0; round < 3 && out.length < target; round++) {
    let left = pool.filter((v) => !used.includes(v));
    if (!left.length) {
      used = [];
      left = pool;
    }
    const seeds = shuffled(left).slice(0, SEEDS_PER_ROUND);
    used = [...used, ...seeds].slice(-200);
    const lists = await Promise.allSettled(seeds.map((videoId) => fetchRadio({ videoId })));
    const radios = lists.flatMap((r) => (r.status === 'fulfilled' ? [r.value.songs] : []));
    // One from each radio in turn, so no single song's radio takes over.
    const woven: RadioSong[] = [];
    const seen = new Set<string>();
    for (let i = 0; radios.some((l) => i < l.length); i++) {
      for (const l of radios) {
        const s = l[i];
        if (s && !seen.has(s.videoId)) {
          seen.add(s.videoId);
          woven.push(s);
        }
      }
    }
    const tracks = await toRadioTracks(woven, opts.mode, skip, libSeen);
    for (const t of tracks) {
      const k = t.yt_audio_id ?? t.id;
      if (have.has(k)) continue;
      have.add(k);
      out.push(t);
    }
    if (pool.length <= SEEDS_PER_ROUND && round > 0) break; // a tiny playlist: no new seeds left to try
  }
  return {
    name: playlist.name as string,
    tracks: out.slice(0, target),
    continuation: encodePlaylistState({ p: playlistId, u: used }),
  };
}
