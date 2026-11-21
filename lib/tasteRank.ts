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
//
// Song radios pass `seed` (lib/seedRadio.ts, 2026-11-21): then the starting
// song leads and your taste only breaks ties — closeness in release years
// counts most, then sounding like the seed artist (shared genre tags) and the
// seed's language. Songs 5+ years away are dropped when 20+ songs within ±3
// years are there (7+ years away when 10+ are).
import { affinity, artistKey, languageFit, loadProfiles, loadTaste, NOT_STYLE, queueArtists, skipPenalty, songLanguage, tagFit, voiceFit, type Profile } from './taste';
import { isRealSong } from './promptRadio';
import { eraFit, yearGap, type SeedInfo } from './seedRadio';
import type { TrackRowData } from './tracks';

const styleTags = (p: Profile | undefined) => new Set((p?.tags ?? []).map((t) => t.toLowerCase()).filter((t) => !NOT_STYLE.test(t)));
// Shared genre tags with the seed artist: 0..1 (0 when either is unknown).
function soundFit(seed: Set<string>, p: Profile | undefined): number {
  const mine = styleTags(p);
  if (!seed.size || !mine.size) return 0;
  let shared = 0;
  for (const t of mine) if (seed.has(t)) shared++;
  return Math.min(1, shared / Math.min(seed.size, mine.size, 4));
}

export async function tasteOrder(tracks: TrackRowData[], opts: { keepFirst?: boolean; seed?: SeedInfo } = {}): Promise<TrackRowData[]> {
  if (tracks.length < 3) return tracks;
  const taste = await loadTaste().catch(() => null);
  if (!taste) return tracks;
  const seed = opts.seed;
  const seedKey = seed?.artist ? artistKey(seed.artist) : '';
  const keys = tracks.map((t) => artistKey(t.artist || ''));
  const profiles = await loadProfiles(seedKey ? [seedKey, ...keys] : keys).catch(() => new Map());
  const seedProfile = seedKey ? profiles.get(seedKey) : undefined;
  const seedTags = styleTags(seedProfile);
  const seedLang = seed ? seed.lang ?? songLanguage(seed.artist, seedProfile) : null;

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
      if (seed) {
        // The seed leads: its era, its sound, its language; your taste breaks ties.
        const langMatch = seedLang && lang ? (lang === seedLang ? 0.5 : -0.6) : 0;
        const score =
          2.6 * eraFit(seed.year, t.year) +
          0.9 * soundFit(seedTags, p) +
          langMatch +
          0.5 * tagFit(taste, p) +
          0.35 * affinity(taste, t.artist || '') +
          0.5 * languageFit(taste, lang) +
          0.25 * voiceFit(taste, lang, p) -
          1.6 * skip -
          (real ? 0 : 2) -
          0.006 * i;
        return { t, score, drop: !real || skip >= 0.8, gap: yearGap(seed.year, t.year) };
      }
      const score =
        1.1 * tagFit(taste, p) +
        0.7 * affinity(taste, t.artist || '') +
        languageFit(taste, lang) +
        0.35 * voiceFit(taste, lang, p) -
        1.6 * skip -
        (real ? 0 : 2) -
        0.012 * i; // YouTube's order, gently
      return { t, score, drop: !real || skip >= 0.8, gap: null as number | null };
    })
    .filter((x) => !x.drop);

  // Out-of-era songs go when there are enough from the seed's time.
  let pool = scored;
  if (seed?.year) {
    const near = scored.filter((x) => x.gap !== null && x.gap <= 3).length;
    const limit = near >= 20 ? 5 : near >= 10 ? 7 : null;
    if (limit !== null) pool = scored.filter((x) => x.gap === null || x.gap < limit);
  }

  pool.sort((a, b) => b.score - a.score);
  const keep = pool.length > 12 ? pool.slice(0, Math.ceil(pool.length * (5 / 6))) : pool;

  // Spread artists out: no artist twice within three songs.
  const out: TrackRowData[] = [...head];
  // With a seed the pool is big, so no artist takes over: ≤4 songs per batch (the seed's artist 5).
  const perArtist = new Map<string, number>();
  const pending = keep
    .map((x) => x.t)
    .filter((t) => {
      if (!seed) return true;
      const k = artistKey(t.artist || '');
      const n = (perArtist.get(k) ?? 0) + 1;
      perArtist.set(k, n);
      return n <= (k === seedKey ? 5 : 4);
    });
  while (pending.length) {
    const recent = out.slice(-3).map((t) => artistKey(t.artist || ''));
    const j = pending.findIndex((t) => !recent.includes(artistKey(t.artist || '')));
    out.push(...pending.splice(j >= 0 ? j : 0, 1));
  }
  if (unknown.length) queueArtists(unknown.slice(0, 40)).catch(() => {});
  return out;
}
