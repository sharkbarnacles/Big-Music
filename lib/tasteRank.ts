// Puts your taste into radios made from a song or a playlist (owner,
// 2026-11-05: "everything should be with my taste in mind … help me branch
// out"). YouTube Music suggests the songs; this decides which stay and in
// what order:
//   + artists whose genres/tags match yours (the biggest part, so new
//     artists that fit rise, not just ones you already know)
//   + artists you like or that are close to ones you like (a smaller part)
//   + your languages (main > side branches), your vocal preferences
//   − artists you keep skipping, songs in languages you don't listen to,
//     filler (hour-long mixes, lofi beats, lyric re-uploads, nightcore…)
// YouTube's own order still counts a little so the radio keeps its flow, the
// worst-fitting sixth is dropped on bigger batches, and the same artist never
// plays twice within three songs. Unknown artists join the tagging queue so
// the next radios know them better.
import { affinity, artistKey, languageFit, loadProfiles, loadTaste, queueArtists, skipPenalty, songLanguage, tagFit, voiceFit } from './taste';
import { isRealSong } from './promptRadio';
import type { TrackRowData } from './tracks';

export async function tasteOrder(tracks: TrackRowData[], opts: { keepFirst?: boolean } = {}): Promise<TrackRowData[]> {
  if (tracks.length < 3) return tracks;
  const taste = await loadTaste().catch(() => null);
  if (!taste) return tracks;
  const keys = tracks.map((t) => artistKey(t.artist || ''));
  const profiles = await loadProfiles(keys).catch(() => new Map());

  const head = opts.keepFirst ? tracks.slice(0, 1) : [];
  const rest = opts.keepFirst ? tracks.slice(1) : tracks;
  const unknown: string[] = [];
  const scored = rest
    .map((t, i) => {
      const k = artistKey(t.artist || '');
      const p = profiles.get(k);
      if (!p && t.artist) unknown.push(t.artist);
      const real = isRealSong({
        videoId: '',
        title: t.title,
        artist: t.artist,
        album: null,
        image: null,
        durationMs: t.duration_ms ?? null,
        isVideo: false,
        release: 'unknown',
      });
      const lang = songLanguage(`${t.title} ${t.artist}`, p);
      const skip = skipPenalty(taste, t.artist || '');
      const score =
        1.1 * tagFit(taste, p) +
        0.7 * affinity(taste, t.artist || '') +
        languageFit(taste, lang) +
        0.35 * voiceFit(taste, lang, p) -
        1.6 * skip -
        (real ? 0 : 2) -
        0.012 * i; // YouTube's order, gently
      return { t, score, drop: !real || skip >= 0.8 };
    })
    .filter((x) => !x.drop);

  scored.sort((a, b) => b.score - a.score);
  const keep = scored.length > 12 ? scored.slice(0, Math.ceil(scored.length * (5 / 6))) : scored;

  // Spread artists out: no artist twice within three songs.
  const out: TrackRowData[] = [...head];
  const pending = keep.map((x) => x.t);
  while (pending.length) {
    const recent = out.slice(-3).map((t) => artistKey(t.artist || ''));
    const j = pending.findIndex((t) => !recent.includes(artistKey(t.artist || '')));
    out.push(...pending.splice(j >= 0 ? j : 0, 1));
  }
  if (unknown.length) queueArtists(unknown.slice(0, 40)).catch(() => {});
  return out;
}
