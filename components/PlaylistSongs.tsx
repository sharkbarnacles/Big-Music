'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlaylistPicker } from './PlaylistPicker';
import TrackList from './TrackList';

// The songs on a playlist page. Press and hold a song to start selecting
// (Playlist Tools Lab pick S2); tap others to add them. The bar at the top:
// how many, Select all, Copy to… and, in your own (hub) playlists, Move to…
// and Remove. Spotify / YouTube playlists can only be copied from: the next
// import would put removed songs back. Hub playlists also keep "Remove from
// this playlist" in each song's ⋯ menu. (Deployed 2026-11-04.)
export default function PlaylistSongs({
  playlistId,
  hub,
  tracks: initial,
  positions: initialPositions,
}: {
  playlistId: string;
  hub: boolean;
  tracks: TrackRowData[];
  positions: number[];
}) {
  const router = useRouter();
  const pick = usePlaylistPicker();
  const [rows, setRows] = useState({ tracks: initial, positions: initialPositions });
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const removePositions = async (positions: number[]) => {
    const res = await fetch(`/api/hub-playlists/${playlistId}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
  };
  // Take songs off the page at once; put them back if the server says no.
  const dropRows = async (indexes: number[]) => {
    const gone = new Set(indexes);
    const before = rows;
    setRows((r) => ({ tracks: r.tracks.filter((_, j) => !gone.has(j)), positions: r.positions.filter((_, j) => !gone.has(j)) }));
    try {
      await removePositions(indexes.map((i) => before.positions[i]));
      router.refresh();
    } catch (e) {
      setRows(before);
      throw e;
    }
  };

  const chosen = () => [...(selected ?? [])].sort((a, b) => a - b);
  const done = () => setSelected(null);
  const toggle = (i: number) =>
    setSelected((old) => {
      const next = new Set(old ?? []);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const copy = () => {
    const idx = chosen();
    if (!idx.length) return;
    pick(idx.map((i) => rows.tracks[i]), { verb: 'Copy', exclude: playlistId });
    done();
  };
  const move = () => {
    const idx = chosen();
    if (!idx.length) return;
    pick(idx.map((i) => rows.tracks[i]), {
      verb: 'Move',
      exclude: playlistId,
      onAdded: async () => {
        await dropRows(idx);
        done();
      },
    });
  };
  const removeSelected = async () => {
    const idx = chosen();
    if (!idx.length) return;
    setError(null);
    try {
      await dropRows(idx);
      done();
    } catch (e) {
      setError((e as Error).message || 'Couldn’t remove them. Try again.');
    }
  };
  const removeOne = async (i: number) => {
    setError(null);
    try {
      await dropRows([i]);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t remove it. Try again.');
    }
  };

  const n = selected?.size ?? 0;
  const all = n === rows.tracks.length && n > 0;

  return (
    <>
      {selected && (
        <div className="sel-top" role="toolbar" aria-label="Selected songs">
          <div className="sel-line">
            <button type="button" className="sel-x" aria-label="Stop selecting" onClick={done}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <span className="sel-count">{n === 0 ? 'Tap songs to pick them' : `${n.toLocaleString()} selected`}</span>
            <button
              type="button"
              className="sel-all"
              onClick={() => setSelected(all ? new Set() : new Set(rows.tracks.map((_, i) => i)))}
            >
              {all ? 'Select none' : 'Select all'}
            </button>
          </div>
          <div className="sel-acts">
            <button type="button" disabled={!n} onClick={copy}>Copy to…</button>
            {hub && (
              <button type="button" className="primary" disabled={!n} onClick={move}>Move to…</button>
            )}
            {hub && (
              <button type="button" className="danger" disabled={!n} onClick={removeSelected}>Remove</button>
            )}
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <TrackList
        tracks={rows.tracks}
        onRemove={hub ? removeOne : undefined}
        selected={selected}
        onHold={(i) => setSelected(new Set([i]))}
        onToggle={toggle}
      />
      {rows.tracks.length > 0 && !selected && (
        <p className="small muted sel-hint">Press and hold a song to select several.</p>
      )}
      {rows.tracks.length === 0 && hub && (
        <p className="muted">
          No songs yet. Tap ⋯ on any song in your Library or another playlist and choose Add to playlist.
        </p>
      )}
    </>
  );
}
