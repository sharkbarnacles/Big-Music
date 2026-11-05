// Finds Spotify versions of songs that only came from YouTube (YouTube
// playlists, discoveries, radio songs), so Spotify mode can hand Spotify a
// whole line-up and keep playing with the phone locked. Each song is looked
// up once with Spotify search and remembered in `spotify_matches`.
import { db } from './db';
import { spotifyFetch } from './spotifyPlayer';
import { splitTitle } from './titles';

export type MatchAsk = { key: string; title: string; artist: string };

// Lower case, accents and brackets dropped, letters and digits only (any script).
function simple(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([{【「].*?[)\]}】」]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
const firstArtist = (a: string) => a.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b|·|\/)\s*/i)[0]?.trim() || a;
// YouTube channels are often "Artist - Topic" or "ArtistVEVO".
const cleanArtist = (a: string) => a.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim();

export function matchKey(title: string, artist: string): string {
  return `${simple(firstArtist(cleanArtist(artist)))}|${simple(splitTitle(title).title)}`;
}

function fits(item: any, title: string, artist: string): boolean {
  const t = simple(splitTitle(title).title);
  const n = simple(item?.name ?? '');
  if (!t || !n) return false;
  const titleOk = n === t || (Math.min(n.length, t.length) >= 4 && (n.startsWith(t) || t.startsWith(n)));
  const a = simple(firstArtist(cleanArtist(artist)));
  const artistOk = (item.artists ?? []).some((x: any) => {
    const s = simple(x?.name ?? '');
    return s && a && (s === a || s.includes(a) || a.includes(s));
  });
  return titleOk && artistOk;
}

async function search(title: string, artist: string): Promise<string | null | 'busy'> {
  const t = splitTitle(title).title;
  const a = firstArtist(cleanArtist(artist));
  for (const q of [`track:${t} artist:${a}`, `${t} ${a}`]) {
    const res = await spotifyFetch(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
    if (res.status === 429) return 'busy';
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const hit = (body.tracks?.items ?? []).find((it: any) => it?.id && fits(it, title, artist));
    if (hit) return hit.id as string;
  }
  return null;
}

// Returns { key: spotifyId | null } for each song asked about (a song still
// unknown after `budget` searches is left out, to be asked again later).
export async function matchSongs(asks: MatchAsk[], budget = 12): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const byMk = new Map<string, MatchAsk[]>();
  for (const a of asks.slice(0, 60)) {
    const mk = matchKey(a.title, a.artist);
    if (!mk.includes('|') || mk.endsWith('|')) {
      out[a.key] = null;
      continue;
    }
    byMk.set(mk, [...(byMk.get(mk) ?? []), a]);
  }
  const keys = [...byMk.keys()];
  if (!keys.length) return out;
  const { data } = await db().from('spotify_matches').select('match_key, spotify_id').in('match_key', keys);
  const known = new Map((data ?? []).map((r: any) => [r.match_key as string, r.spotify_id as string | null]));
  const fresh: { match_key: string; spotify_id: string | null }[] = [];
  let left = budget;
  for (const mk of keys) {
    let id: string | null | undefined = known.get(mk);
    if (id === undefined) {
      if (left-- <= 0) continue;
      const a = byMk.get(mk)![0];
      const r = await search(a.title, a.artist);
      if (r === 'busy') break; // Spotify wants a pause: stop looking for now
      id = r;
      fresh.push({ match_key: mk, spotify_id: id });
      await new Promise((ok) => setTimeout(ok, 250));
    }
    for (const a of byMk.get(mk)!) out[a.key] = id;
  }
  if (fresh.length) await db().from('spotify_matches').upsert(fresh, { onConflict: 'match_key' });
  return out;
}
