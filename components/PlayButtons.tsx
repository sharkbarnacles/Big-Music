'use client';

import type { TrackRowData } from '@/lib/tracks';
import { usePlayer } from './Player';

// The spiral used for Shuffle everywhere in the app.
export const SPIRAL =
  'M12 12a1.5 1.5 0 0 1 1.5 1.5a3 3 0 0 1-3 3a4.5 4.5 0 0 1-4.5-4.5a6 6 0 0 1 6-6a7.5 7.5 0 0 1 7.5 7.5';

// Round Shuffle (spiral) and Play buttons for the top of a list.
// With `video`, songs that have a music video play it.
export default function PlayButtons({ tracks, video = false }: { tracks: TrackRowData[]; video?: boolean }) {
  const player = usePlayer();
  if (tracks.length === 0) return null;
  return (
    <span className="play-buttons">
      <button
        type="button"
        className="round-btn"
        aria-label="Shuffle"
        onClick={() => player.playList(tracks, -1, { shuffle: true, video })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SPIRAL} /></svg>
      </button>
      <button
        type="button"
        className="round-btn play"
        aria-label="Play"
        onClick={() => player.playList(tracks, 0, { noShuffle: true, video })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
    </span>
  );
}
