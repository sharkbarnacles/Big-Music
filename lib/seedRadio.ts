// Song radios that stay in the starting song's era and sound (owner,
// 2026-11-21: a radio from SHINee "Romeo+Juliette" (2009) filled up with
// 2015–2018 BTS/EXO hits — artists they like, wrong sound for that song).
//
// YouTube Music's radio for one song drifts towards whatever is popular with
// the same listeners, and the hub's taste ranking then lifted favourite
// artists regardless of year. Now:
//   1. Every suggestion carries its release year (YouTube shows it as
//      "Artist • Album • 2009"); the seed's own year comes from the same list.
//   2. "Era anchors": up to 3 suggestions from the seed's years (±1, other
//      artists) start radios of their own, so the pool is dense with songs
//      from that time instead of a few among later hits.
//   3. lib/tasteRank.ts ranks with the seed first: closeness in years counts
//      most, then sounding like the seed artist (shared genre tags) and the
//      seed's language, then your taste. Songs far from the era are dropped
//      when enough near ones exist.
// Continuations are "s:<state>" tokens: the seed's year/artist/language and up
// to 4 YouTube radio chains (the seed's + anchors'), each advanced one step.
import { fetchRadio, type RadioSong } from './ytRadio';

export type SeedInfo = { year: number | null; artist: string; lang: string | null };
type State = { y: number | null; a: string; l: string | null; c: string[]; u: string[] };

const MAX_CHAINS = 4;
const ANCHORS = 3;

// How close a song's year is to the seed's: 1 (same time) … negative (another era).
export function eraFit(seedYear: number | null | undefined, year: number | null | undefined): number {
  if (!seedYear) return 0;
  if (!year) return -0.3; // unknown (often a fan upload): after the songs we know fit
  const d = Math.abs(year - seedYear);
  if (d <= 1) return 1;
  if (d === 2) return 0.75;
  if (d === 3) return 0.4;
  if (d === 4) return 0;
  return -Math.min(1.6, (d - 4) * 0.35);
}

export const yearGap = (seedYear: number | null | undefined, year: number | null | undefined) =>
  seedYear && year ? Math.abs(year - seedYear) : null;

const firstArtist = (a: string) => a.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?)\s*/i)[0].trim().toLowerCase();
const playId = (s: RadioSong) => s.audioId ?? s.videoId;

