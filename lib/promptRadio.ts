// A radio from words ("niche underground chill thai"). A single song's radio
// drifts away from what you asked for, so this one is built from playlists
// people made for those words instead:
// 1. Split the words into an origin/language ("thai") and the feel ("chill",
//    "underground"), and search YouTube Music for playlists with several
//    combinations, including the language's own name for its music.
// 2. Score playlists by how many of your words their title has; when you
//    named an origin, a playlist must mention it (or be written in its script).
// 3. Pool their songs. For languages with their own script, songs written in
//    it go first; songs from playlists that mention the origin are trusted.
// 4. Spread artists out. More comes from the next playlists as you listen.
import { searchPlaylists, browseCollection, type WebSong } from './ytBrowse';

type Origin = { words: string[]; script?: RegExp; native?: string[] };
// Words people use for where music is from, and how to recognise it.
const ORIGINS: Origin[] = [
  { words: ['thai', 'thailand', 'tpop', 't-pop'], script: /[฀-๿]/, native: ['เพลงไทย', 'เพลงไทย ชิล'] },
  { words: ['korean', 'korea', 'kpop', 'k-pop', 'k-indie', 'khiphop', 'k-hiphop', 'krnb', 'k-rnb'], script: /[가-힯]/, native: ['한국 인디', '국내 음악'] },
  { words: ['japanese', 'japan', 'jpop', 'j-pop', 'j-rock', 'jrock', 'city pop', 'citypop', 'vocaloid', 'anime'], script: /[぀-ヿ]/, native: ['邦楽', 'シティポップ'] },
  { words: ['chinese', 'china', 'mandarin', 'cpop', 'c-pop', 'mandopop', 'taiwanese', 'taiwan'], script: /[一-鿿]/, native: ['华语', '中文歌'] },
  { words: ['cantonese', 'cantopop', 'hong kong', 'hk'], script: /[一-鿿]/, native: ['廣東歌'] },
  { words: ['vietnamese', 'vietnam', 'vpop', 'v-pop'], script: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i, native: ['nhạc việt', 'nhạc chill'] },
  { words: ['indonesian', 'indonesia', 'indo'], native: ['lagu indonesia', 'indie indonesia'] },
  { words: ['malaysian', 'malaysia', 'malay'], native: ['lagu melayu'] },
  { words: ['filipino', 'philippines', 'pinoy', 'opm', 'tagalog'], native: ['opm', 'tagalog songs'] },
  { words: ['indian', 'india', 'hindi', 'bollywood', 'desi'], script: /[ऀ-ॿ]/, native: ['hindi songs'] },
  { words: ['punjabi'], script: /[਀-੿]/ },
  { words: ['tamil', 'kollywood'], script: /[஀-௿]/ },
  { words: ['arabic', 'arab', 'egyptian', 'lebanese', 'khaleeji'], script: /[؀-ۿ]/, native: ['اغاني عربية'] },
  { words: ['persian', 'iranian', 'farsi'], script: /[؀-ۿ]/, native: ['آهنگ ایرانی'] },
  { words: ['turkish', 'turkey'], script: /[ğışçöüİ]/i, native: ['türkçe şarkılar'] },
  { words: ['russian', 'russia'], script: /[Ѐ-ӿ]/, native: ['русская музыка'] },
  { words: ['ukrainian', 'ukraine'], script: /[Ѐ-ӿ]/, native: ['українська музика'] },
  { words: ['greek', 'greece'], script: /[Ͱ-Ͽ]/, native: ['ελληνικά τραγούδια'] },
  { words: ['hebrew', 'israeli'], script: /[֐-׿]/ },
  { words: ['spanish', 'latin', 'latino', 'reggaeton', 'mexican', 'argentine', 'colombian', 'chilean'], native: ['música en español'] },
  { words: ['brazilian', 'brazil', 'portuguese', 'mpb', 'bossa nova'], native: ['música brasileira'] },
  { words: ['french', 'france', 'francophone'], native: ['chanson française'] },
  { words: ['german', 'germany', 'deutsch'], native: ['deutsche musik'] },
  { words: ['italian', 'italy'], native: ['musica italiana'] },
  { words: ['african', 'afrobeats', 'nigerian', 'ghanaian', 'amapiano', 'south african'], native: ['afrobeats'] },
];
// Moods weigh more than scene words ("niche", "underground"), and a playlist
// title counts as matching if it has any of the mood's usual words.
const MOODS: Record<string, string[]> = {
  chill: ['chill', 'chilled', 'relax', 'calm', 'mellow', 'soft', 'lofi', 'lo-fi', 'easy', 'ชิล', '잔잔', '칠', 'まったり'],
  sad: ['sad', 'heartbreak', 'broken', 'melancholy', 'cry', 'เศร้า', '이별', '슬픈'],
  happy: ['happy', 'feel good', 'upbeat', 'sunny', 'cheerful'],
  aggressive: ['aggressive', 'hard', 'heavy', 'metal', 'intense', 'angry', 'rage', 'hardcore'],
  energetic: ['energetic', 'hype', 'workout', 'gym', 'party', 'dance', 'upbeat'],
  romantic: ['romantic', 'love', 'รัก', '사랑'],
  dreamy: ['dreamy', 'dream', 'ethereal', 'shoegaze', 'ambient'],
  night: ['night', 'late night', 'midnight', 'นอน'],
  rainy: ['rain', 'rainy', '비', '雨'],
  sleep: ['sleep', 'bedtime', 'lullaby'],
  focus: ['focus', 'study', 'concentration', 'work'],
  acoustic: ['acoustic', 'unplugged'],
};
const moodOf = (w: string) => Object.entries(MOODS).find(([k, syn]) => k === w || syn.includes(w))?.[0] ?? null;

