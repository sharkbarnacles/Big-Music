'use client';

import type { TrackRowData } from '@/lib/tracks';
import { SPIRAL } from '@/lib/icons';
import { usePlayer, type QueueSource } from './Player';

// Round Shuffle (spiral) and Play buttons for the top of a list.
// With `video`, songs that have a music video play it. With `source`, they
// cover the whole list, not just the songs loaded on screen.
export default function PlayButtons({
  tracks,
  video = false,
  source,
}: {
  tracks: TrackRowData[];
  video?: boolean;
  source?: QueueSource;
}) {
  const player = usePlayer();
  if (tracks.length === 0) return null;
  return (
    <span className="play-buttons">
      <button
        type="button"
        className="round-btn"
        aria-label="Shuffle"
        onClick={() => player.playList(tracks, -1, { shuffle: true, video, source })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SPIRAL} /></svg>
      </button>
      <button
        type="button"
        className="round-btn play"
        aria-label="Play"
        onClick={() => player.playList(tracks, 0, { noShuffle: true, video, source })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
    </span>
  );
}
