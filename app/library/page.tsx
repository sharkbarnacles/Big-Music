import Form from 'next/form';
import Link from 'next/link';
import ArtistList from '@/components/ArtistList';
import FilterMenu from '@/components/FilterMenu';
import Header from '@/components/Header';
import LibraryList from '@/components/LibraryList';
import PlaylistBrowser from '@/components/PlaylistBrowser';
import { loadPlaylistCards } from '@/lib/playlistCards';
import { listTags } from '@/lib/playlistTags';
import PlayButtons from '@/components/PlayButtons';
import RadioList, { RadiosPill } from '@/components/RadioList';
import { loadRadios } from '@/lib/radioList';
import WebResults from '@/components/WebResults';
import { db } from '@/lib/db';
import {
  defaultSort,
  libraryHref,
  trackQueryString,
  type LibraryParams,
  type LibraryView,
  type TrackQuery,
} from '@/lib/libraryParams';
import { loadArtists, loadTracks } from '@/lib/libraryQuery';
import type { TrackRowData } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

// Library (Library Top Lab pick T2 + F2 + V4 + A3, with a drop-down filter
// menu and Artists / Music videos views): title with round Shuffle and Play,
// one line of numbers, search box with a filter button, then the list.
// Every list holds the whole library: more loads as you scroll, and Play /
// Shuffle carry on through all of it.

const PAGE_SIZE = 200;

type Params = { q?: string; view?: string; sort?: string; both?: string; search?: string; artist?: string; where?: string; tags?: string };

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
  const search = params.q.trim();

  // ── Search everywhere (all of YouTube Music) ──
  if (sp.where === 'web') {
    return (
      <main className="wrap">
        <Header />
        <Title title="Search" />
        <SearchRow params={{ ...params, search: true }} placeholder="Songs, artists, albums, playlists" web />
        <WhereSwitch q={search} web />
        <div style={{ marginTop: 8 }}>
          {search ? <WebResults q={search} /> : <p className="muted">Search all of YouTube Music, including playlists other people made.</p>}
        </div>
      </main>
    );
  }

  // ── Radios (the pill beside the numbers) ──
  if (sp.view === 'radios') {
    const { radios, error } = await loadRadios();
    return (
      <main className="wrap">
        <Header />
        <Title title="Radios" />
        <p className="lib-line with-pill">
          <span>
            <b>{radios.length.toLocaleString()}</b> {radios.length === 1 ? 'radio' : 'radios'}
          </span>
          <RadiosPill on />
        </p>
        {error && <div className="notice error">{error}</div>}
        <div style={{ marginTop: 8 }}>
          <RadioList radios={radios} />
        </div>
      </main>
    );
  }

  // ── Playlists (the switch at the start of the search line) ──
  if (sp.view === 'playlists') {
    const chosen = (sp.tags ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const [{ cards, error }, tags, total] = await Promise.all([loadPlaylistCards(), listTags().catch(() => []), count()]);
    return (
      <main className="wrap">
        <Header />
        <Title title="Library" />
        <p className="lib-line with-pill">
          <span>
            <b>{total.toLocaleString()}</b> songs · <b>{cards.length.toLocaleString()}</b> playlists
          </span>
          <RadiosPill />
        </p>
        {error && <div className="notice error">{error}</div>}
        <PlaylistBrowser playlists={cards} tags={tags} view="playlists" initialTags={chosen} base="/library" />
      </main>
    );
  }

  // ── Artists view ──
  if (view === 'artists' && !artist) {
    const [{ artists, error }, total, withVideo] = await Promise.all([
      loadArtists(search, params.sort === 'name', 0, PAGE_SIZE),
      count(),
      count((x) => x.not('video_id', 'is', null)),
    ]);
    const query = new URLSearchParams({ q: search, sort: params.sort }).toString();
    return (
      <main className="wrap">
        <Header />
        <Title title="Artists" />
        <p className="lib-line with-pill">
          <span>
            <b>{total.toLocaleString()}</b> songs · <b>{withVideo.toLocaleString()}</b> videos
          </span>
          <RadiosPill />
        </p>
        <SearchRow params={params} placeholder="Search artists" />
        {error && <div className="notice error">{error}</div>}
        <div style={{ marginTop: 12 }}>
          <ArtistList key={query} initial={artists} query={query} />
        </div>
      </main>
    );
  }

  // ── One artist's songs ──
  if (artist) {
    const tq: TrackQuery = { artist, sort: 'title' };
    const { tracks, total, error } = await loadTracks(tq, 0, PAGE_SIZE);
    const all = total ?? tracks.length;
    const videos = tracks.filter((t) => t.video_id).length;
    const query = trackQueryString(tq);
    return (
      <main className="wrap">
        <Header />
        <Link href={libraryHref({ ...params, view: 'artists', sort: 'most', q: '' })} className="small muted back-link">
          ‹ Artists
        </Link>
        <Title title={artist} tracks={tracks} source={{ query, total: all }} />
        <p className="lib-line">
          <b>{all.toLocaleString()}</b> songs
          {videos && all <= PAGE_SIZE ? (
            <>
              {' '}· <b>{videos}</b> videos
            </>
          ) : null}
        </p>
        {error && <div className="notice error">{error}</div>}
        <div style={{ marginTop: 8 }}>
          <LibraryList key={query} initial={tracks} total={all} query={query} />
        </div>
      </main>
    );
  }

  // ── Songs and Music videos ──
  const isVideos = view === 'videos';
  const tq: TrackQuery = { q: search, videos: isVideos, both: params.both, sort: params.sort };
  const query = trackQueryString(tq);
  const [{ tracks, total, error }, all, withVideo] = await Promise.all([
    loadTracks(tq, 0, PAGE_SIZE),
    count(),
    count((x) => x.not('video_id', 'is', null)),
  ]);
  const matching = total ?? tracks.length;
  const filtered = Boolean(search) || params.both;

  return (
    <main className="wrap">
      <Header />
      <Title
        title={isVideos ? 'Music videos' : 'Library'}
        tracks={tracks}
        video={isVideos}
        source={{ query, total: matching }}
      />
      <p className="lib-line with-pill">
        <span>
        {filtered ? (
          <>
            <b>{matching.toLocaleString()}</b> {isVideos ? 'videos' : 'songs'} match
          </>
        ) : (
          <>
            <b>{all.toLocaleString()}</b> songs · <b>{withVideo.toLocaleString()}</b> videos
          </>
        )}
        </span>
        {!params.search && <RadiosPill />}
      </p>
      <SearchRow params={params} placeholder={isVideos ? 'Search music videos' : 'Search title, artist or album'} />
      {(params.search || search) && !isVideos && <WhereSwitch q={search} web={false} />}
      {error && <div className="notice error">{error}</div>}
      <div style={{ marginTop: 8 }}>
        <LibraryList key={query} initial={tracks} total={matching} query={query} video={isVideos} />
        {tracks.length === 0 && <p className="muted">No songs match. Try another search or filter.</p>}
      </div>
    </main>
  );
}

