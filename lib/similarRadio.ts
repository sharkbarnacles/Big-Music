// "Similar to Silica Gel": a radio of artists like the one you name, not
// that artist's own songs. Finds the artist on YouTube Music, takes its
// "Fans might also like" artists, and plays their top songs (with one or two
// of the named artist's early on). As you listen it moves outwards to the
// artists similar to those. Your taste lifts artists you love or that fit
// your genres; extra words ("…but shoegaze") favour artists tagged with them.
import { browseArtist, searchArtists, type WebSong } from './ytBrowse';
import { affinity, artistKey, loadProfiles, loadTaste, queueArtists, tagFit, type Taste } from './taste';
import { isRealSong } from './promptRadio';

const ASK = /^(?:.*?\b)?(?:similar to|sounds? like|artists? like|bands? like|songs? like|music like|more like|fans of|in the style of|style of|vibes? like|like)\s+(.+?)(?:\s+(?:but|with|and)\s+(.+))?$/i;

export type SimilarState = { q: string; used: string[]; todo?: string[]; seed?: string };

const simple = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

// Is this a "similar to <artist>" request? Returns the artist found on YouTube Music.
export async function findSimilarSeed(q: string): Promise<{ id: string; name: string; extra: string } | null> {
  const m = q.trim().match(ASK);
  if (!m) return null;
  const name = m[1].trim();
  const extra = (m[2] ?? '').trim();
  if (!name) return null;
  const found = await searchArtists(name).catch(() => []);
  const want = simple(name);
  const hit = found.find((a) => simple(a.title) === want) ?? found.find((a) => simple(a.title).includes(want) || want.includes(simple(a.title)));
  return hit ? { id: hit.id, name: hit.title, extra } : null;
}

export async function similarRadio(q: string, state: SimilarState | null, seed?: { id: string; name: string; extra: string }) {
  const empty: Taste = { own: new Map(), similar: new Map(), tags: new Map(), voice: {} };
  const taste = await loadTaste().catch(() => empty);
  const used = new Set(state?.used ?? []);
  let todo = state?.todo ?? [];
  const seedId = seed?.id ?? state?.seed ?? '';
  const extraWords = (seed?.extra ?? (q.match(ASK)?.[2] ?? '')).toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 2);
  const songs: { s: WebSong; rank: number; artistId: string }[] = [];

  // First batch: the named artist's page gives its similar artists.
  if (!state && seedId) {
    const a = await browseArtist(seedId).catch(() => null);
    if (!a) return { songs: [], state: null, picked: [], liked: [] };
    const fans = a.shelves.find((sh) => /fans|similar|also like/i.test(sh.title))?.items.filter((x) => x.kind === 'artist') ?? [];
    todo = fans.map((f) => f.id);
    used.add(seedId);
    // One or two of the named artist's own songs, early on.
    a.songs.filter(isRealSong).slice(0, 2).forEach((s, i) => songs.push({ s, rank: 50 - i * 30, artistId: seedId }));
  }

  // Next ~10 artists from the queue: their top songs, and their own similar artists for later.
  const batch = todo.filter((id) => !used.has(id)).slice(0, 10);
  const pages = await Promise.all(batch.map((id) => browseArtist(id).catch(() => null)));
  const nextTodo = todo.filter((id) => !batch.includes(id));
  pages.forEach((page, i) => {
    if (!page) return;
    used.add(batch[i]);
    for (const sh of page.shelves) {
      if (!/fans|similar|also like/i.test(sh.title)) continue;
      for (const x of sh.items) if (x.kind === 'artist' && !used.has(x.id) && !nextTodo.includes(x.id)) nextTodo.push(x.id);
    }
    page.songs.filter(isRealSong).slice(0, 4).forEach((s, j) => songs.push({ s, rank: 10 - j * 1.5, artistId: batch[i] }));
  });

  // Taste and extra words.
  const keys = songs.map((x) => artistKey(x.s.artist));
  const profiles = await loadProfiles(keys).catch(() => new Map());
  queueArtists(songs.map((x) => x.s.artist).filter((n) => !profiles.has(artistKey(n)))).catch(() => {});
  for (const x of songs) {
    const prof = profiles.get(artistKey(x.s.artist));
    const wantExtra = extraWords.length && prof?.tags.some((t: string) => extraWords.some((w) => t.includes(w))) ? 4 : 0;
    x.rank += affinity(taste, x.s.artist) * 4 + tagFit(taste, prof) * 3 + wantExtra + Math.random() * 3;
  }
  // Mix artists: best songs first, but never the same artist twice in a row.
  songs.sort((a, b) => b.rank - a.rank);
  const out: WebSong[] = [];
  const seen = new Set<string>();
  const rest = songs.filter((x) => !seen.has(x.s.videoId) && seen.add(x.s.videoId));
  while (rest.length) {
    const last = out[out.length - 1]?.artist;
    const i = rest.findIndex((x) => x.s.artist !== last);
    out.push(rest.splice(i >= 0 ? i : 0, 1)[0].s);
  }
  return {
    songs: out,
    state: nextTodo.length ? { q, used: [...used].slice(-80), todo: nextTodo.slice(0, 40), seed: seedId } : null,
    picked: [seed?.name ? `like ${seed.name}` : q],
    liked: [...new Set(out.map((s) => artistKey(s.artist)).filter((k) => (taste.own.get(k) ?? 0) > 0.15))].slice(0, 12),
  };
}
