// Builds an artist's whole discography (lib/discographyBuild.ts) from
// GitHub's servers and prints a summary of each sort.
// Run by .github/workflows/probe-ytm.yml with script=disco, q=<UC… id>.
import { buildDiscography, sortDiscography, playsLabel } from '../lib/discographyBuild';
const id = process.env.Q?.startsWith('UC') ? process.env.Q : 'UCpgnHFZuUinGBUV70IRZkJw';
const t = Date.now();
const d = await buildDiscography(id);
console.log(`DISCO ${d.name}: ${d.songs.length} songs from ${d.releases} releases in ${Date.now() - t} ms`);
for (const s of ['popular', 'plays', 'new', 'old'] as const) {
  const list = sortDiscography(d.songs, s);
  console.log(`SORT ${s}: ` + list.slice(0, 6).map((x) => `${x.title} [${x.year ?? '?'}, ${playsLabel(x.plays) ?? '-'}, ${x.from}, pop ${x.popRank ?? '-'}]`).join(' | '));
}
console.log('NO PLAYS', d.songs.filter((x) => !x.plays).length, 'WITH POP RANK', d.songs.filter((x) => x.popRank !== null).length);