// Words that say nothing about the music on their own.
const FILLER = new Set(['music', 'songs', 'song', 'playlist', 'mix', 'radio', 'some', 'the', 'and', 'of', 'a', 'an', 'with', 'for', 'like', 'that', 'is', 'vibes', 'vibe', 'type', 'kind']);

export type PromptState = { q: string; used: string[] };
export type PromptBatch = { songs: WebSong[]; state: PromptState | null; picked: string[] };

function parse(q: string) {
  const lower = q.toLowerCase();
  const has = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(lower);
  const origin = ORIGINS.find((o) => o.words.some(has)) ?? null;
  const originWord = origin?.words.find(has) ?? null;
  const feel = lower
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w && !FILLER.has(w) && !(origin?.words.includes(w)));
  const moods = [...new Set(feel.map(moodOf).filter((m): m is string => m !== null))];
  const scene = feel.filter((w) => !moodOf(w));
  return { origin, originWord, feel, moods, scene };
}

const norm = (t: string) => t.toLowerCase().normalize('NFKC');

export async function promptRadio(q: string, state: PromptState | null): Promise<PromptBatch> {
  const { origin, originWord, feel, moods, scene } = parse(q);
  const used = new Set(state?.used ?? []);
  const o = originWord ?? '';

  // Searches: the words as typed, then origin + each feel word, then the native name.
  const queries = [q];
  if (o) {
    // The mood first: it decides how the radio feels.
    for (const m of moods.slice(0, 2)) queries.push(`${o} ${m}`, `${m} ${o} songs`);
    queries.push(`${o} ${feel.join(' ')}`.trim());
    for (const f of scene.slice(0, 2)) queries.push(`${o} ${f}`);
    for (const n of origin?.native ?? []) queries.push(moods.length ? `${n} ${moods[0]}` : n);
  } else if (feel.length > 1) {
    queries.push(feel.slice(0, 2).join(' '));
  }
  const unique = [...new Set(queries.map((x) => x.trim()).filter(Boolean))].slice(0, 7);
  const found = (await Promise.all(unique.map((x) => searchPlaylists(x).catch(() => [])))).flat();

  // Score each playlist by its title.
  const mentionsOrigin = (title: string) => {
    const t = norm(title);
    return Boolean(origin && (origin.words.some((w) => t.includes(w)) || origin.script?.test(title) || origin.native?.some((n) => t.includes(norm(n)))));
  };
  const scored = new Map<string, { id: string; title: string; score: number; origin: boolean }>();
  for (const p of found) {
    if (!p.id.startsWith('VL') || used.has(p.id) || scored.has(p.id)) continue;
    const t = norm(p.title);
    const hasOrigin = mentionsOrigin(p.title);
    if (origin && !hasOrigin) continue; // you asked for an origin: the playlist must be about it
    let score = hasOrigin ? 5 : 0;
    const moodHits = moods.filter((m) => MOODS[m].some((w) => t.includes(w))).length;
    const sceneHits = scene.filter((w) => t.includes(w)).length;
    score += moodHits * 6 + sceneHits * 2;
    // A mood you asked for that the title doesn't have counts against it.
    score -= (moods.length - moodHits) * 4;
    if (!moods.length && scene.length && !sceneHits) score -= 3;
    // Asked for no origin: a playlist about a particular country is off-topic.
    if (!origin && ORIGINS.some((x) => x.words.some((w) => new RegExp(`\\b${w}\\b`).test(t)))) score -= 4;
    if (/\b(mix|radio)\b/.test(t)) score -= 0.5;
    scored.set(p.id, { id: p.id, title: p.title, score, origin: hasOrigin });
  }
  // Look at a few more than needed: some turn out not to be what they say.
  const candidates = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  if (!candidates.length) return { songs: [], state: null, picked: [] };

  const lists = await Promise.all(candidates.map((p) => browseCollection(p.id, 120).catch(() => null)));
  const pool: { s: WebSong; rank: number }[] = [];
  const picked: string[] = [];
  const usedNow: string[] = [];
  lists.forEach((list, i) => {
    if (!list || !list.songs.length || picked.length >= 3) return;
    usedNow.push(candidates[i].id);
    const inScript = (s: WebSong) => (origin?.script ? origin.script.test(`${s.title} ${s.artist}`) : false);
    // For a language with its own script, check the playlist really is in it.
    const share = origin?.script ? list.songs.filter(inScript).length / list.songs.length : 1;
    if (origin?.script && share < 0.3) return;
    picked.push(candidates[i].title);
    for (const s of list.songs) {
      const mine = inScript(s);
      // In a mostly-in-language playlist, Latin-named songs are kept (many artists use Latin
      // names); in a mixed one, only the songs in that script are.
      if (origin?.script && !mine && share < 0.6) continue;
      pool.push({ s, rank: candidates[i].score + (mine ? 2 : 0) + Math.random() * 3 });
    }
  });

  // Best first, no repeats, no artist twice in a row, at most 3 per artist per batch.
  pool.sort((a, b) => b.rank - a.rank);
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const ordered: WebSong[] = [];
  for (const { s } of pool) {
    const key = `${norm(s.artist)}|${norm(s.title)}`;
    if (seen.has(s.videoId) || seen.has(key)) continue;
    const a = norm(s.artist.split(/,|&| x | feat/i)[0].trim());
    if ((perArtist.get(a) ?? 0) >= 3) continue;
    seen.add(s.videoId);
    seen.add(key);
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    ordered.push(s);
  }
  // Light shuffle within the ranking, keeping the same artist apart.
  const out: WebSong[] = [];
  const rest = ordered.slice();
  while (rest.length) {
    const window = rest.slice(0, 6);
    const last = out[out.length - 1]?.artist;
    const pick = window.findIndex((s) => s.artist !== last && Math.random() < 0.6);
    const i = pick >= 0 ? pick : window.findIndex((s) => s.artist !== last);
    out.push(rest.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return {
    songs: out.slice(0, 80),
    state: { q, used: [...used, ...usedNow] },
    picked,
  };
}

export const encodeState = (s: PromptState) => 'p:' + Buffer.from(JSON.stringify(s)).toString('base64url');
export function decodeState(token: string): PromptState | null {
  if (!token.startsWith('p:')) return null;
  try {
    const s = JSON.parse(Buffer.from(token.slice(2), 'base64url').toString('utf8'));
    return typeof s?.q === 'string' && Array.isArray(s.used) ? { q: s.q.slice(0, 150), used: s.used.slice(0, 60).map(String) } : null;
  } catch {
    return null;
  }
}
