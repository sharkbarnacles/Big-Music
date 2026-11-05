// Shared by /api/radio/prompt (start) and /api/radio (more, for tokens "p:…").
import type { TrackRowData } from './tracks';
import { decodeState, encodeState, promptRadio, type PromptState } from './promptRadio';
import { appendToRadioEdition, createRadioEdition } from './radioEditions';
import { toPlayable } from './webTracks';
import { db } from './db';
import { TRACK_COLUMNS } from './tracks';
import { RADIO_SIZE } from './radioTracks';

type Mode = 'familiar' | 'mixed' | 'new';

// Familiar = everything; Mixed = about one in three from your library; New = none.
function applyMode(tracks: TrackRowData[], mode: Mode) {
  if (mode === 'familiar') return tracks;
  let lib = 0;
  return tracks.filter((t) => {
    const mine = !t.id.startsWith('yt:');
    if (!mine) return true;
    if (mode === 'new') return false;
    return lib++ % 3 === 0;
  });
}

export async function runPromptRadio(opts: { q?: string; token?: string; mode: Mode; editionId?: string | null }) {
  const state: PromptState | null = opts.token ? decodeState(opts.token) : null;
  const q = state?.q ?? (opts.q ?? '').trim().slice(0, 150);
  if (!q) throw new Error('Type a genre, mood or artist first.');
  let batch = await promptRadio(q, state);
  let tracks = applyMode(await toPlayable(batch.songs), opts.mode);
  // Familiar / Mixed: weave in a few of your own songs by artists from this batch you love.
  if (opts.mode !== 'new' && batch.liked.length) {
    const { data: ids } = await db().rpc('library_tracks_for_artists', { keys: batch.liked, per_artist: opts.mode === 'familiar' ? 3 : 1 });
    const have = new Set(tracks.map((t) => t.id));
    const idList = ((ids as any[]) ?? []).map((r) => r.id).filter((id: string) => !have.has(id)).slice(0, opts.mode === 'familiar' ? 20 : 8);
    if (idList.length) {
      const { data: mine } = await db().from('tracks').select(TRACK_COLUMNS).in('id', idList);
      const own = ((mine as any[]) ?? []) as TrackRowData[];
      const every = opts.mode === 'familiar' ? 3 : 5;
      const out: TrackRowData[] = [];
      tracks.forEach((t, i) => {
        out.push(t);
        if (i % every === every - 1 && own.length) out.push(own.shift()!);
      });
      tracks = [...out, ...own];
    }
  }
  // A new radio starts with 50 songs: ask for more batches until there are.
  if (!state) {
    const have = new Set(tracks.map((t) => t.yt_audio_id ?? t.id));
    for (let round = 0; round < 2 && tracks.length < RADIO_SIZE && batch.state && batch.songs.length; round++) {
      batch = await promptRadio(q, batch.state);
      for (const t of applyMode(await toPlayable(batch.songs), opts.mode)) {
        const k = t.yt_audio_id ?? t.id;
        if (!have.has(k)) {
          have.add(k);
          tracks.push(t);
        }
      }
    }
    tracks = tracks.slice(0, RADIO_SIZE);
  }
  const continuation = batch.state && batch.songs.length ? encodeState(batch.state) : null;
  let editionId = opts.editionId ?? null;
  if (!state && tracks.length) {
    const first = tracks[0];
    editionId = await createRadioEdition({ title: first.title, artist: first.artist, videoId: first.yt_audio_id ?? '', label: q }, tracks).catch(() => null);
  } else if (editionId && tracks.length) {
    await appendToRadioEdition(editionId, tracks).catch(() => {});
  }
  return { tracks, continuation, editionId };
}
