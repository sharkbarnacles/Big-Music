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
  return s ? `/library?${s}` : '/library';
}
