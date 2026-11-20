import Link from 'next/link';
import { notFound } from 'next/navigation';
import AlbumStar from '@/components/AlbumStar';
import BackButton from '@/components/BackButton';
import Header from '@/components/Header';
import PlayButtons from '@/components/PlayButtons';
import PlaylistMenu from '@/components/PlaylistMenu';
import TrackList from '@/components/TrackList';
import { Tiles } from '@/components/WebResults';
import { smallCover } from '@/lib/img';
import { toPlayable } from '@/lib/webTracks';
import { browseArtist, browseCollection, browseDiscography } from '@/lib/ytBrowse';
import { loadTracks } from '@/lib/libraryQuery';
import { loadDiscography, playsLabel, sortDiscography, type DiscoSort } from '@/lib/discography';
import type { TrackRowData } from '@/lib/tracks';
import { trackQueryString } from '@/lib/libraryParams';

export const dynamic = 'force-dynamic';
// A whole discography opens every album the first time (a few seconds, more for huge artists).
export const maxDuration = 60;

// A playlist, album or artist from YouTube Music (found with Search →
// Everywhere). Songs play right here; ⋯ copies them all into one of your
// playlists, which also saves them to your library.
export default async function WebPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ p?: string; t?: string; a?: string; name?: string; sort?: string }>;
}) {
  const { kind, id: raw } = await params;
  const sp = await searchParams;
  const id = decodeURIComponent(raw);
  if (!/^[\w-]{6,80}$/.test(id)) notFound();

  // An artist's full albums or singles (the "See all" on their page).
  if (kind === 'discography') {
    let page;
    try {
      page = await browseDiscography(id, sp.p ?? '');
    } catch (err) {
      return <Failed message={(err as Error).message} />;
    }
    return (
      <main className="wrap">
        <Header />
        <Back />
        <div className="mix-titles" style={{ marginTop: 10 }}>
          <div className="mix-badge">{sp.a || 'Artist'}</div>
          <h1>{sp.t || page.title}</h1>
          <div className="mix-meta"><span>{page.items.length} releases</span></div>
        </div>
        <section className="web-sec">
          {page.items.length ? <Tiles items={page.items} grid /> : <p className="muted">YouTube Music sent nothing here.</p>}
        </section>
        <div className="mix-end" aria-hidden="true" />
      </main>
    );
  }

  // An artist's whole discography as one song list (every album and single),
  // sortable: popular now / most played / newest / oldest.
  if (kind === 'songs') {
    let disco;
    try {
      disco = await loadDiscography(id);
    } catch (err) {
      return <Failed message={(err as Error).message} />;
    }
    const sort: DiscoSort = (['popular', 'plays', 'new', 'old'] as const).find((x) => x === sp.sort) ?? 'popular';
    const sorted = sortDiscography(disco.songs, sort);
    const tracks = await playableInChunks(sorted.map((x) => x));
    tracks.forEach((t, i) => {
      t.note = [sorted[i].year, playsLabel(sorted[i].plays)].filter(Boolean).join(' · ') || null;
    });
    const name = sp.name || disco.name;
    const href = (to: DiscoSort) => `/web/songs/${encodeURIComponent(id)}?${new URLSearchParams({ ...(sp.name ? { name: sp.name } : {}), sort: to })}`;
    const SORTS: [DiscoSort, string][] = [
      ['popular', 'Popular now'],
      ['plays', 'Most played'],
      ['new', 'Newest'],
      ['old', 'Oldest'],
    ];
    return (
      <main className="wrap">
        <Header />
        <Back />
        <div className="mix-head">
          {disco.image ? <img className="web-artist-pic" src={smallCover(disco.image, 'tile')} alt="" /> : <span className="web-artist-pic" />}
          <div className="mix-titles">
            <div className="mix-badge">Whole discography</div>
            <h1>{name}</h1>
            <div className="mix-meta">
              <span>{tracks.length.toLocaleString()} songs</span>
              <span>{disco.releases} releases</span>
            </div>
          </div>
        </div>
        <div className="mix-acts">
          <PlayButtons tracks={tracks} playNext={`${name}'s discography`} />
        </div>
        <div className="disco-sorts" role="tablist" aria-label="Sort songs">
          {SORTS.map(([k, label]) => (
            <Link key={k} href={href(k)} replace scroll={false} className={`btn chip${sort === k ? ' on' : ''}`} role="tab" aria-selected={sort === k}>
              {label}
            </Link>
          ))}
        </div>
        {tracks.length ? <TrackList tracks={tracks} /> : <p className="muted">YouTube Music sent no songs for this artist.</p>}
        <div className="mix-end" aria-hidden="true" />
      </main>
    );
  }

  if (kind === 'artist') {
    let artist;
    try {
      artist = await browseArtist(id);
    } catch (err) {
      return <Failed message={(err as Error).message} />;
    }
    // Your own songs by them (the name you tapped, else YouTube Music's).
    const libName = (sp.name || artist.name).trim();
    const libQuery = { artist: libName, sort: 'title' };
    const [songs, mine] = await Promise.all([
      toPlayable(artist.songs).catch(() => []),
      loadTracks(libQuery, 0, 200).catch(() => ({ tracks: [], total: 0, error: null })),
    ]);
    const mineTotal = mine.total ?? mine.tracks.length;
    // Discography first (albums, singles), then everything else YouTube Music shows.
    const disco = (t: string) => /^(albums|singles|singles & eps|eps)$/i.test(t.trim());
    const shelves = [...artist.shelves.filter((sh) => disco(sh.title)), ...artist.shelves.filter((sh) => !disco(sh.title))];
    return (
      <main className="wrap">
        <Header />
        <Back />
        <div className="mix-head">
          {artist.image ? <img className="web-artist-pic" src={smallCover(artist.image, 'tile')} alt="" /> : <span className="web-artist-pic" />}
          <div className="mix-titles">
            <div className="mix-badge">Artist</div>
            <h1>{artist.name}</h1>
            <div className="mix-meta">
              <span>on YouTube Music</span>
              {mineTotal > 0 && <span>{mineTotal.toLocaleString()} in your library</span>}
            </div>
          </div>
        </div>
        <Link className="disco-all" href={`/web/songs/${encodeURIComponent(id)}?${new URLSearchParams({ name: artist.name })}`}>
          <span className="disco-all-text">
            <b>Whole discography</b>
            <small>Every song from every album and single · sort by popular, plays or release</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
        {songs.length > 0 && (
          <section className="web-sec">
            <div className="web-sech">
              <h2>Top songs</h2>
              <PlayButtons tracks={songs} />
            </div>
            <TrackList tracks={songs} />
          </section>
        )}
        {shelves.map((sh) => (
          <section key={sh.title} className="web-sec">
            <div className="web-sech">
              <h2>{sh.title}</h2>
              {sh.more && (
                <Link
                  className="small web-more"
                  href={`/web/discography/${encodeURIComponent(sh.more.id)}?${new URLSearchParams({ p: sh.more.params, t: sh.title, a: artist.name })}`}
                >
                  See all ›
                </Link>
              )}
            </div>
            <Tiles items={sh.items} />
          </section>
        ))}
        {mineTotal > 0 && (
          <section className="web-sec">
            <div className="web-sech">
              <h2>In your library</h2>
              <PlayButtons tracks={mine.tracks} source={{ query: trackQueryString(libQuery), total: mineTotal }} />
            </div>
            <TrackList tracks={mine.tracks.slice(0, 5)} source={{ query: trackQueryString(libQuery), total: mineTotal }} />
            {mineTotal > 5 && (
              <Link className="small web-more" href={`/library?artist=${encodeURIComponent(libName)}`}>
                All {mineTotal.toLocaleString()} of your songs by {libName} ›
              </Link>
            )}
          </section>
        )}
        <div className="mix-end" aria-hidden="true" />
      </main>
    );
  }

  if (kind !== 'playlist' && kind !== 'album') notFound();
  let page;
  try {
    page = await browseCollection(id);
  } catch (err) {
    return <Failed message={(err as Error).message} />;
  }
  const tracks = await toPlayable(page.songs).catch(() => []);
  const meta = [page.owner, page.details || `${tracks.length} songs`].filter(Boolean) as string[];
  return (
    <main className="wrap">
      <Header />
      <Back />
      <div className="mix-head">
        {page.image ? <img className="web-big-cover" src={smallCover(page.image, 'tile')} alt="" /> : <span className="web-big-cover" />}
        <div className="mix-titles">
          <div className="mix-badge">{page.subtitle || (page.kind === 'album' ? 'Album' : 'Playlist')}</div>
          <h1>{page.title}</h1>
          <div className="mix-meta">{meta.map((m) => <span key={m}>{m}</span>)}</div>
        </div>
      </div>
      <div className="mix-acts">
        <PlayButtons tracks={tracks} playNext={page.title} />
        {page.kind === 'album' && (
          <AlbumStar
            album={{ id, title: page.title, artist: page.owner, subtitle: page.subtitle || null, image: page.image, count: tracks.length }}
          />
        )}
        <PlaylistMenu id={id} name={page.title} hub={false} tracks={tracks.map((t) => ({ id: t.id, title: t.title }))} />
      </div>
      {tracks.length ? <TrackList tracks={tracks} /> : <p className="muted">This {page.kind} has no songs the hub can play.</p>}
      <div className="mix-end" aria-hidden="true" />
    </main>
  );
}

// Back to wherever you came from (an artist page when you opened one of
// their albums, the search otherwise); the search if there's nothing before.
function Back() {
  return <BackButton fallback="/library?search=1&where=web" />;
}

function Failed({ message }: { message: string }) {
  return (
    <main className="wrap">
      <Header />
      <Back />
      <div className="notice error" style={{ marginTop: 12 }}>{message} Try again in a moment.</div>
    </main>
  );
}

// toPlayable looks songs up in the database by id; big discographies are
// done 300 at a time so the request stays a normal size.
async function playableInChunks(songs: Parameters<typeof toPlayable>[0]): Promise<TrackRowData[]> {
  const parts: (typeof songs)[] = [];
  for (let i = 0; i < songs.length; i += 300) parts.push(songs.slice(i, i + 300));
  const done = await Promise.all(parts.map((p) => toPlayable(p).catch(() => [] as TrackRowData[])));
  return done.flat();
}