function Title({
  title,
  tracks,
  video = false,
  source,
}: {
  title: string;
  tracks?: TrackRowData[];
  video?: boolean;
  source?: { query: string; total: number };
}) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      {tracks && <PlayButtons tracks={tracks} video={video} source={source} />}
    </div>
  );
}

// Search box with the filter button; keeps the current view and sort.
// "Your library" or "Everywhere" under the search box; keeps what you typed.
function WhereSwitch({ q, web }: { q: string; web: boolean }) {
  const base = new URLSearchParams({ search: '1', ...(q ? { q } : {}) });
  const everywhere = new URLSearchParams({ search: '1', where: 'web', ...(q ? { q } : {}) });
  return (
    <div className="where-switch" role="tablist" aria-label="Where to search">
      <Link href={`/library?${base}`} role="tab" aria-selected={!web} className={!web ? 'on' : undefined}>
        Your library
      </Link>
      <Link href={`/library?${everywhere}`} role="tab" aria-selected={web} className={web ? 'on' : undefined}>
        Everywhere
      </Link>
    </div>
  );
}

function SearchRow({ params, placeholder, web = false }: { params: LibraryParams; placeholder: string; web?: boolean }) {
  return (
    <div className="search-row">
      {!web && !params.search && <LibrarySwitch />}
      {/* next/form searches inside the app; a plain <form> reloaded the whole page,
          which threw away the player and stopped the music. */}
      <Form action="/library" className="search-form" role="search">
        {params.search && <input type="hidden" name="search" value="1" />}
        {params.view !== 'songs' && !web && <input type="hidden" name="view" value={params.view} />}
        {params.sort !== defaultSort(params.view) && !web && <input type="hidden" name="sort" value={params.sort} />}
        {params.both && !web && <input type="hidden" name="both" value="1" />}
        {web && <input type="hidden" name="where" value="web" />}
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={placeholder}
          autoFocus={params.search}
          aria-label={placeholder}
        />
      </Form>
      {!web && <FilterMenu params={params} />}
    </div>
  );
}

// Playlists ↔ all music, the same two-icon switch as on Home. The Library's
// song, artist and video views are the "music" side.
function LibrarySwitch() {
  return (
    <span className="home-switch" role="group" aria-label="Show">
      <Link href="/library?view=playlists" aria-pressed="false" aria-label="Playlists">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="12" height="12" rx="2" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /></svg>
      </Link>
      <Link href="/library" aria-pressed="true" aria-label="All music">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
      </Link>
    </span>
  );
}
