// Compares YouTube Music's plain radio with the era-aware gathering
// (lib/seedRadio.ts) for one song, from GitHub's servers.
// Run by .github/workflows/probe-ytm.yml with script=radio, q="<title> | <artist>".
import { fetchRadio, searchStudioSong } from '../lib/ytRadio';
import { seedRadioStart, eraFit } from '../lib/seedRadio';
const [title, artist] = (process.env.Q || 'Romeo+Juliette | SHINee').split('|').map((s) => s.trim());
const id = await searchStudioSong(title, artist);
if (!id) throw new Error('song not found');
const hist = (ys: (number | null)[]) => {
  const m = new Map<string, number>();
  for (const y of ys) m.set(String(y ?? '?'), (m.get(String(y ?? '?')) ?? 0) + 1);
  return [...m].sort().map(([y, n]) => `${y}:${n}`).join(' ');
};
const plain = await fetchRadio({ videoId: id });
console.log(`SEED ${title} / ${artist} → ${id}`);
console.log(`PLAIN (${plain.songs.length}) years: ${hist(plain.songs.map((s) => s.year))}`);
console.log('PLAIN first 15: ' + plain.songs.slice(0, 15).map((s) => `${s.artist} – ${s.title} [${s.year ?? '?'}]`).join(' | '));
const t = Date.now();
const r = await seedRadioStart(id);
console.log(`ERA seed=${JSON.stringify(r.seed)} pool=${r.songs.length} in ${Date.now() - t} ms, token ${r.continuation?.length ?? 0} chars`);
console.log(`ERA pool years: ${hist(r.songs.map((s) => s.year))}`);
const ranked = r.songs
  .map((s, i) => ({ s, score: 2.6 * eraFit(r.seed.year, s.year) - 0.006 * i }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 49)
  .map((x) => x.s);
console.log(`ERA top 49 years: ${hist(ranked.map((s) => s.year))}`);
console.log('ERA top 49: ' + ranked.map((s) => `${s.artist} – ${s.title} [${s.year ?? '?'}]`).join(' | '));
if (r.continuation) {
  const { seedRadioMore } = await import('../lib/seedRadio');
  const m = await seedRadioMore(r.continuation);
  console.log(`MORE ${m?.songs.length} songs, years: ${hist((m?.songs ?? []).map((s) => s.year))}`);
}
