'use client';

import type { TrackRowData } from '@/lib/tracks';
import { SPIRAL } from '@/lib/icons';
import { PLAYER_ICONS } from '@/lib/playerIcons';
import { usePlayer, type QueueSource } from './Player';

// Round Shuffle (spiral) and Play buttons for the top of a list.
// With `video`, songs that have a music video play it. With `source`, they
// cover the whole list, not just the songs loaded on screen.
// With `radio` (a playlist), a UFO button left of Shuffle starts a radio of
// songs like the whole playlist.
// With `playNext` (an album or playlist's name), a queue button left of
// Shuffle puts the whole list straight after the current song, in order.
export default function PlayButtons({
  tracks,
  video = false,
  source,
  radio,
  playNext,
}: {
  tracks: TrackRowData[];
  video?: boolean;
  source?: QueueSource;
  radio?: { playlistId: string; name: string };
  playNext?: string;
}) {
  const player = usePlayer();
  if (tracks.length === 0) return null;
  return (
    <span className="play-buttons">
      {radio && (
        <button
          type="button"
          className="round-btn"
          aria-label="Start a radio from this playlist"
          title="Radio from this playlist"
          disabled={!tracks.some((t) => t.yt_audio_id)}
          onClick={() => player.startPlaylistRadio(radio.playlistId, radio.name)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="picon" dangerouslySetInnerHTML={{ __html: PLAYER_ICONS.radio }} />
        </button>
      )}
      {playNext && (
        <button
          type="button"
          className="round-btn"
          aria-label={`Play ${playNext} next`}
          title="Play next"
          onClick={() => player.playNext(tracks, playNext)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h13M3 12h13M3 18h9M17 15l5 3-5 3z" /></svg>
        </button>
      )}
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
