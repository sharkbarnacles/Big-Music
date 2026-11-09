// Library page settings kept in the address (?view=artists&sort=name…).
export type LibraryView = 'songs' | 'artists' | 'videos';
export type LibraryParams = { q: string; view: LibraryView; sort: string; both: boolean; search: boolean };

export function defaultSort(view: LibraryView) {
  return view === 'artists' ? 'most' : 'artist';
}

export function libraryHref(p: LibraryParams, change: Partial<LibraryParams> = {}) {
  const n = { ...p, ...change };
  const qs = new URLSearchParams();
  if (n.search) qs.set('search', '1');
  if (n.q) qs.set('q', n.q);
  if (n.view !== 'songs') qs.set('view', n.view);
  if (n.sort && n.sort !== defaultSort(n.view)) qs.set('sort', n.sort);
  if (n.both && n.view !== 'artists') qs.set('both', '1');
  const s = qs.toString();
  return s ? `/library?${s}` : '/library?view=songs'; // plain /library opens the playlists
}

// What a song list is made of, so the app can fetch more of it (scrolling,
// or the player continuing past the songs already on screen).
// `tags`: tag ids joined by commas (songs from playlists with all of them).
export type TrackQuery = { q?: string; videos?: boolean; both?: boolean; artist?: string | null; sort?: string; tags?: string };

export function trackQueryString(t: TrackQuery): string {
  const qs = new URLSearchParams();
  if (t.q) qs.set('q', t.q);
  if (t.videos) qs.set('videos', '1');
  if (t.both) qs.set('both', '1');
  if (t.artist) qs.set('artist', t.artist);
  if (t.sort) qs.set('sort', t.sort);
  if (t.tags) qs.set('tags', t.tags);
  return qs.toString();
}

export function parseTrackQuery(qs: URLSearchParams): TrackQuery {
  return {
    q: qs.get('q') ?? undefined,
    videos: qs.get('videos') === '1',
    both: qs.get('both') === '1',
    artist: qs.get('artist'),
    sort: qs.get('sort') ?? undefined,
    tags: qs.get('tags') ?? undefined,
  };
}
