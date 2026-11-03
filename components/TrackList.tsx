'use client';

import { useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlayer } from './Player';
import TrackRow from './TrackRow';

// A list of songs with Play / Shuffle buttons and the YouTube mode switch.
// Tapping a song plays it and lines up the rest of the list after it.
export default function TrackList({ tracks }: { tracks: TrackRowData[] }) {
  const player = usePlayer();
  const [menuFor, setMenuFor] = useState<number | null>(null);

  if (tracks.length === 0) return null;
  return (
    <div>
      <div className="list-actions">
        <button type="button" className="btn primary" onClick={() => player.playList(tracks, 0, { noShuffle: true })}>
          ▶ Play
        </button>
        <button type="button" className="btn" onClick={() => player.playList(tracks, -1, { shuffle: true })}>
          Shuffle
        </button>
        <label className="switch">
          <input
            type="checkbox"
            checked={player.youtubeMode}
            onChange={(e) => player.setYoutubeMode(e.target.checked)}
          />
          <span className="track" aria-hidden="true" />
          YouTube mode
        </label>
      </div>
      <div className="list">
        {tracks.map((t, i) => (
          <TrackRow
            key={`${t.id}-${i}`}
            track={t}
            active={player.current?.id === t.id}
            menuOpen={menuFor === i}
            onPlay={() => player.playList(tracks, i)}
            onVideo={() => player.playList(tracks, i, { video: true })}
            onMenu={(open) => setMenuFor(open ? i : null)}
            onPlayNext={() => {
              player.playNext(t);
              setMenuFor(null);
            }}
            onAddToQueue={() => {
              player.addToQueue(t);
              setMenuFor(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}
