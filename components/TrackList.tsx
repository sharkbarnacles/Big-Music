'use client';

import type { TrackRowData } from '@/lib/tracks';
import { usePlayer } from './Player';
import TrackRow from './TrackRow';

// A list of songs. Tapping one plays it and lines up the songs after it.
export default function TrackList({ tracks }: { tracks: TrackRowData[] }) {
  const { now, play } = usePlayer();
  return (
    <div className="list">
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`}
          track={t}
          active={now?.track.id === t.id}
          onPlay={() => play(tracks, i, 'audio')}
          onVideo={() => play(tracks, i, 'video')}
        />
      ))}
    </div>
  );
}
