// Shared by /api/radio/prompt (start) and /api/radio (more, for tokens "p:…").
import type { TrackRowData } from './tracks';
import { decodeState, encodeState, promptRadio, type PromptState } from './promptRadio';
import { appendToRadioEdition, createRadioEdition } from './radioEditions';
import { toPlayable } from './webTracks';

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
  const batch = await promptRadio(q, state);
  const tracks = applyMode(await toPlayable(batch.songs), opts.mode);
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
