// Your music taste, as the hub sees it (SQL taste_artists): for each artist,
// how many of their songs you've saved, in how many of your playlists (the
// strongest sign), how often you've played them lately, and what you've
// starred. Artists YouTube Music says are similar to ones you like
// (discover_artists, filled by the daily Discover job) count a bit too.
// Cached for 30 minutes per server.
import { db } from './db';

export type Profile = { voice: 'male' | 'female' | 'mixed' | null; country: string | null; script: string | null; tags: string[] };
export type VoicePrefs = Record<string, 'male' | 'female'>; // e.g. { thai: 'male', chinese: 'male' }
export type Taste = {
  own: Map<string, number>;
  similar: Map<string, number>;
  tags: Map<string, number>; // your taste in genres/tags, 0..1 (MusicBrainz, via artist_profiles)
  voice: VoicePrefs;
  // Artists you keep skipping (Next pressed early): 0 (never) to 1 (often).
  skips: Map<string, number>;
  // Your languages: main ones, side branches (taste_settings 'languages').
  languages: { main: string[]; branch: string[] };
};
let cache: { at: number; taste: Taste } | null = null;

// Tags about who an artist is rather than how they sound (voice, country,
// generation, "seen live"…): those are used separately, not as style.
export const NOT_STYLE = /\b(boy|girl|male|female|co-ed|group|band|duo|trio|vocalists?|singers?|seen live|gen(eration)?|\d(st|nd|rd|th) gen|british|american|english|korean|korea|japanese|japan|chinese|china|taiwanese|thai|thailand|canadian|australian|french|german|swedish|irish|scottish|welsh|spanish|mexican|brazilian|filipino|indonesian|vietnamese|uk|usa|us)\b/i;

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
  if (cache && Date.now() - cache.at < 10 * 60_000) {
    // Your vocal preferences change from the Your taste page: always read them fresh.
    const { data } = await db().from('taste_settings').select('value').eq('key', 'voice').maybeSingle();
    return { ...cache.taste, voice: ((data as any)?.value ?? {}) as VoicePrefs };
  }
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [{ data: rows }, { data: rel }, { data: tagRows }, { data: setting }, { data: skipRows }, { data: langs }] = await Promise.all([
    db().rpc('taste_artists', { max_rows: 4000 }),
    db().from('discover_artists').select('name, data'),
    db().rpc('taste_tags', { max_rows: 120 }),
    db().from('taste_settings').select('value').eq('key', 'voice').maybeSingle(),
    db().from('skips').select('artist_key, at').gte('at', since).limit(5000),
    db().from('taste_settings').select('value').eq('key', 'languages').maybeSingle(),
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
  // Tags: square-root scaled so a few huge genres don't drown out the rest.
  const tags = new Map<string, number>();
  const tagTop = Math.sqrt((tagRows as any[])?.[0]?.weight || 1);
  for (const r of (tagRows as any[]) ?? []) if (!NOT_STYLE.test(r.tag)) tags.set(r.tag, Math.sqrt(r.weight) / tagTop);
  const voice = ((setting as any)?.value ?? {}) as VoicePrefs;
  // Skips: newer ones count more (half-life ~30 days); the first one is free,
  // about five recent skips is "often". Artists you love are judged gently.
  const raw = new Map<string, number>();
  for (const r of (skipRows as any[]) ?? []) {
    const age = (Date.now() - Date.parse(r.at)) / 86_400_000;
    raw.set(r.artist_key, (raw.get(r.artist_key) ?? 0) + Math.pow(0.5, age / 30));
  }
  const skips = new Map<string, number>();
  for (const [k, n] of raw) {
    const p = Math.max(0, Math.min(1, (n - 1) / 4)) * (1 - 0.6 * (own.get(k) ?? 0));
    if (p > 0) skips.set(k, p);
  }
  const lv = ((langs as any)?.value ?? {}) as { main?: string[]; branch?: string[] };
  const languages = { main: lv.main ?? ['english'], branch: lv.branch ?? [] };
  const taste = { own, similar, tags, voice, skips, languages };
  cache = { at: Date.now(), taste };
  return taste;
}

// Profiles of some artists (by key), from the MusicBrainz tagging job.
export async function loadProfiles(keys: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  const unique = [...new Set(keys.filter(Boolean))].slice(0, 300);
  if (!unique.length) return out;
  const { data } = await db().from('artist_profiles').select('artist_key, voice, country, script, genres, tags, status').in('artist_key', unique);
  for (const r of (data as any[]) ?? []) {
    if (r.status !== 'found' && !r.script) continue;
    out.set(r.artist_key, { voice: r.voice, country: r.country, script: r.script, tags: [...(r.genres ?? []), ...(r.tags ?? [])] });
  }
  return out;
}

// New artists that came up in a radio join the tagging queue (after your own).
export async function queueArtists(names: string[]) {
  const rows = [...new Map(names.map((n) => [artistKey(n), n])).entries()].filter(([k]) => k).map(([k, n]) => ({ artist_key: k, name: n.split(',')[0].trim(), priority: 50 }));
  if (rows.length) await db().from('artist_profiles').upsert(rows, { onConflict: 'artist_key', ignoreDuplicates: true });
}

// How well an artist's tags fit your taste in tags: 0..1.
export function tagFit(taste: Taste, p: Profile | undefined): number {
  if (!p || !p.tags.length || !taste.tags.size) return 0;
  const scores = p.tags.filter((t) => !NOT_STYLE.test(t)).map((t) => taste.tags.get(t) ?? 0).sort((a, b) => b - a);
  return Math.min(1, scores[0] * 0.6 + (scores[1] ?? 0) * 0.3 + (scores[2] ?? 0) * 0.1);
}

// Which language a song is in, for your vocal preferences (by script, or the artist's country).
const COUNTRY_LANG: Record<string, string> = { TH: 'thai', CN: 'chinese', TW: 'chinese', HK: 'chinese', MO: 'chinese', KR: 'korean', JP: 'japanese' };
const SCRIPT_LANG: Record<string, string> = { thai: 'thai', han: 'chinese', hangul: 'korean', kana: 'japanese' };
export function songLanguage(text: string, p: Profile | undefined): string | null {
  if (/[\u0E00-\u0E7F]/.test(text)) return 'thai';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'korean';
  if (/[\u3040-\u30FF]/.test(text)) return 'japanese';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'chinese';
  if (p?.country && COUNTRY_LANG[p.country]) return COUNTRY_LANG[p.country];
  if (p?.script && SCRIPT_LANG[p.script]) return SCRIPT_LANG[p.script];
  return null;
}

// Your vocal preference for this song: +1 a match, -0.3 the other (never ruled out), 0 unknown.
export function voiceFit(taste: Taste, lang: string | null, p: Profile | undefined): number {
  const want = lang ? taste.voice[lang] : undefined;
  if (!want || !p?.voice) return 0;
  if (p.voice === want) return 1;
  if (p.voice === 'mixed') return 0.3;
  return -0.3;
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

// How much you've been skipping this artist lately: 0 (not) to 1 (often).
export function skipPenalty(taste: Taste, artist: string): number {
  let worst = 0;
  for (const name of artist.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i)) {
    const k = artistKey(name);
    if (k) worst = Math.max(worst, taste.skips.get(k) ?? 0);
  }
  return worst;
}

// How a song's language sits with yours: +0.35 main, +0.1 side branch,
// -0.5 a language you don't listen to, 0 unknown (most English/Latin titles).
export function languageFit(taste: Taste, lang: string | null): number {
  if (!lang) return 0;
  if (taste.languages.main.includes(lang)) return 0.35;
  if (taste.languages.branch.includes(lang)) return 0.1;
  return -0.5;
}
