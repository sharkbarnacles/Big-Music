'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useState } from 'react';
import type { HubPlaylist } from '@/lib/hubPlaylists';

// The "Add to playlist" panel. Any part of the app can open it with
// usePlaylistPicker()(songs). With no songs it just makes a new, empty
// playlist and opens it.

type PickTrack = { id: string; title: string };
const PickerContext = createContext<(tracks: PickTrack[]) => void>(() => {});
export const usePlaylistPicker = () => useContext(PickerContext);

export function PlaylistPickerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [tracks, setTracks] = useState<PickTrack[] | null>(null);
  const [lists, setLists] = useState<HubPlaylist[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const open = (t: PickTrack[]) => {
    setTracks(t);
    setName('');
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

  const addTo = async (p: HubPlaylist) => {
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
      finish(body.added === 0 ? `Already in ${p.name}` : `Added ${what(body.added)} to ${p.name}`);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t add. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tracks || busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/hub-playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, trackIds: tracks.map((t) => t.id) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (tracks.length === 0) {
        close();
        router.push(`/playlists/${body.id}`);
      } else finish(`Made ${name.trim()} with ${what(body.added)}`);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t make it. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PickerContext.Provider value={open}>
      {children}
      {tracks && (
        <>
          <button type="button" className="panel-back" aria-label="Close panel" onClick={close} />
          <div className="panel-sheet" role="dialog" aria-label={tracks.length ? 'Add to playlist' : 'New playlist'}>
            <div className="panel-grab" aria-hidden="true" />
            <div>
              <h3>{tracks.length ? 'Add to playlist' : 'New playlist'}</h3>
              {tracks.length > 0 && <p className="small muted picker-what">{what(tracks.length)}</p>}
            </div>
            <form className="picker-new" onSubmit={create}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New playlist name"
                aria-label="New playlist name"
                maxLength={100}
                autoFocus={tracks.length === 0}
              />
              <button type="submit" className="primary" disabled={busy || !name.trim()}>
                Create
              </button>
            </form>
            {error && <div className="notice error">{error}</div>}
            {tracks.length > 0 && (
              <div className="list picker-list">
                {lists === null && <p className="small muted">Loading your playlists…</p>}
                {lists?.length === 0 && <p className="small muted">No hub playlists yet. Make one above.</p>}
                {lists?.map((p) => (
                  <button type="button" className="item pl-row picker-row" key={p.id} onClick={() => addTo(p)} disabled={busy}>
                    {p.image_url ? <img src={p.image_url} alt="" /> : <div className="ph" />}
                    <span className="main">
                      <span className="title">{p.name}</span>
                      <span className="sub">{p.count.toLocaleString()} songs</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="panel-wide" onClick={close}>
              Cancel
            </button>
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
