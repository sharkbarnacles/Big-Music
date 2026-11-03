'use client';

import type { TrackRowData } from '@/lib/tracks';

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// One song in a list. Tap the song to play it; tap "▶ Video" to watch its
// music video. The Spotify / YouTube badges open the song on that service.
export default function TrackRow({
  track,
  active,
  onPlay,
  onVideo,
}: {
  track: TrackRowData;
  active: boolean;
  onPlay: () => void;
  onVideo: () => void;
}) {
  // A song can be linked twice on one service; show each service once.
  const services = track.track_sources.filter(
    (s, i, all) => all.findIndex((o) => o.service === s.service) === i,
  );

  return (
    <div className={`item${active ? ' active' : ''}`}>
      <button type="button" className="row-play" onClick={onPlay} aria-label={`Play ${track.title} by ${track.artist}`}>
        {track.image_url ? <img src={track.image_url} alt="" loading="lazy" /> : <div className="ph" />}
        <div className="main">
          <div className="title">{track.title}</div>
          <div className="sub">
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </div>
        </div>
      </button>
      <div className="end">
        <span className="dur">{formatDuration(track.duration_ms)}</span>
        {track.video_id && (
          <button type="button" className="badge video" onClick={onVideo}>
            ▶ Video
          </button>
        )}
        {services.map((s) => (
          <a
            key={s.service}
            className={`badge ${s.service}`}
            href={s.url ?? '#'}
            target="_blank"
            rel="noreferrer"
          >
            {s.service === 'spotify' ? 'Spotify' : 'YouTube'}
          </a>
        ))}
      </div>
    </div>
  );
}
