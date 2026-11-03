// One-off probe: saves YouTube Music's raw answers to search and browse
// requests, so the hub's parsers can be written against real data.
// Run by .github/workflows/probe-ytm.yml (manual). Output: probe/*.json
import { mkdirSync, writeFileSync } from 'node:fs';
const CTX = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251015.03.00', hl: 'en', gl: 'US' } };
const H = { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const call = async (ep, body) => {
  const r = await fetch(`https://music.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, { method: 'POST', headers: H, body: JSON.stringify({ context: CTX, ...body }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
mkdirSync('probe', { recursive: true });
const save = (n, d) => writeFileSync(`probe/${n}.json`, JSON.stringify(d, null, 1));
const q = process.env.Q || 'matryoshka hachi';
const F = {
  all: undefined,
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  community: 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=',
  featured: 'EgeKAQQoADgBagwQDhAKEAMQBBAJEAU=',
};
const res = {};
for (const [k, params] of Object.entries(F)) { res[k] = await call('search', { query: q, ...(params ? { params } : {}) }); save(`search_${k}`, res[k]); }
// Find a playlist and an album id from the results, then browse them.
const txt = JSON.stringify(res);
const pl = (txt.match(/"browseId":"(VL[\w-]+)"/) || [])[1];
const al = (txt.match(/"browseId":"(MPREb_[\w-]+)"/) || [])[1];
const ar = (txt.match(/"browseId":"(UC[\w-]{20,})"/) || [])[1];
if (pl) save('browse_playlist', await call('browse', { browseId: pl }));
if (al) save('browse_album', await call('browse', { browseId: al }));
if (ar) save('browse_artist', await call('browse', { browseId: ar }));
console.log({ pl, al, ar, status: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.status])) });
