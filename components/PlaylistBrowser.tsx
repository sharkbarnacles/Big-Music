'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';
import { smallCover } from '@/lib/img';

// Playlists on Home (Playlist Sort Lab pick S1 + G3 + K1 + P1):
// one mixed list, newest first by default, a "Sort" drop-down, and chips to
// show only your hub playlists ("Mine"), Spotify or YouTube.
// "New playlist" makes a playlist inside the hub.
// Set aside folder (Playlist Tools Lab pick F2 + M3): a dim "Set aside" chip,
// only shown once something is in it; those playlists leave the other lists
// and stop shaping your taste profile. "Select" ticks several playlists, then
// one button sets them all aside (or brings them back, inside the folder).

export type PlaylistCard = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  count: number;
  last_added_at: string | null;
  set_aside: boolean;
};

type Sort = 'recent' | 'az' | 'size';
type Show = 'all' | 'hub' | 'spotify' | 'youtube' | 'aside';

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
  const router = useRouter();
  // Changes you just made, shown at once (the page refreshes behind them).
  const [moved, setMoved] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const aside = (p: PlaylistCard) => moved[p.id] ?? p.set_aside;

  // Remember your last choice on this phone.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.sort && SORTS.some((s) => s.id === saved.sort)) setSort(saved.sort);
      if (saved?.show && (saved.show === 'aside' || SHOWS.some((s) => s.id === saved.show))) setShow(saved.show);
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
    const shown = playlists.filter((p) =>
      show === 'aside' ? aside(p) : !aside(p) && (show === 'all' || p.service === show),
    );
    const byName = (a: PlaylistCard, b: PlaylistCard) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return shown.sort((a, b) => {
      if (sort === 'az') return byName(a, b);
      if (sort === 'size') return b.count - a.count || byName(a, b);
      // Recently updated: newest first; playlists without a date go last.
      const ta = a.last_added_at ? Date.parse(a.last_added_at) : 0;
      const tb = b.last_added_at ? Date.parse(b.last_added_at) : 0;
      return tb - ta || byName(a, b);
    });
  }, [playlists, sort, show, moved]);

  const missingDates = sort === 'recent' && playlists.some((p) => !p.last_added_at);
  const current = SORTS.find((s) => s.id === sort)!;
  const asideCount = playlists.filter(aside).length;
  // An empty folder goes away; go back to All.
  useEffect(() => {
    if (show === 'aside' && asideCount === 0) setShow('all');
  }, [show, asideCount]);

  // Switching chips starts a fresh pick (no hidden playlists stay ticked).
  useEffect(() => setPicked(new Set()), [show]);

  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const putAside = async (value: boolean) => {
    const ids = [...picked];
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/playlists/set-aside', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, aside: value }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setMoved((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, value])) }));
      stopSelecting();
      const n = ids.length === 1 ? '1 playlist' : `${ids.length} playlists`;
      setNote(value ? `Set aside ${n}` : `Brought back ${n}`);
      setTimeout(() => setNote(null), 2500);
      router.refresh();
    } catch (e) {
      setNote((e as Error).message || 'Couldn’t do that. Try again.');
      setTimeout(() => setNote(null), 3500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="playlists">
      <div className="pl-head">
        <h2>{show === 'aside' ? 'Set aside' : 'Playlists'}</h2>
        <span className="pl-head-btns">
          <button
            type="button"
            className="pl-new"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            {selecting ? 'Cancel' : 'Select'}
          </button>
          {!selecting && (
            <button type="button" className="pl-new" onClick={() => newPlaylist([])}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New
            </button>
          )}
        </span>
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
            {(asideCount > 0 || show === 'aside') && (
              <button
                type="button"
                className="pl-chip pl-aside-chip"
                aria-pressed={show === 'aside'}
                onClick={() => setShow(show === 'aside' ? 'all' : 'aside')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16v10H4zM3 5h18v4H3zM10 13h4" /></svg>
                Set aside · {asideCount}
              </button>
            )}
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

      {show === 'aside' && (
        <p className="small muted pl-aside-note">Kept out of your taste profile. They still play as usual.</p>
      )}

      <div className="list">
        {list.map((p) => {
          const inner = (
            <>
            {selecting && <span className={`tick${picked.has(p.id) ? ' on' : ''}`} aria-hidden="true" />}
            {p.image_url ? <img src={smallCover(p.image_url)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />}
            <div className="main">
              <div className="title">{p.name}</div>
              <div className="sub pl-meta">
                <span className={`dot ${p.service}`} />
                {p.service === 'spotify' ? 'Spotify' : p.service === 'youtube' ? 'YouTube' : 'Music Hub'} · {p.count.toLocaleString()} songs
                {sort === 'recent' && p.last_added_at ? ` · ${ago(p.last_added_at)}` : ''}
              </div>
            </div>
            {!selecting && <span className="muted" aria-hidden="true">›</span>}
            </>
          );
          return selecting ? (
            <button
              type="button"
              className="item pl-row pl-pick"
              key={p.id}
              aria-pressed={picked.has(p.id)}
              onClick={() => toggle(p.id)}
            >
              {inner}
            </button>
          ) : (
            <Link className="item pl-row" key={p.id} href={`/playlists/${p.id}`}>
              {inner}
            </Link>
          );
        })}
        {list.length === 0 && <p className="muted">No playlists here yet.</p>}
      </div>

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="Selected playlists">
          <span className="select-count">
            {picked.size === 0 ? 'Tap playlists to pick them' : `${picked.size} selected`}
          </span>
          <button type="button" className="primary" disabled={!picked.size || busy} onClick={() => putAside(show !== 'aside')}>
            {show === 'aside' ? 'Bring back' : 'Set aside'}
          </button>
        </div>
      )}
      {note && (
        <div className="flash-toast" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {note}
        </div>
      )}

      {missingDates && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Some playlists don’t have an “updated” date yet. Tap Import playlists in Services once for each service to fill
          them in.
        </p>
      )}
    </section>
  );
}
