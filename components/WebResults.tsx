import Link from 'next/link';
import TrackList from '@/components/TrackList';
import PlayButtons from '@/components/PlayButtons';
import { smallCover } from '@/lib/img';
import { toPlayable } from '@/lib/webTracks';
import { searchEverywhere, type WebItem } from '@/lib/ytBrowse';

// Search "Everywhere": all of YouTube Music, not just your library. Songs
// play right here; artists, albums and other people's playlists open their
// own pages. Songs you already have show as yours.
export default async function WebResults({ q }: { q: string }) {
  let found;
  try {
    found = await searchEverywhere(q);
  } catch (err) {
    return <div className="notice error">{(err as Error).message} Try again in a moment.</div>;
  }
  const songs = await toPlayable(found.songs.slice(0, 10)).catch(() => []);
  const nothing = !songs.length && !found.artists.length && !found.albums.length && !found.playlists.length;
  if (nothing) return <p className="muted">Nothing found on YouTube Music. Try other words.</p>;

  return (
    <div className="web-results">
      {songs.length > 0 && (
        <section className="web-sec">
          <div className="web-sech">
            <h2>Songs</h2>
            <PlayButtons tracks={songs} />
          </div>
          <TrackList tracks={songs} />
        </section>
      )}
      {found.artists.length > 0 && (
        <section className="web-sec">
          <h2>Artists</h2>
          <Tiles items={found.artists} />
        </section>
      )}
      {found.albums.length > 0 && (
        <section className="web-sec">
          <h2>Albums & singles</h2>
          <Tiles items={found.albums} />
        </section>
      )}
      {found.playlists.length > 0 && (
        <section className="web-sec">
          <h2>Playlists</h2>
          <div className="list">
            {found.playlists.map((p) => (
              <Link key={p.id} href={webHref(p)} className="item web-pl">
                {p.image ? <img src={smallCover(p.image)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />}
                <div className="main">
                  <div className="title">{p.title}</div>
                  <div className="sub">{p.subtitle}</div>
                </div>
                <span className="muted" aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function webHref(item: WebItem) {
  return `/web/${item.kind}/${encodeURIComponent(item.id)}`;
}

// A sideways row of covers (round for artists).
export function Tiles({ items }: { items: WebItem[] }) {
  return (
    <div className="web-tiles">
      {items.map((it) => (
        <Link key={it.id} href={webHref(it)} className={`web-tile${it.kind === 'artist' ? ' round' : ''}`}>
          <span className="web-cover">{it.image ? <img src={smallCover(it.image, 'tile')} alt="" loading="lazy" decoding="async" /> : null}</span>
          <span className="web-nm">{it.title}</span>
          <span className="web-sub">{it.subtitle.replace(/^(Artist|Album|Playlist) • /, '')}</span>
        </Link>
      ))}
    </div>
  );
}
