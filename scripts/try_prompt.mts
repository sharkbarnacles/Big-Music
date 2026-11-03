// Tries radio-from-words on a few prompts and saves what it picked.
// Run by .github/workflows/try-prompt.yml (manual) with `npx tsx`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { promptRadio } from '../lib/promptRadio';
const prompts = (process.env.PROMPTS || 'niche underground chill thai').split('|');
mkdirSync('probe', { recursive: true });
const out: any = {};
for (const p of prompts) {
  const t = Date.now();
  const b = await promptRadio(p, null).catch((e) => ({ error: String(e) }) as any);
  out[p] = { ms: Date.now() - t, used: b.state?.used, songs: (b.songs ?? []).map((s: any) => `${s.title} — ${s.artist}`), error: b.error };
  console.log(p, out[p].used, out[p].songs?.length);
}
writeFileSync('probe/prompt.json', JSON.stringify(out, null, 1));
