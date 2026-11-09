'use client';

import Link from 'next/link';
import { useState } from 'react';
import { smallCover } from '@/lib/img';
import type { SavedAlbum } from '@/lib/savedAlbums';
import { usePlayer } from './Player';

// The "Albums" chip: every album you've starred, newest first. Tap a row to
// open the album; the round button plays it straight away.
export default function AlbumList({ albums }: { albums: SavedAlbum[] }) {
  const player = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? albums.filter((a) => `${a.title} ${a.artist ?? ''}`.toLowerCase().includes(needle)) : albums;

  const play = async (a: SavedAlbum) => {
    if (busy) return;
    setBusy(a.browse_id);
    try {
      const res = await fetch(`/api/speed-dial/play?albumId=${encodeURIComponent(a.browse_id)}`);
      const body = await res.json();
      if (res.ok && body.tracks?.length) player.playList(body.tracks, 0, { noShuffle: true, from: body.from ?? a.title });
    } finally {
      setBusy(null);
    }
  };

  if (!albums.length) return <p className="muted">Tap the star on an album’s page to save it here.</p>;

  return (
    <>
      {albums.length > 8 && (
        <input
          type="search"
          className="radio-filter"
          placeholder="Find an album"
          aria-label="Find an album"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <ul className="radio-list">
        {shown.map((a) => (
          <li key={a.browse_id}>
            <Link href={`/web/album/${encodeURIComponent(a.browse_id)}`} className="radio-row">
              {a.image_url ? (
                <img className="album-cover" src={smallCover(a.image_url)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="album-cover" aria-hidden="true" />
              )}
              <span className="radio-text">
                <span className="radio-name">{a.title}</span>
                <span className="radio-meta">{[a.artist, a.subtitle].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
            <button
              type="button"
              className={`radio-play${busy === a.browse_id ? ' busy' : ''}`}
              aria-label={`Play ${a.title}`}
              onClick={() => play(a)}
            >
              {busy === a.browse_id ? <span className="play-spin" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted small">No album matches “{q}”.</p>}
    </>
  );
}
