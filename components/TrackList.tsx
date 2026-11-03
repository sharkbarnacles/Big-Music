'use client';

import { useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlayer, type QueueSource } from './Player';
import { usePlaylistPicker } from './PlaylistPicker';
import TrackRow from './TrackRow';

// A list of songs. Tapping one plays it and lines up the rest of the list
// after it (with `source`, the rest of the whole list, even songs not loaded
// yet). With `video`, songs play their music video. `onRemove` adds
// "Remove from this playlist" to each row's menu.
// (Play / Shuffle buttons live in each page's title row: PlayButtons.)
export default function TrackList({
  tracks,
  video = false,
  source,
  onRemove,
}: {
  tracks: TrackRowData[];
  video?: boolean;
  source?: QueueSource;
  onRemove?: (index: number) => void;
}) {
  const player = usePlayer();
  const pick = usePlaylistPicker();
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
          onPlay={() => player.playList(tracks, i, { video, source })}
          onVideo={() => player.playList(tracks, i, { video: true, source })}
          onMenu={(open) => setMenuFor(open ? i : null)}
          onPlayNext={() => {
            player.playNext(t);
            setMenuFor(null);
          }}
          onAddToQueue={() => {
            player.addToQueue(t);
            setMenuFor(null);
          }}
          onAddToPlaylist={() => {
            setMenuFor(null);
            pick([t]);
          }}
          onRadio={
            t.yt_audio_id
              ? () => {
                  setMenuFor(null);
                  player.startRadio(t);
                }
              : undefined
          }
          onRemove={
            onRemove
              ? () => {
                  setMenuFor(null);
                  onRemove(i);
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
