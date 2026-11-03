// Shared song types, used by both server pages and the player in the browser.
// (Kept out of component files so server pages can import the real values.)

export type TrackSource = {
  service: string; // 'spotify' | 'youtube'
  external_id: string;
  url: string | null;
};

export type TrackRowData = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  image_url: string | null;
  video_id: string | null;
  track_sources: TrackSource[];
};

// Columns every song list asks the database for.
export const TRACK_COLUMNS =
  'id, title, artist, album, duration_ms, image_url, video_id, track_sources(service, external_id, url)';

// The song's ID on a service (first one, if it's there more than once).
export function sourceId(track: TrackRowData, service: 'spotify' | 'youtube'): string | null {
  return track.track_sources.find((s) => s.service === service)?.external_id ?? null;
}

export function sourceUrl(track: TrackRowData, service: 'spotify' | 'youtube'): string | null {
  return track.track_sources.find((s) => s.service === service)?.url ?? null;
}
