'use client';

import { useRef } from 'react';
import { sourceUrl, type TrackRowData } from '@/lib/tracks';
import { smallCover } from '@/lib/img';

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// One song in a list. Tap it to play; the ⋯ button opens Play next,
// Add to queue, Add to playlist, the music video, and links to Spotify / YouTube.
export default function TrackRow({
  track,
  active,
  menuOpen,
  onPlay,
  onVideo,
  onMenu,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onRadio,
  onRemove,
  selecting = false,
  checked = false,
  onHold,
}: {
  track: TrackRowData;
  active: boolean;
  menuOpen: boolean;
  onPlay: () => void;
  onVideo: () => void;
  onMenu: (open: boolean) => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
  onRadio?: () => void; // only for songs with a YouTube version
  onRemove?: () => void; // only in your hub playlists
  // Select mode (Playlist Tools Lab S2): press and hold a song to start
  // selecting; while selecting, a tap ticks or unticks the song.
  selecting?: boolean;
  checked?: boolean;
  onHold?: () => void;
}) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  const holdProps = onHold
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          clearHold();
          const h = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
          h.timer = window.setTimeout(() => {
            h.fired = true;
            onHold();
          }, 450);
          hold.current = h;
        },
        onPointerMove: (e: React.PointerEvent) => {
          const h = hold.current;
          if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) clearHold();
        },
        onPointerUp: clearHold,
        onPointerCancel: clearHold,
        onPointerLeave: clearHold,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {};
  const tap = () => {
    // The tap that ends a long press doesn't also play the song.
    if (hold.current?.fired) {
      hold.current = null;
      return;
    }
    onPlay();
  };

  const spotify = sourceUrl(track, 'spotify');
  const youtube = sourceUrl(track, 'youtube');

  return (
    <div className={`item${active ? ' active' : ''}${selecting ? ' selecting' : ''}${checked ? ' checked' : ''}`}>
      <button
        type="button"
        className="row-play"
        onClick={tap}
        {...holdProps}
        aria-pressed={selecting ? checked : undefined}
        aria-label={selecting ? `${checked ? 'Untick' : 'Tick'} ${track.title} by ${track.artist}` : `Play ${track.title} by ${track.artist}`}
      >
        {track.image_url ? <img src={smallCover(track.image_url)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />}
        <div className="main">
          <div className="title">{track.title}</div>
          <div className="sub">
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </div>
        </div>
      </button>
      {selecting ? (
        <span className={`tick${checked ? ' on' : ''}`} aria-hidden="true" onClick={onPlay} />
      ) : (
      <div className="end">
        <span className="dur">{formatDuration(track.duration_ms)}</span>
        {track.video_id && (
          <button type="button" className="icon-btn video" aria-label={`Watch the music video for ${track.title}`} onClick={onVideo}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 5h18v14H3zM10 9l5 3-5 3z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={`More options for ${track.title}`}
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
        </button>
      </div>
      )}

      {menuOpen && !selecting && (
        <>
          <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => onMenu(false)} />
          <div className="row-menu" role="menu">
            <button type="button" role="menuitem" onClick={onPlayNext}>Play next</button>
            <button type="button" role="menuitem" onClick={onAddToQueue}>Add to queue</button>
            <button type="button" role="menuitem" onClick={onAddToPlaylist}>Add to playlist…</button>
            {onRadio && <button type="button" role="menuitem" onClick={onRadio}>Start radio</button>}
            {onRemove && (
              <button type="button" role="menuitem" className="danger-item" onClick={onRemove}>
                Remove from this playlist
              </button>
            )}
            {track.video_id && (
              <button type="button" role="menuitem" onClick={() => { onMenu(false); onVideo(); }}>
                Watch music video
              </button>
            )}
            {spotify && (
              <a role="menuitem" href={spotify} target="_blank" rel="noreferrer" onClick={() => onMenu(false)}>
                Open in Spotify
              </a>
            )}
            {youtube && (
              <a role="menuitem" href={youtube} target="_blank" rel="noreferrer" onClick={() => onMenu(false)}>
                Open in YouTube Music
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
