// One-off probe for the "whole discography" artist view: prints what YouTube
// Music sends for an artist's songs list, an album's rows and the albums list.
// Run by .github/workflows/probe-ytm.yml with script=artist.
const CTX = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251015.03.00', hl: 'en', gl: 'US' } };
const H = { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const call = async (ep, body) => (await fetch(`https://music.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, { method: 'POST', headers: H, body: JSON.stringify({ context: CTX, ...body }) })).json();
const text = (t) => (t?.runs ?? []).map((r) => r.text).join('');
const cols = (r) => (r?.flexColumns ?? []).map((c) => text(c?.musicResponsiveListItemFlexColumnRenderer?.text));
const fixed = (r) => (r?.fixedColumns ?? []).map((c) => text(c?.musicResponsiveListItemFixedColumnRenderer?.text));
const id = process.env.Q && process.env.Q.startsWith('UC') ? process.env.Q : 'UCpgnHFZuUinGBUV70IRZkJw';
const page = await call('browse', { browseId: id });
const secs = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
let songsBe = null, albumId = null;
const discos = [];
for (const s of secs) {
  if (s.musicShelfRenderer) {
    const sh = s.musicShelfRenderer;
    console.log('SHELF', text(sh.title), JSON.stringify(sh.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint), JSON.stringify(sh.bottomEndpoint?.browseEndpoint));
    songsBe = sh.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint ?? sh.bottomEndpoint?.browseEndpoint;
    for (const c of (sh.contents ?? []).slice(0, 3)) console.log('  TOP ROW', JSON.stringify(cols(c.musicResponsiveListItemRenderer)), JSON.stringify(fixed(c.musicResponsiveListItemRenderer)));
  }
  const car = s.musicCarouselShelfRenderer;
  if (car) {
    const h = car.header?.musicCarouselShelfBasicHeaderRenderer;
    const be = h?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint ?? h?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
    console.log('CAROUSEL', text(h?.title), be?.browseId, be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType);
    const first = car.contents?.[0]?.musicTwoRowItemRenderer;
    if (first) console.log('  ITEM', text(first.title), '|', text(first.subtitle), first.navigationEndpoint?.browseEndpoint?.browseId);
    if (/ALBUM|SINGLE/i.test(text(h?.title)) && !albumId) albumId = first?.navigationEndpoint?.browseEndpoint?.browseId;
    if (be?.params && /DISCOGRAPHY/.test(be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '')) discos.push(be);
  }
}
if (songsBe?.browseId) {
  const pl = await call('browse', { browseId: songsBe.browseId, ...(songsBe.params ? { params: songsBe.params } : {}) });
  const two = pl?.contents?.twoColumnBrowseResultsRenderer;
  const head = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
  console.log('SONGS PAGE', text(head?.title), '|', text(head?.secondSubtitle));
  const shelf = two?.secondaryContents?.sectionListRenderer?.contents?.[0];
  const list = shelf?.musicPlaylistShelfRenderer ?? shelf?.musicShelfRenderer;
  const rows = list?.contents ?? [];
  console.log('  rows', rows.length, 'continuation', Boolean(rows[rows.length - 1]?.continuationItemRenderer));
  for (const c of rows.slice(0, 5)) console.log('  ROW', JSON.stringify(cols(c.musicResponsiveListItemRenderer)), JSON.stringify(fixed(c.musicResponsiveListItemRenderer)));
  if (!two) console.log('  keys', Object.keys(pl?.contents ?? {}));
}
if (albumId) {
  const al = await call('browse', { browseId: albumId });
  const two = al?.contents?.twoColumnBrowseResultsRenderer;
  const head = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
  console.log('ALBUM', text(head?.title), '|', text(head?.subtitle), '|', text(head?.secondSubtitle));
  const shelf = two?.secondaryContents?.sectionListRenderer?.contents?.[0];
  const rows = (shelf?.musicShelfRenderer ?? shelf?.musicPlaylistShelfRenderer)?.contents ?? [];
  for (const c of rows.slice(0, 4)) console.log('  ROW', JSON.stringify(cols(c.musicResponsiveListItemRenderer)), JSON.stringify(fixed(c.musicResponsiveListItemRenderer)));
}
for (const be of discos.slice(0, 2)) {
  const d = await call('browse', { browseId: be.browseId, params: be.params });
  const items = [];
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (o.musicTwoRowItemRenderer) { items.push(o.musicTwoRowItemRenderer); return; } for (const v of Object.values(o)) walk(v); };
  walk(d?.contents);
  console.log('DISCO', items.length, items.slice(0, 4).map((i) => text(i.title) + ' | ' + text(i.subtitle)).join(' || '));
  console.log('  continuation?', JSON.stringify(d).includes('continuationItemRenderer') || JSON.stringify(d).includes('nextContinuationData'));
}
