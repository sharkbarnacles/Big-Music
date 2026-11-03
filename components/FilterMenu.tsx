'use client';

import Link from 'next/link';
import { useState } from 'react';
import { defaultSort, libraryHref, type LibraryParams, type LibraryView } from '@/lib/libraryParams';

// The filter button beside the Library search box. It drops down a menu
// with the view (Songs, Artists, Music videos), the sort order and the
// "on both services" filter. Choices apply right away.

const VIEWS: { id: LibraryView; label: string }[] = [
  { id: 'songs', label: 'Songs' },
  { id: 'artists', label: 'Artists' },
  { id: 'videos', label: 'Music videos' },
];
const SONG_SORTS = [
  { id: 'artist', label: 'Artist A–Z' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'recent', label: 'Recently added' },
  { id: 'video', label: 'Videos first' },
];
const ARTIST_SORTS = [
  { id: 'most', label: 'Most songs' },
  { id: 'name', label: 'Name A–Z' },
];

export default function FilterMenu({ params }: { params: LibraryParams }) {
  const [open, setOpen] = useState(false);
  const sorts = params.view === 'artists' ? ARTIST_SORTS : SONG_SORTS.filter((s) => params.view === 'songs' || s.id !== 'video');
  const active =
    (params.view !== 'songs' ? 1 : 0) + (params.sort !== defaultSort(params.view) ? 1 : 0) + (params.both ? 1 : 0);
  const close = () => setOpen(false);

  return (
    <div className="filter-menu">
      <button
        type="button"
        className="filter-btn"
        aria-label={`Sort and filter${active ? ` (${active} on)` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        {active > 0 && <span className="filter-count">{active}</span>}
      </button>
      {open && (
        <>
          <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={close} />
          <div className="row-menu filter-drop" role="menu">
            <span className="menu-label">Show</span>
            {VIEWS.map((v) => (
              <Link
                key={v.id}
                role="menuitemradio"
                aria-checked={params.view === v.id}
                href={libraryHref(params, { view: v.id, sort: defaultSort(v.id) })}
                onClick={close}
              >
                {v.label}
              </Link>
            ))}
            <span className="menu-label">Sort</span>
            {sorts.map((s) => (
              <Link key={s.id} role="menuitemradio" aria-checked={params.sort === s.id} href={libraryHref(params, { sort: s.id })} onClick={close}>
                {s.label}
              </Link>
            ))}
            {params.view !== 'artists' && (
              <>
                <span className="menu-label">Filter</span>
                <Link role="menuitemcheckbox" aria-checked={params.both} href={libraryHref(params, { both: !params.both })} onClick={close}>
                  Only songs on both services
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
