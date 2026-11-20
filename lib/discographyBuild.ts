// An artist's whole discography as one list of songs: every album and
// single on YouTube Music, opened and joined together, with play counts and
// release years so it can be sorted (popular now, most played, release order).
// Built from the same unofficial requests as lib/ytBrowse.ts and kept for a
// few hours (lib/discography.ts), since a big artist means 50–150 album
// pages to open. No Next.js imports here, so scripts can run it too.
import { browseArtist, browseCollection, browseDiscography, browseTopSongs, type WebItem, type WebSong } from './ytBrowse';

export type DiscoSong = WebSong & {
  year: number | null; // of its first release
  from: string; // the album or single it's from
  releaseKind: 'album' | 'single';
  order: number; // position in release order, 0 = newest release's first song
  popRank: number | null; // place in YouTube Music's "Top songs" (popular now)
};
export type Discography = {
  name: string;
  image: string | null;
  releases: number;
  songs: DiscoSong[];
};

export type DiscoSort = 'popular' | 'plays' | 'new' | 'old';

const MAX_RELEASES = 150;
const DISCO = /^(albums|singles|singles & eps|eps)$/i;

// Same song on a single and an album ("Title" twice) counts once.
const songKey = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
const yearOf = (t: string) => {
  const m = t.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function buildDiscography(id: string): Promise<Discography> {
  const artist = await browseArtist(id);

  // Every release: the full lists behind "Albums" and "Singles & EPs" (or
  // just the shelf when an artist has only a few). Newest first.
  const shelves = artist.shelves.filter((sh) => DISCO.test(sh.title.trim()));
  const lists = await Promise.all(
    shelves.map(async (sh) => {
      const kind: DiscoSong['releaseKind'] = /single|ep/i.test(sh.title) ? 'single' : 'album';
      const items = sh.more ? await browseDiscography(sh.more.id, sh.more.params).then((d) => d.items).catch(() => sh.items) : sh.items;
      return items.filter((it) => it.kind === 'album').map((it) => ({ it, kind }));
    }),
  );
  const seen = new Set<string>();
  const releases: { it: WebItem; kind: DiscoSong['releaseKind']; year: number | null }[] = [];
  for (const list of lists)
    for (const r of list)
      if (!seen.has(r.it.id)) {
        seen.add(r.it.id);
        releases.push({ ...r, year: yearOf(r.it.subtitle) });
      }
  // Newest first; albums before singles in the same year.
  releases.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.kind === b.kind ? 0 : a.kind === 'album' ? -1 : 1));
  const picked = releases.slice(0, MAX_RELEASES);

  const [pages, top] = await Promise.all([
    pool(picked, 12, (r) => browseCollection(r.it.id, 200).catch(() => null)),
    artist.songsMore ? browseTopSongs(artist.songsMore.id, artist.songsMore.params).catch(() => artist.songs) : Promise.resolve(artist.songs),
  ]);

  const rankById = new Map<string, number>();
  const rankByTitle = new Map<string, number>();
  top.forEach((s, i) => {
    if (!rankById.has(s.videoId)) rankById.set(s.videoId, i);
    const k = songKey(s.title);
    if (!rankByTitle.has(k)) rankByTitle.set(k, i);
  });

  // Walk releases newest → oldest; a song seen again on an older release
  // moves to that (first) release but keeps the higher play count.
  const byKey = new Map<string, DiscoSong>();
  let order = 0;
  picked.forEach((r, ri) => {
    const page = pages[ri];
    if (!page) return;
    for (const s of page.songs) {
      const k = songKey(s.title) || s.videoId;
      const rank = rankById.get(s.videoId) ?? rankByTitle.get(songKey(s.title)) ?? null;
      const song: DiscoSong = { ...s, year: r.year, from: page.title, releaseKind: r.kind, order: order++, popRank: rank };
      const had = byKey.get(k);
      if (!had) {
        byKey.set(k, song);
        continue;
      }
      // Older release: it's where the song first came out.
      const plays = Math.max(had.plays ?? 0, s.plays ?? 0) || null;
      const best = (s.plays ?? 0) > (had.plays ?? 0) ? s : had; // the version people play
      byKey.set(k, {
        ...had,
        ...best,
        plays,
        year: song.year ?? had.year,
        from: song.from,
        releaseKind: song.releaseKind,
        order: song.order,
        popRank: had.popRank ?? rank,
      });
    }
  });

  return { name: artist.name, image: artist.image, releases: picked.length, songs: [...byKey.values()] };
}


export function sortDiscography(songs: DiscoSong[], sort: DiscoSort): DiscoSong[] {
  const list = songs.slice();
  const plays = (s: DiscoSong) => s.plays ?? -1;
  if (sort === 'plays') list.sort((a, b) => plays(b) - plays(a));
  else if (sort === 'new') list.sort((a, b) => a.order - b.order);
  // Oldest release first, songs in album order.
  else if (sort === 'old') {
    const releaseStart = new Map<string, number>();
    for (const s of list) releaseStart.set(s.from, Math.min(releaseStart.get(s.from) ?? Infinity, s.order));
    list.sort((a, b) => releaseStart.get(b.from)! - releaseStart.get(a.from)! || a.order - b.order);
  }
  // Popular now: YouTube Music's Top songs order, then the rest by plays.
  else list.sort((a, b) => (a.popRank ?? Infinity) - (b.popRank ?? Infinity) || plays(b) - plays(a));
  return list;
}

// "203M plays", for the song rows.
export function playsLabel(n: number | null | undefined): string | null {
  if (!n) return null;
  const f = (x: number, u: string) => `${x >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${u}`;
  if (n >= 1e9) return `${f(n / 1e9, 'B')} plays`;
  if (n >= 1e6) return `${f(n / 1e6, 'M')} plays`;
  if (n >= 1e3) return `${f(n / 1e3, 'K')} plays`;
  return `${n} plays`;
}
