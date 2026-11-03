'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { ArtistRow } from '@/lib/libraryQuery';
import MoreLoader from './MoreLoader';

// Every artist, loading more as you scroll. Tap one to see their songs.
export default function ArtistList({ initial, query }: { initial: ArtistRow[]; query: string }) {
  const [artists, setArtists] = useState(initial);
  const [done, setDone] = useState(initial.length < 200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const more = async () => {
    if (busy.current || done) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/artists?${query}&offset=${artists.length}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const got: ArtistRow[] = body.artists ?? [];
      setArtists((a) => [...a, ...got]);
      if (got.length < 200) setDone(true);
    } catch (e) {
      setError((e as Error).message || 'error');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="list">
      {artists.map((a) => (
        <Link className="item" key={a.artist} href={`/library?artist=${encodeURIComponent(a.artist)}`}>
          {a.image_url ? <img src={a.image_url} alt="" loading="lazy" className="artist-pic" /> : <div className="ph artist-pic" />}
          <div className="main">
            <div className="title">{a.artist}</div>
            <div className="sub">
              {a.songs.toLocaleString()} songs{a.videos ? ` · ${a.videos.toLocaleString()} videos` : ''}
            </div>
          </div>
          <span className="muted" aria-hidden="true">›</span>
        </Link>
      ))}
      {artists.length === 0 && <p className="muted">No artists match.</p>}
      {!done && <MoreLoader onVisible={more} loading={loading} error={error} />}
    </div>
  );
}
