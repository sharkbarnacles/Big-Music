// Your music taste, as the hub sees it (SQL taste_artists): for each artist,
// how many of their songs you've saved, in how many of your playlists (the
// strongest sign), how often you've played them lately, and what you've
// starred. Artists YouTube Music says are similar to ones you like
// (discover_artists, filled by the daily Discover job) count a bit too.
// Cached for 30 minutes per server.
import { db } from './db';

export type Taste = { own: Map<string, number>; similar: Map<string, number> };
let cache: { at: number; taste: Taste } | null = null;

// Same as the SQL: first artist name, without "feat. …", "x …", "& …".
export function artistKey(name: string): string {
  return name
    .replace(/\s+(feat\.?|ft\.?|x|&|and)\s+.*$/i, '')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function loadTaste(): Promise<Taste> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.taste;
  const [{ data: rows }, { data: rel }] = await Promise.all([
    db().rpc('taste_artists', { max_rows: 4000 }),
    db().from('discover_artists').select('name, data'),
  ]);
  const own = new Map<string, number>();
  const top = (rows as any[])?.[0]?.weight || 1;
  for (const r of (rows as any[]) ?? []) own.set(r.artist_key, Math.min(1, r.weight / top));
  const similar = new Map<string, number>();
  for (const a of (rel as any[]) ?? []) {
    const base = own.get(artistKey(a.name)) ?? 0.3;
    for (const r of a.data?.related ?? []) {
      const k = artistKey(String(r?.name ?? ''));
      if (!k || own.has(k)) continue;
      similar.set(k, Math.max(similar.get(k) ?? 0, 0.6 * base));
    }
  }
  const taste = { own, similar };
  cache = { at: Date.now(), taste };
  return taste;
}

// How much you'd like this artist: 0 (unknown) to 1 (your favourite).
// Songs with several artists count the one you like most.
export function affinity(taste: Taste, artist: string): number {
  let best = 0;
  for (const name of artist.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i)) {
    const k = artistKey(name);
    if (!k) continue;
    best = Math.max(best, taste.own.get(k) ?? 0, taste.similar.get(k) ?? 0);
  }
  return best;
}
