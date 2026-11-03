'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useState } from 'react';
import type { HubPlaylist } from '@/lib/hubPlaylists';
import { smallCover } from '@/lib/img';

// The "Add to playlist" window (Playlist Tools Lab pick P3): a sheet with a
// search box that filters your playlists by name as you type, your 3 most
// recently used playlists first, then the rest A–Z. If nothing matches what
// you typed, the top row offers "New playlist '…'" (one tap makes it and adds
// the songs). Any part of the app opens it with usePlaylistPicker()(songs).
// With no songs it just makes a new, empty playlist and opens it.
// Options: verb 'Copy' / 'Move' (from a playlist's Select mode), a playlist to
// leave out of the list, and `onAdded`, run after the songs were added (Move
// uses it to take them out of the playlist they came from).

type PickTrack = { id: string; title: string };
export type PickOptions = {
  verb?: 'Add' | 'Copy' | 'Move';
  exclude?: string;
  onAdded?: (target: { id: string; name: string }) => Promise<void>;
};
type Open = (tracks: PickTrack[], options?: PickOptions) => void;
const PickerContext = createContext<Open>(() => {});
export const usePlaylistPicker = () => useContext(PickerContext);

// Lower case, accents dropped: "Café" matches "cafe".
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function PlaylistPickerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [tracks, setTracks] = useState<PickTrack[] | null>(null);
  const [opts, setOpts] = useState<PickOptions>({});
  const [lists, setLists] = useState<HubPlaylist[] | null>(null);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const open: Open = (t, options = {}) => {
    setTracks(t);
    setOpts(options);
    setQuery('');
    setName('');
    setNaming(false);
    setError(null);
    setLists(null);
    if (t.length)
      fetch('/api/hub-playlists')
        .then((r) => r.json())
        .then((b) => setLists(b.playlists ?? []))
        .catch(() => setLists([]));
  };
  const close = () => setTracks(null);
  const finish = (message: string) => {
    close();
    setToast(message);
    setTimeout(() => setToast(null), 2500);
    // Only pages that show playlists need fresh data (Home, a playlist page);
    // refreshing the big Library or Discover pages for nothing is slow.
    const path = window.location.pathname;
    if (path === '/' || path.startsWith('/playlists')) router.refresh();
  };
  const what = (n: number) => (n === 1 ? tracks?.[0]?.title ?? '1 song' : `${n.toLocaleString()} songs`);
  const verb = opts.verb ?? 'Add';
  const done = (n: number, to: string) => {
    const w = what(n);
    if (verb === 'Move') return `Moved ${what(tracks?.length ?? n)} to ${to}`;
    if (n === 0) return `Already in ${to}`;
    return `${verb === 'Copy' ? 'Copied' : 'Added'} ${w} to ${to}`;
  };

  // Recently used = the 3 you added to last (the list comes newest first).
  const { recent, rest, matches, exact } = useMemo(() => {
    const all = (lists ?? []).filter((p) => p.id !== opts.exclude);
    const q = fold(query);
    const byName = (a: HubPlaylist, b: HubPlaylist) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return {
      recent: all.slice(0, 3),
      rest: all.slice(3).sort(byName),
      matches: q ? all.filter((p) => fold(p.name).includes(q)).sort(byName) : [],
      exact: q ? all.some((p) => fold(p.name) === q) : false,
    };
  }, [lists, query, opts.exclude]);

  const addTo = async (p: { id: string; name: string }) => {
    if (!tracks || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hub-playlists/${p.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: tracks.map((t) => t.id) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (opts.onAdded) await opts.onAdded(p);
      finish(done(body.added, p.name));
    } catch (e) {
      setError((e as Error).message || 'Couldn’t add. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const create = async (raw: string) => {
    const clean = raw.trim();
    if (!tracks || busy || !clean) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/hub-playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean, trackIds: tracks.map((t) => t.id) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (tracks.length === 0) {
        close();
        router.push(`/playlists/${body.id}`);
        return;
      }
      if (opts.onAdded) await opts.onAdded({ id: body.id, name: clean });
      finish(verb === 'Move' ? done(body.added, clean) : `Made ${clean} with ${what(body.added)}`);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t make it. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const row = (p: HubPlaylist) => (
    <button type="button" className="item pl-row picker-row" key={p.id} onClick={() => addTo(p)} disabled={busy}>
      {p.image_url ? <img src={smallCover(p.image_url)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />}
      <span className="main">
        <span className="title">{p.name}</span>
        <span className="sub">{p.count.toLocaleString()} songs</span>
      </span>
    </button>
  );
  const newRow = (label: string, onClick: () => void) => (
    <button type="button" className="item pl-row picker-row picker-make" onClick={onClick} disabled={busy}>
      <span className="ph picker-plus" aria-hidden="true">+</span>
      <span className="main">
        <span className="title">{label}</span>
      </span>
    </button>
  );

  const nameForm = (autoFocus: boolean) => (
    <form
      className="picker-new"
      onSubmit={(e) => {
        e.preventDefault();
        create(name);
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New playlist name"
        aria-label="New playlist name"
        maxLength={100}
        autoFocus={autoFocus}
      />
      <button type="submit" className="primary" disabled={busy || !name.trim()}>
        Create
      </button>
    </form>
  );

  const q = query.trim();
  const title = !tracks?.length ? 'New playlist' : verb === 'Move' ? 'Move to playlist' : verb === 'Copy' ? 'Copy to playlist' : 'Add to playlist';

  return (
    <PickerContext.Provider value={open}>
      {children}
      {tracks && (
        <>
          <button type="button" className="panel-back" aria-label="Close panel" onClick={close} />
          <div className={`panel-sheet${tracks.length ? ' picker-sheet' : ''}`} role="dialog" aria-label={title}>
            <div className="panel-grab" aria-hidden="true" />
            <div className="picker-top">
              <div className="picker-head">
                <h3>{title}</h3>
                {tracks.length > 0 && <p className="small muted picker-what">{what(tracks.length)}</p>}
              </div>
              {tracks.length > 0 && (
                <button type="button" className="picker-close" onClick={close}>
                  Cancel
                </button>
              )}
            </div>
            {tracks.length === 0 ? (
              <>
                {nameForm(true)}
                {error && <div className="notice error">{error}</div>}
                <button type="button" className="panel-wide" onClick={close}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <label className="picker-search">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setNaming(false);
                    }}
                    placeholder="Search your playlists"
                    aria-label="Search your playlists"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </label>
                {error && <div className="notice error">{error}</div>}
                <div className="list picker-list">
                  {lists === null && <p className="small muted">Loading your playlists…</p>}
                  {lists !== null && !q && (
                    <>
                      {naming ? nameForm(true) : newRow('New playlist', () => setNaming(true))}
                      {recent.length > 0 && <div className="picker-sec">Recently used</div>}
                      {recent.map(row)}
                      {rest.length > 0 && <div className="picker-sec">All playlists</div>}
                      {rest.map(row)}
                    </>
                  )}
                  {lists !== null && q && (
                    <>
                      {matches.length === 0 && newRow(`New playlist “${q}”`, () => create(q))}
                      {matches.map(row)}
                      {matches.length > 0 && !exact && newRow(`New playlist “${q}”`, () => create(q))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {toast && (
        <div className="flash-toast" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {toast}
        </div>
      )}
    </PickerContext.Provider>
  );
}