// Round-robin the lists so the merged order still roughly follows each radio's own order.
function weave(lists: RadioSong[][]): RadioSong[] {
  const out: RadioSong[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) {
      const s = l[i];
      if (!s) continue;
      const k = playId(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  return out;
}

// Songs from the seed's years by other artists (and different from each other), in YouTube's order.
function pickAnchors(songs: RadioSong[], seedYear: number, seedArtist: string, used: Set<string>, n: number): RadioSong[] {
  const out: RadioSong[] = [];
  const artists = new Set([firstArtist(seedArtist)]);
  for (const within of [1, 2]) {
    for (const s of songs) {
      if (out.length >= n) return out;
      if (!s.year || Math.abs(s.year - seedYear) > within) continue;
      if (used.has(playId(s)) || used.has(s.videoId)) continue;
      const a = firstArtist(s.artist);
      if (artists.has(a)) continue;
      artists.add(a);
      out.push(s);
    }
  }
  return out;
}

async function anchorRadios(anchors: RadioSong[]): Promise<{ songs: RadioSong[]; continuation: string | null }[]> {
  return Promise.all(anchors.map((a) => fetchRadio({ videoId: playId(a) }).catch(() => ({ songs: [] as RadioSong[], continuation: null }))));
}

const encode = (s: State) => 's:' + Buffer.from(JSON.stringify({ ...s, u: s.u.slice(-40) })).toString('base64url');
function decode(token: string): State | null {
  try {
    const s = JSON.parse(Buffer.from(token.slice(2), 'base64url').toString());
    return Array.isArray(s?.c) ? { y: s.y ?? null, a: s.a ?? '', l: s.l ?? null, c: s.c, u: s.u ?? [] } : null;
  } catch {
    return null;
  }
}

// A new radio: the seed's radio (2 extra steps) plus radios from era anchors.
// `inWindowWanted`: keep gathering one more round while fewer songs than this sit within ±3 years.
export async function seedRadioStart(videoId: string, opts: { lang?: (s: RadioSong) => string | null; inWindowWanted?: number } = {}) {
  const first = await fetchRadio({ videoId });
  const seedSong = first.songs.find((s) => s.videoId === videoId || s.audioId === videoId || s.mvId === videoId) ?? null;
  const seed: SeedInfo = {
    year: seedSong?.year ?? null,
    artist: seedSong?.artist ?? '',
    lang: seedSong && opts.lang ? opts.lang(seedSong) : null,
  };
  const used = new Set([videoId, ...(seedSong ? [playId(seedSong), seedSong.videoId] : [])]);

  // The seed's own chain, two more steps.
  const seedChain = async () => {
    const lists: RadioSong[][] = [];
    let c = first.continuation;
    for (let i = 0; i < 2 && c; i++) {
      const more = await fetchRadio({ continuation: c }).catch(() => null);
      if (!more) break;
      lists.push(more.songs);
      c = more.continuation;
    }
    return { lists, continuation: c };
  };

  if (!seed.year) {
    // No year to go by (rare): the seed's radio alone, as before.
    const sc = await seedChain();
    const songs = weave([first.songs, ...sc.lists]);
    return { songs, seed, continuation: sc.continuation ? encode({ y: null, a: seed.artist, l: seed.lang, c: [sc.continuation], u: [...used] }) : null };
  }

  const anchors = pickAnchors(first.songs, seed.year, seed.artist, used, ANCHORS);
  anchors.forEach((a) => used.add(playId(a)));
  const [sc, anchorAnswers] = await Promise.all([seedChain(), anchorRadios(anchors)]);
  const seedList = [first.songs, ...sc.lists].flat();
  let chains: (string | null)[] = [sc.continuation, ...anchorAnswers.map((r) => r.continuation)];
  let songs = weave([seedList, ...anchorAnswers.map((r) => r.songs)]);

  // Still thin in the seed's years: one more step from every chain.
  const near = () => songs.filter((s) => s.year && Math.abs(s.year - seed.year!) <= 3).length;
  if (near() < (opts.inWindowWanted ?? 60)) {
    const more = await Promise.all(chains.map((c) => (c ? fetchRadio({ continuation: c }).catch(() => null) : Promise.resolve(null))));
    chains = more.map((m, i) => (m ? m.continuation : chains[i]));
    songs = weave([songs, ...more.map((m) => m?.songs ?? [])]);
  }

  const live = chains.filter((c): c is string => !!c).slice(0, MAX_CHAINS);
  return { songs, seed, continuation: live.length ? encode({ y: seed.year, a: seed.artist, l: seed.lang, c: live, u: [...used] }) : null };
}

// More songs for a running radio: one step from every chain; new anchors when chains run dry.
export async function seedRadioMore(token: string) {
  const st = decode(token);
  if (!st) return null;
  const answers = await Promise.all(st.c.map((c) => fetchRadio({ continuation: c }).catch(() => null)));
  let chains = answers.map((a) => a?.continuation ?? null).filter((c): c is string => !!c);
  const lists = answers.map((a) => a?.songs ?? []);
  const used = new Set(st.u);
  if (st.y && chains.length < MAX_CHAINS) {
    const fresh = pickAnchors(lists.flat(), st.y, st.a, used, Math.min(2, MAX_CHAINS - chains.length));
    fresh.forEach((a) => used.add(playId(a)));
    const extra = await anchorRadios(fresh);
    lists.push(...extra.map((r) => r.songs));
    chains = [...chains, ...extra.map((r) => r.continuation).filter((c): c is string => !!c)].slice(0, MAX_CHAINS);
  }
  const seed: SeedInfo = { year: st.y, artist: st.a, lang: st.l };
  return {
    songs: weave(lists),
    seed,
    continuation: chains.length ? encode({ ...st, c: chains, u: [...used] }) : null,
  };
}
