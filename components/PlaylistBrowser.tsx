'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';

// Playlists on Home (Playlist Sort Lab pick S1 + G3 + K1 + P1):
// one mixed list, newest first by default, a "Sort" drop-down, and chips to
// show only your hub playlists ("Mine"), Spotify or YouTube.
// "New playlist" makes a playlist inside the hub.

export type PlaylistCard = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  count: number;
  last_added_at: string | null;
};

type Sort = 'recent' | 'az' | 'size';
type Show = 'all' | 'hub' | 'spotify' | 'youtube';

const SORTS: { id: Sort; label: string; short: string }[] = [
  { id: 'recent', label: 'Recently updated', short: 'Recent' },
  { id: 'az', label: 'Alphabetical', short: 'A–Z' },
  { id: 'size', label: 'Most songs', short: 'Most songs' },
];
const SHOWS: { id: Show; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hub', label: 'Mine' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'youtube', label: 'YouTube' },
];
const KEY = 'musichub.playlistView';

function ago(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default function PlaylistBrowser({ playlists }: { playlists: PlaylistCard[] }) {
  const [sort, setSort] = useState<Sort>('recent');
  const [show, setShow] = useState<Show>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const newPlaylist = usePlaylistPicker();

  // Remember your last choice on this phone.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.sort && SORTS.some((s) => s.id === saved.sort)) setSort(saved.sort);
      if (saved?.show && SHOWS.some((s) => s.id === saved.show)) setShow(saved.show);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sort, show }));
    } catch {
      /* ignore */
    }
  }, [sort, show]);

  const list = useMemo(() => {
    const shown = playlists.filter((p) => show === 'all' || p.service === show);
    const byName = (a: PlaylistCard, b: PlaylistCard) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return shown.sort((a, b) => {
      if (sort === 'az') return byName(a, b);
      if (sort === 'size') return b.count - a.count || byName(a, b);
      // Recently updated: newest first; playlists without a date go last.
      const ta = a.last_added_at ? Date.parse(a.last_added_at) : 0;
      const tb = b.last_added_at ? Date.parse(b.last_added_at) : 0;
      return tb - ta || byName(a, b);
    });
  }, [playlists, sort, show]);

  const missingDates = sort === 'recent' && playlists.some((p) => !p.last_added_at);
  const current = SORTS.find((s) => s.id === sort)!;

  return (
    <section className="playlists">
      <div className="pl-head">
        <h2>Playlists</h2>
        <button type="button" className="pl-new" onClick={() => newPlaylist([])}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New playlist
        </button>
      </div>

      {/* Sort and the service chips share one line (it scrolls sideways on very narrow phones). */}
      <div className="pl-controls-wrap">
        <div className="pl-controls">
          <button
            type="button"
            className="pl-sort-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Sort: ${current.short}`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
            {current.short}
          </button>
          <span className="pl-divider" aria-hidden="true" />
          <div className="pl-chips" role="group" aria-label="Show playlists from">
            {SHOWS.map((s) => (
              <button key={s.id} type="button" className="pl-chip" aria-pressed={show === s.id} onClick={() => setShow(s.id)}>
                {s.id !== 'all' && <span className={`dot ${s.id}`} />}
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {menuOpen && (
          <>
            <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="row-menu pl-menu" role="menu">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sort === s.id}
                  onClick={() => {
                    setSort(s.id);
                    setMenuOpen(false);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="list">
        {list.map((p) => (
          <Link className="item pl-row" key={p.id} href={`/playlists/${p.id}`}>
            {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <div className="ph" />}
            <div className="main">
              <div className="title">{p.name}</div>
              <div className="sub pl-meta">
                <span className={`dot ${p.service}`} />
                {p.service === 'spotify' ? 'Spotify' : p.service === 'youtube' ? 'YouTube' : 'Music Hub'} · {p.count.toLocaleString()} songs
                {sort === 'recent' && p.last_added_at ? ` · ${ago(p.last_added_at)}` : ''}
              </div>
            </div>
            <span className="muted" aria-hidden="true">›</span>
          </Link>
        ))}
        {list.length === 0 && <p className="muted">No playlists here yet.</p>}
      </div>

      {missingDates && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Some playlists don’t have an “updated” date yet. Tap Import playlists in Services once for each service to fill
          them in.
        </p>
      )}
    </section>
  );
}
