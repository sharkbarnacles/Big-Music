'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import TrackList from './TrackList';

// Songs in one of your hub playlists: like any list, plus
// "Remove from this playlist" in each song's menu.
export default function HubTrackList({
  playlistId,
  tracks: initial,
  positions: initialPositions,
}: {
  playlistId: string;
  tracks: TrackRowData[];
  positions: number[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState({ tracks: initial, positions: initialPositions });
  const [error, setError] = useState<string | null>(null);

  const remove = async (i: number) => {
    const position = rows.positions[i];
    setError(null);
    setRows((r) => ({ tracks: r.tracks.filter((_, j) => j !== i), positions: r.positions.filter((_, j) => j !== i) }));
    try {
      const res = await fetch(`/api/hub-playlists/${playlistId}/items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || 'Couldn’t remove it. Try again.');
      setRows({ tracks: initial, positions: initialPositions });
    }
  };

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <TrackList tracks={rows.tracks} onRemove={remove} />
      {rows.tracks.length === 0 && (
        <p className="muted">
          No songs yet. Tap ⋯ on any song in your Library or another playlist and choose Add to playlist.
        </p>
      )}
    </>
  );
}
