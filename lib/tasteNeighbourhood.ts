// The part of a word radio that comes from *your* music (owner, 2026-11-05:
// word radios "often felt random and unfitting"; playlists found by the
// words alone pull in whatever the internet files under "rainy day").
//
// Moods and styles are turned into genre tags ("dreamy" → dream pop,
// shoegaze, ambient…). Your artists whose MusicBrainz tags match are picked
// (weighted by how much you like them, a bit of chance), a few of their
// songs from your library seed YouTube Music radios, and those radios are
// woven together. So the songs come from your corner of music, in the mood
// you asked for, and the radios bring in artists you don't know yet.
// With no mood or style ("my taste", "something for me") every artist you
// like can be picked.
import { db } from './db';
import { fetchRadio, type RadioSong } from './ytRadio';
import { artistKey, loadProfiles, type Taste } from './taste';
import type { WebSong } from './ytBrowse';

// Genre tags that usually carry each mood (MusicBrainz / Last.fm style names).
export const MOOD_TAGS: Record<string, string[]> = {
  chill: ['chillwave', 'bedroom pop', 'lo-fi', 'neo soul', 'alternative r&b', 'indie pop', 'dream pop', 'jazz', 'trip hop', 'r&b'],
  dark: ['darkwave', 'post-punk', 'gothic rock', 'trip hop', 'industrial', 'coldwave', 'doom', 'black metal', 'shoegaze'],
  sad: ['sadcore', 'slowcore', 'emo', 'indie folk', 'singer-songwriter', 'ballad', 'midwest emo', 'shoegaze'],
  happy: ['indie pop', 'city pop', 'funk', 'disco', 'k-pop', 'power pop', 'pop'],
  aggressive: ['metal', 'metalcore', 'hardcore', 'nu metal', 'industrial', 'punk', 'post-hardcore', 'screamo'],
  energetic: ['dance', 'electropop', 'pop punk', 'house', 'k-pop', 'rock', 'hip hop', 'edm'],
  romantic: ['r&b', 'soul', 'ballad', 'neo soul', 'alternative r&b', 'bossa nova'],
  dreamy: ['dream pop', 'shoegaze', 'ambient', 'ethereal', 'bedroom pop', 'chillwave', 'neo-psychedelia', 'ethereal wave', 'slowcore'],
  soft: ['bedroom pop', 'indie folk', 'acoustic', 'dream pop', 'chamber pop', 'singer-songwriter', 'indie pop'],
  whimsical: ['chamber pop', 'baroque pop', 'indie folk', 'art pop', 'freak folk', 'twee pop', 'psychedelic pop'],
  night: ['alternative r&b', 'r&b', 'synthwave', 'dream pop', 'trip hop', 'neo soul', 'city pop', 'chillwave'],
  rainy: ['indie folk', 'slowcore', 'sadcore', 'acoustic', 'singer-songwriter', 'dream pop', 'lo-fi', 'ambient', 'jazz'],
  sleep: ['ambient', 'dream pop', 'slowcore', 'neoclassical', 'acoustic'],
  focus: ['ambient', 'post-rock', 'instrumental', 'math rock', 'neoclassical', 'jazz'],
  acoustic: ['acoustic', 'folk', 'indie folk', 'singer-songwriter'],
};

const asWeb = (s: RadioSong): WebSong => ({
  videoId: s.audioId ?? s.videoId,
  title: s.title,
  artist: s.artist,
  album: s.album,
  image: s.image,
  durationMs: s.durationMs,
  isVideo: false,
  release: 'song',
});

// Does this tag list contain any of the wanted tags (either way round, so
// "dream pop" matches "dream pop/shoegaze")?
export function tagHits(tags: string[], wanted: string[]): number {
  if (!wanted.length) return 0;
  const low = tags.map((t) => t.toLowerCase());
  return wanted.filter((w) => low.some((t) => t.includes(w) || (w.length > 4 && w.includes(t) && t.length > 3))).length;
}

export async function tasteNeighbourhood(opts: {
  taste: Taste;
  wanted: string[]; // tags; empty = anything you like
  used: Set<string>; // seed video ids used before ("v:<id>")
  keep?: (s: WebSong) => boolean; // e.g. only songs in a language's script
}): Promise<{ songs: WebSong[]; seeds: string[]; artists: string[] }> {
  const { taste, wanted, used } = opts;
  // Your top artists (by how much you like them) and their tags.
  const top = [...taste.own.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300);
  const profiles = await loadProfiles(top.map(([k]) => k)).catch(() => new Map());
  let pool = top
    .map(([k, w]) => {
      const p = profiles.get(k);
      const hits = p ? tagHits(p.tags, wanted) : 0;
      const skip = taste.skips.get(k) ?? 0;
      return { k, weight: (wanted.length ? hits * (0.4 + w) : 0.2 + w) * (1 - skip) };
    })
    .filter((x) => x.weight > 0);
  if (!pool.length) return { songs: [], seeds: [], artists: [] };
  // Weighted random choice of up to 6 artists.
  const chosen: string[] = [];
  pool = pool.slice();
  while (chosen.length < 6 && pool.length) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    const i = pool.findIndex((x) => (r -= x.weight) <= 0);
    chosen.push(pool.splice(i >= 0 ? i : 0, 1)[0].k);
  }
  // A few of their songs from your library (with a YouTube version) as seeds.
  const { data: ids } = await db().rpc('library_tracks_for_artists', { keys: chosen, per_artist: 3 });
  const idList = ((ids as any[]) ?? []).map((r) => r.id);
  if (!idList.length) return { songs: [], seeds: [], artists: chosen };
  const { data: rows } = await db().from('tracks').select('id, artist, yt_audio_id').in('id', idList).not('yt_audio_id', 'is', null);
  const byArtist = new Map<string, string[]>();
  for (const r of (rows as any[]) ?? []) {
    const k = artistKey(r.artist ?? '');
    if (!r.yt_audio_id || used.has(`v:${r.yt_audio_id}`)) continue;
    byArtist.set(k, [...(byArtist.get(k) ?? []), r.yt_audio_id]);
  }
  // One seed per artist first, so no single artist's radio takes over.
  const seeds: string[] = [];
  for (const k of chosen) {
    const list = byArtist.get(k);
    if (list?.length && seeds.length < 5) seeds.push(list[Math.floor(Math.random() * list.length)]);
  }
  if (!seeds.length) return { songs: [], seeds: [], artists: chosen };
  const radios = (await Promise.allSettled(seeds.map((videoId) => fetchRadio({ videoId }))))
    .flatMap((r) => (r.status === 'fulfilled' ? [r.value.songs.slice(1)] : [])); // [0] is the seed itself
  const woven: WebSong[] = [];
  const seen = new Set<string>();
  for (let i = 0; radios.some((l) => i < l.length); i++) {
    for (const l of radios) {
      const s = l[i];
      if (!s || seen.has(s.videoId)) continue;
      seen.add(s.videoId);
      const w = asWeb(s);
      if (!opts.keep || opts.keep(w)) woven.push(w);
    }
  }
  return { songs: woven, seeds, artists: chosen };
}
