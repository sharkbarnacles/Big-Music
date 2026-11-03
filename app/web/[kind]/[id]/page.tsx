import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import PlayButtons from '@/components/PlayButtons';
import PlaylistMenu from '@/components/PlaylistMenu';
import TrackList from '@/components/TrackList';
import { Tiles } from '@/components/WebResults';
import { smallCover } from '@/lib/img';
import { toPlayable } from '@/lib/webTracks';
import { browseArtist, browseCollection } from '@/lib/ytBrowse';

export const dynamic = 'force-dynamic';

// A playlist, album or artist from YouTube Music (found with Search →
// Everywhere). Songs play right here; ⋯ copies them all into one of your
// playlists, which also saves them to your library.
export default async function WebPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!/^[\w-]{6,80}$/.test(id)) notFound();

  if (kind === 'artist') {
    let artist;
    try {
      artist = await browseArtist(id);
    } catch (err) {
      return <Failed message={(err as Error).message} />;
    }
    const songs = await toPlayable(artist.songs).catch(() => []);
    return (
      <main className="wrap">
        <Header />
        <Back />
        <div className="mix-head">
          {artist.image ? <img className="web-artist-pic" src={smallCover(artist.image, 'tile')} alt="" /> : <span className="web-artist-pic" />}
          <div className="mix-titles">
            <div className="mix-badge">Artist</div>
            <h1>{artist.name}</h1>
            <div className="mix-meta"><span>on YouTube Music</span></div>
          </div>
        </div>
        {songs.length > 0 && (
          <section className="web-sec">
            <div className="web-sech">
              <h2>Top songs</h2>
              <PlayButtons tracks={songs} />
            </div>
            <TrackList tracks={songs} />
          </section>
        )}
        {artist.shelves.map((sh) => (
          <section key={sh.title} className="web-sec">
            <h2>{sh.title}</h2>
            <Tiles items={sh.items} />
          </section>
        ))}
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
        <PlayButtons tracks={tracks} />
        <PlaylistMenu id={id} name={page.title} hub={false} tracks={tracks.map((t) => ({ id: t.id, title: t.title }))} />
      </div>
      {tracks.length ? <TrackList tracks={tracks} /> : <p className="muted">This {page.kind} has no songs the hub can play.</p>}
      <div className="mix-end" aria-hidden="true" />
    </main>
  );
}

function Back() {
  return (
    <Link href="/library?search=1&where=web" className="muted small d-back">
      ‹ Search
    </Link>
  );
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
