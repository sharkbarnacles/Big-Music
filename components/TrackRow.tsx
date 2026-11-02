export type TrackRowData = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  image_url: string | null;
  video_id: string | null;
  track_sources: { service: string; url: string | null }[];
};

// Columns every song list asks the database for.
export const TRACK_COLUMNS =
  'id, title, artist, album, duration_ms, image_url, video_id, track_sources(service, url)';

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// One song in a list. The coloured badges link to it on each service.
// (Playing inside the app comes in phase 2.)
export default function TrackRow({ track }: { track: TrackRowData }) {
  return (
    <div className="item">
      {track.image_url ? <img src={track.image_url} alt="" loading="lazy" /> : <div className="ph" />}
      <div className="main">
        <div className="title">{track.title}</div>
        <div className="sub">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </div>
      </div>
      <div className="end">
        <span className="dur">{formatDuration(track.duration_ms)}</span>
        {track.video_id && (
          <a
            className="badge video"
            href={`https://www.youtube.com/watch?v=${track.video_id}`}
            target="_blank"
            rel="noreferrer"
          >
            ▶ Video
          </a>
        )}
        {track.track_sources.map((s) => (
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
