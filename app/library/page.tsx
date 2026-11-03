import Link from 'next/link';
import FilterMenu from '@/components/FilterMenu';
import Header from '@/components/Header';
import PlayButtons from '@/components/PlayButtons';
import TrackList from '@/components/TrackList';
import { db, fetchAllRows } from '@/lib/db';
import { defaultSort, libraryHref, type LibraryParams, type LibraryView } from '@/lib/libraryParams';
import { TRACK_COLUMNS, type TrackRowData } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

// Library (Library Top Lab pick T2 + F2 + V4 + A3, with a drop-down filter
// menu and Artists / Music videos views): title with round Shuffle and Play,
// one line of numbers, search box with a filter button, then the list.

const PAGE_SIZE = 200;

type Params = { q?: string; view?: string; sort?: string; both?: string; search?: string; artist?: string };
type ArtistRow = { artist: string; songs: number; videos: number; image_url: string | null };

// The main artist of a credit like "A, B feat. C" (same rule as the
// artist_summary database function).
const mainArtist = (credit: string) =>
  credit.split(/\s*(?:,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i)[0].trim().toLowerCase();

async function count(filter?: (q: any) => any): Promise<number> {
  let query = db().from('tracks').select('id', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count } = await query;
  return count ?? 0;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const view: LibraryView = sp.view === 'artists' || sp.view === 'videos' ? sp.view : 'songs';
  const params: LibraryParams = {
    q: sp.q ?? '',
    view,
    sort: sp.sort ?? defaultSort(view),
    both: sp.both === '1',
    search: sp.search === '1',
  };
  const artist = sp.artist?.trim() || null;
  // Remove characters that have special meaning in the database filter.
  const search = params.q.replace(/[,()%*\\]/g, ' ').trim();

  const [total, withVideo] = await Promise.all([count(), count((x) => x.not('video_id', 'is', null))]);

  // ── Artists view ──
  if (view === 'artists' && !artist) {
    const { data, error } = await db().rpc('artist_summary', {
      search: search || null,
      by_name: params.sort === 'name',
      limit_n: 300,
    });
    const artists = (data ?? []) as ArtistRow[];
    return (
      <main className="wrap">
        <Header />
        <Title title="Artists" />
        <p className="lib-line">
          <b>{total.toLocaleString()}</b> songs · <b>{withVideo.toLocaleString()}</b> videos
        </p>
        <SearchRow params={params} placeholder="Search artists" />
        {error && <div className="notice error">{error.message}</div>}
        <div className="list" style={{ marginTop: 12 }}>
          {artists.map((a) => (
            <Link className="item" key={a.artist} href={`/library?artist=${encodeURIComponent(a.artist)}`}>
              {a.image_url ? <img src={a.image_url} alt="" loading="lazy" className="artist-pic" /> : <div className="ph artist-pic" />}
              <div className="main">
                <div className="title">{a.artist}</div>
                <div className="sub">
                  {Number(a.songs).toLocaleString()} songs{Number(a.videos) ? ` · ${Number(a.videos).toLocaleString()} videos` : ''}
                </div>
              </div>
              <span className="muted" aria-hidden="true">›</span>
            </Link>
          ))}
          {artists.length === 0 && <p className="muted">No artists match.</p>}
          {artists.length === 300 && <p className="small muted">Showing 300 artists; search to find others.</p>}
        </div>
      </main>
    );
  }

  // ── One artist's songs ──
  if (artist) {
    const pattern = artist.replace(/[%_\\]/g, (c) => `\\${c}`);
    const { rows, error } = await fetchAllRows<TrackRowData>(
      (from, to) =>
        db().from('tracks').select(TRACK_COLUMNS).ilike('artist', `${pattern}%`).order('title').range(from, to) as any,
      5000,
    );
    const tracks = rows.filter((t) => mainArtist(t.artist) === artist.toLowerCase());
    const videos = tracks.filter((t) => t.video_id).length;
    return (
      <main className="wrap">
        <Header />
        <Link href={libraryHref({ ...params, view: 'artists', sort: 'most', q: '' })} className="small muted back-link">
          ‹ Artists
        </Link>
        <Title title={artist} tracks={tracks} />
        <p className="lib-line">
          <b>{tracks.length.toLocaleString()}</b> songs{videos ? <> · <b>{videos}</b> videos</> : null}
        </p>
        {error && <div className="notice error">{error}</div>}
        <div style={{ marginTop: 8 }}>
          <TrackList tracks={tracks} />
        </div>
      </main>
    );
  }

  // ── Songs and Music videos ──
  const buildQuery = (from: number, to: number): PromiseLike<any> => {
    let query: any = db().from('tracks').select(TRACK_COLUMNS);
    if (search) query = query.or(`title.ilike.%${search}%,artist.ilike.%${search}%,album.ilike.%${search}%`);
    if (view === 'videos') query = query.not('video_id', 'is', null);
    if (params.sort === 'recent') query = query.order('created_at', { ascending: false });
    if (params.sort === 'video') query = query.order('video_id', { ascending: true, nullsFirst: false });
    if (params.sort === 'title') query = query.order('title').order('artist');
    return query.order('artist').order('title').range(from, to);
  };
  // "Both services" has to look through every song, so it reads all pages.
  const { rows, error } = params.both
    ? await fetchAllRows<TrackRowData>(buildQuery)
    : await buildQuery(0, PAGE_SIZE - 1).then((r: any) => ({ rows: (r.data ?? []) as TrackRowData[], error: r.error?.message ?? null }));
  let tracks = rows;
  if (params.both) tracks = tracks.filter((t) => new Set(t.track_sources.map((s) => s.service)).size > 1).slice(0, PAGE_SIZE);
  const isVideos = view === 'videos';

  return (
    <main className="wrap">
      <Header />
      <Title title={isVideos ? 'Music videos' : 'Library'} tracks={tracks} video={isVideos} />
      <p className="lib-line">
        <b>{total.toLocaleString()}</b> songs · <b>{withVideo.toLocaleString()}</b> videos
      </p>
      <SearchRow params={params} placeholder={isVideos ? 'Search music videos' : 'Search title, artist or album'} />
      {error && <div className="notice error">{error}</div>}
      <div style={{ marginTop: 8 }}>
        <TrackList tracks={tracks} video={isVideos} />
        {tracks.length === 0 && <p className="muted">No songs match. Try another search or filter.</p>}
        {tracks.length === PAGE_SIZE && <p className="small muted">Showing the first {PAGE_SIZE}; search to find more.</p>}
      </div>
    </main>
  );
}

function Title({ title, tracks, video = false }: { title: string; tracks?: TrackRowData[]; video?: boolean }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      {tracks && <PlayButtons tracks={tracks} video={video} />}
    </div>
  );
}

// Search box with the filter button; keeps the current view and sort.
function SearchRow({ params, placeholder }: { params: LibraryParams; placeholder: string }) {
  return (
    <div className="search-row">
      <form method="get" action="/library" className="search-form" role="search">
        {params.search && <input type="hidden" name="search" value="1" />}
        {params.view !== 'songs' && <input type="hidden" name="view" value={params.view} />}
        {params.sort !== defaultSort(params.view) && <input type="hidden" name="sort" value={params.sort} />}
        {params.both && <input type="hidden" name="both" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={placeholder}
          autoFocus={params.search}
          aria-label={placeholder}
        />
      </form>
      <FilterMenu params={params} />
    </div>
  );
}
