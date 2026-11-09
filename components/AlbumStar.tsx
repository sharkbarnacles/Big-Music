'use client';

import { useEffect, useState } from 'react';
import { PLAYER_ICONS } from '@/lib/playerIcons';

// The soft star on an album page: saves the album to "Albums" (the chip on
// Home / Library playlists). Same look as the keep star on songs.
export default function AlbumStar({
  album,
}: {
  album: { id: string; title: string; artist: string | null; subtitle: string | null; image: string | null; count: number };
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/albums?id=${encodeURIComponent(album.id)}`)
      .then((r) => r.json())
      .then((d) => alive && setOn(Boolean(d.saved)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [album.id]);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch('/api/albums', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? album : { id: album.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setMsg(next ? 'Saved to your albums' : 'Removed from your albums');
    } catch (err) {
      setOn(!next);
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 1600);
    }
  }

  return (
    <>
      <button
        type="button"
        className="d-heart album-star"
        aria-pressed={on}
        aria-label={on ? 'Remove from your albums' : 'Save to your albums'}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: on ? PLAYER_ICONS.kept : PLAYER_ICONS.keep }} />
      </button>
      {msg && (
        <span className="d-toast" role="status">
          {msg}
        </span>
      )}
    </>
  );
}
