import ActionButton from '@/components/ActionButton';
import Header from '@/components/Header';
import TrackList from '@/components/TrackList';
import { TRACK_COLUMNS, type TrackRowData } from '@/lib/tracks';
import { db, fetchAllRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;
const SEARCH_BATCH = 40; // 40 searches × 100 units = 4,000 of the 10,000 daily quota

type Params = { q?: string; video?: string; both?: string; sort?: string; search?: string };

async function count(filter?: (q: any) => any): Promise<number> {
  let query = db().from('tracks').select('id', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count } = await query;
  return count ?? 0;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { q = '', video = '', both, sort = 'artist', search: searchTab } = await searchParams;
  // Remove characters that have special meaning in the database filter.
  const search = q.replace(/[,()%*\\]/g, ' ').trim();

  const buildQuery = (from: number, to: number): PromiseLike<any> => {
    let query: any = db().from('tracks').select(TRACK_COLUMNS);
    if (search) query = query.or(`title.ilike.%${search}%,artist.ilike.%${search}%,album.ilike.%${search}%`);
    if (video === 'yes') query = query.not('video_id', 'is', null);
    if (video === 'no') query = query.eq('video_status', 'none');
    if (video === 'unchecked') query = query.is('video_status', null);
    if (sort === 'video') query = query.order('video_id', { ascending: true, nullsFirst: false });
    return query.order('artist').order('title').range(from, to);
  };

  // "Both services" has to look through every song, so it reads all pages.
  const [{ rows, error }, total, withVideo, noVideo, unchecked] = await Promise.all([
    both
      ? fetchAllRows<TrackRowData>(buildQuery)
      : buildQuery(0, PAGE_SIZE - 1).then((r: any) => ({ rows: (r.data ?? []) as TrackRowData[], error: r.error?.message ?? null })),
    count(),
    count((x) => x.not('video_id', 'is', null)),
    count((x) => x.eq('video_status', 'none')),
    count((x) => x.is('video_status', null)),
  ]);
  let tracks = rows;
  if (both) tracks = tracks.filter((t) => t.track_sources.length > 1).slice(0, PAGE_SIZE);

  return (
    <main className="wrap">
      <Header />
      <h1>Library</h1>

      <div className="stats">
        <div><b>{total}</b><span className="muted small">songs</span></div>
        <div><b>{withVideo}</b><span className="muted small">with music video</span></div>
        <div><b>{noVideo}</b><span className="muted small">no video found</span></div>
        <div><b>{unchecked}</b><span className="muted small">not checked yet</span></div>
      </div>

      <form method="get" className="filters">
        {searchTab === '1' && <input type="hidden" name="search" value="1" />}
        <input type="search" name="q" defaultValue={q} placeholder="Search title, artist or album" autoFocus={searchTab === '1'} aria-label="Search your library" />
        <select name="video" defaultValue={video} aria-label="Music video filter">
          <option value="">All songs</option>
          <option value="yes">Has music video</option>
          <option value="no">No music video</option>
          <option value="unchecked">Not checked yet</option>
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort">
          <option value="artist">Sort: artist</option>
          <option value="video">Sort: videos first</option>
        </select>
        <label>
          <input type="checkbox" name="both" value="1" defaultChecked={Boolean(both)} />
          On both services
        </label>
        <button type="submit">Apply</button>
      </form>
      {tracks.length === PAGE_SIZE && (
        <div className="small muted">Showing the first {PAGE_SIZE}; search or filter to narrow down.</div>
      )}

      {unchecked > 0 && (
        // Collapsed by default: tap the line to open it.
        <details className="card collapsible" style={{ marginTop: 16 }}>
          <summary className="small muted">
            Checking {unchecked.toLocaleString()} songs for music videos
          </summary>
          <div className="small muted" style={{ margin: '10px 0' }}>
            The video finder runs automatically every night in GitHub and checks a few thousand songs
            each time. To check some right now, use YouTube’s official search:
            {` ${SEARCH_BATCH} songs per tap, using ${(SEARCH_BATCH * 100).toLocaleString()} of your 10,000 daily quota units.`}
          </div>
          <ActionButton
            url={`/api/videos/find?limit=${SEARCH_BATCH}`}
            label={`Find videos for ${SEARCH_BATCH} songs`}
            busyLabel="Searching YouTube…"
          />
        </details>
      )}

      {error && <div className="notice error">{error}</div>}

      <div style={{ marginTop: 16 }}>
        <TrackList tracks={tracks} />
        {tracks.length === 0 && <p className="muted">No songs match. Import a service from the home page, or change the filters.</p>}
      </div>
    </main>
  );
}
