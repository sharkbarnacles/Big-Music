'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';

// The ⋯ button beside a playlist's title: copy all its songs into one of
// your hub playlists and, for hub playlists, rename or delete.
export default function PlaylistMenu({
  id,
  name,
  hub,
  pinned,
  tracks,
}: {
  id: string;
  name: string;
  hub: boolean;
  pinned?: boolean; // left out = not one of your playlists (no Pin)
  tracks: { id: string; title: string }[];
}) {
  const router = useRouter();
  const pick = usePlaylistPicker();
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<null | 'rename' | 'delete'>(null);
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (method: 'PATCH' | 'DELETE', body?: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hub-playlists/${id}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      return true;
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await call('PATCH', { name: newName })) {
      setPanel(null);
      router.refresh();
    }
  };
  const remove = async () => {
    if (await call('DELETE')) router.push('/');
  };
  // Pin to Home / Unpin (Home Lab P2).
  const togglePin = async () => {
    setMenu(false);
    try {
      const res = await fetch('/api/playlists/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], pinned: !pinned }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || 'Couldn’t do that. Try again.');
    }
  };
  const open = (p: 'rename' | 'delete') => {
    setMenu(false);
    setError(null);
    setNewName(name);
    setPanel(p);
  };

  return (
    <span className="filter-menu">
      <button type="button" className="round-btn" aria-label="Playlist options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
      </button>
      {menu && (
        <>
          <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div className="row-menu filter-drop" role="menu">
            {pinned !== undefined && (
              <button type="button" role="menuitem" onClick={togglePin}>
                {pinned ? 'Unpin from Home' : 'Pin to Home'}
              </button>
            )}
            {tracks.length > 0 && (
              <button type="button" role="menuitem" onClick={() => { setMenu(false); pick(tracks); }}>
                Add all to a playlist…
              </button>
            )}
            {hub && (
              <>
                <button type="button" role="menuitem" onClick={() => open('rename')}>Rename</button>
                <button type="button" role="menuitem" className="danger-item" onClick={() => open('delete')}>Delete playlist</button>
              </>
            )}
          </div>
        </>
      )}
      {error && !panel && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
      {panel && (
        <>
          <button type="button" className="panel-back" aria-label="Close panel" onClick={() => setPanel(null)} />
          <div className="panel-sheet" role="dialog" aria-label={panel === 'rename' ? 'Rename playlist' : 'Delete playlist'}>
            <div className="panel-grab" aria-hidden="true" />
            {panel === 'rename' ? (
              <form className="picker-new" onSubmit={rename} style={{ display: 'grid', gap: 12 }}>
                <h3>Rename playlist</h3>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} autoFocus aria-label="Playlist name" />
                {error && <div className="notice error">{error}</div>}
                <button type="submit" className="panel-wide primary" disabled={busy || !newName.trim()}>Save</button>
              </form>
            ) : (
              <>
                <h3>Delete “{name}”?</h3>
                <p className="small muted" style={{ margin: 0 }}>
                  The playlist goes away. Its songs stay in your library.
                </p>
                {error && <div className="notice error">{error}</div>}
                <button type="button" className="panel-wide danger" disabled={busy} onClick={remove}>Delete playlist</button>
              </>
            )}
            <button type="button" className="panel-wide" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </>
      )}
    </span>
  );
}
