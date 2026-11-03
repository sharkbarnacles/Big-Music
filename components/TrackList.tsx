'use client';

import { useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlayer } from './Player';
import TrackRow from './TrackRow';

// A list of songs. Tapping one plays it and lines up the rest of the list
// after it. With `video`, songs play their music video.
// (Play / Shuffle buttons live in each page's title row: PlayButtons.)
export default function TrackList({ tracks, video = false }: { tracks: TrackRowData[]; video?: boolean }) {
  const player = usePlayer();
  const [menuFor, setMenuFor] = useState<number | null>(null);

  if (tracks.length === 0) return null;
  return (
    <div className="list">
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`}
          track={t}
          active={player.current?.id === t.id}
          menuOpen={menuFor === i}
          onPlay={() => player.playList(tracks, i, { video })}
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
  );
}
