'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlaylistPicker } from './PlaylistPicker';
import TrackList from './TrackList';

// The songs on a playlist page.
// Press and hold a song to open edit mode (2026-11-05, replaces plain select):
// - the song gets ticked; tap others to tick them too;
// - in your own (hub) playlists, keep your finger down after the hold and drag
//   to move that song, or drag any song by its ≡ grip. Other songs slide out
//   of the way, and the page scrolls when you drag near the top or bottom.
//   The new order saves itself a moment after you let go.
// - the bar at the top: Done, Select all, Copy to… and, in hub playlists,
//   Move to… and Remove. Spotify / YouTube playlists can only be copied
//   from (the next import would undo changes there).

type Rows = { tracks: TrackRowData[]; positions: number[] };
type Drag = {
  from: number; // index being moved
  to: number; // where it would land
  touch: boolean;
  startY: number; // finger, page coordinates
  y: number; // finger now, page coordinates
  clientY: number;
  centers: number[]; // middle of every row (page coordinates) at the start
  height: number; // the moved row's height
  nodes: HTMLElement[];
  moved: boolean;
  untick: boolean; // the hold ticked this song; untick it if it gets dragged
};

const EDGE = 160; // px from the top (below the edit bar) where dragging scrolls the page up

export default function PlaylistSongs({
  playlistId,
  hub,
  tracks: initial,
  positions: initialPositions,
}: {
  playlistId: string;
  hub: boolean;
  tracks: TrackRowData[];
  positions: number[];
}) {
  const router = useRouter();
  const pick = usePlaylistPicker();
  const [rows, setRows] = useState<Rows>({ tracks: initial, positions: initialPositions });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const rafRef = useRef(0);
  // The page-wide "don't scroll" listener only exists while a song is lifted,
  // so ordinary scrolling never waits for the app.
  const touchMoveRef = useRef<((e: TouchEvent) => void) | null>(null);

  // ── Saving the order (after a short pause, one save at a time) ──
  const saveTimer = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const drops = useRef(0); // moves made so far
  const savedDrops = useRef(0); // moves already saved
  const save = async (): Promise<void> => {
    if (inFlight.current) await inFlight.current;
    if (savedDrops.current === drops.current) return;
    const upTo = drops.current;
    const order = rowsRef.current.positions.slice();
    setSaving('saving');
    const run = (async () => {
      try {
        const res = await fetch(`/api/hub-playlists/${playlistId}/items`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        // Swap old places for new ones, even if you moved more songs meanwhile.
        const map = new Map<number, number>(order.map((p, i) => [p, body.positions[i]]));
        const next = { tracks: rowsRef.current.tracks, positions: rowsRef.current.positions.map((p) => map.get(p) ?? p) };
        rowsRef.current = next;
        setRows(next);
        savedDrops.current = upTo;
        setSaving('saved');
        setTimeout(() => setSaving((s) => (s === 'saved' ? 'idle' : s)), 1500);
      } catch (e) {
        savedDrops.current = upTo; // don't retry the same failing order forever
        setSaving('idle');
        setError((e as Error).message || 'Couldn’t save the new order. Try again.');
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (savedDrops.current !== drops.current) await save(); // you moved more while it saved
  };
  const saveSoon = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = 0;
      void save();
    }, 700);
  };
  // Before anything that uses song places (move, remove), finish saving.
  const flush = async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = 0;
    }
    await save();
  };

  // ── Dragging ──
  const paint = () => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.y - d.startY;
    const center = d.centers[d.from] + dy;
    let to = 0;
    d.centers.forEach((c, i) => {
      if (i !== d.from && c < center) to++;
    });
    d.to = to;
    d.nodes.forEach((n, i) => {
      if (i === d.from) n.style.transform = `translateY(${dy}px)`;
      else if (d.from < to && i > d.from && i <= to) n.style.transform = `translateY(${-d.height}px)`;
      else if (d.from > to && i >= to && i < d.from) n.style.transform = `translateY(${d.height}px)`;
      else n.style.transform = '';
    });
  };
  // Near the top or bottom of the screen, scroll while the finger stays there.
  const autoScroll = () => {
    const d = dragRef.current;
    if (!d) return;
    const bottom = window.innerHeight - 170; // above the player bar and bottom bar
    let step = 0;
    if (d.clientY < EDGE) step = -Math.ceil((EDGE - d.clientY) / 6);
    else if (d.clientY > bottom) step = Math.ceil((d.clientY - bottom) / 6);
    if (step) {
      const before = window.scrollY;
      window.scrollBy(0, step);
      const moved = window.scrollY - before;
      if (moved) {
        d.y += moved;
        paint();
      }
    }
    rafRef.current = requestAnimationFrame(autoScroll);
  };
  const begin = (index: number, at: { y: number; touch: boolean }, untick: boolean) => {
    if (!hub || dragRef.current) return;
    const nodes: HTMLElement[] = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.list > .item') ?? []);
    if (!nodes[index]) return;
    const rects = nodes.map((n) => n.getBoundingClientRect());
    dragRef.current = {
      from: index,
      to: index,
      touch: at.touch,
      startY: at.y + window.scrollY,
      y: at.y + window.scrollY,
      clientY: at.y,
      centers: rects.map((r) => r.top + window.scrollY + r.height / 2),
      height: rects[index].height,
      nodes,
      moved: false,
      untick,
    };
    if (touchMoveRef.current) window.addEventListener('touchmove', touchMoveRef.current, { passive: false });
    listRef.current?.querySelector('.list')?.classList.add('dragging');
    nodes[index].classList.add('lifted');
    rafRef.current = requestAnimationFrame(autoScroll);
  };
  const moveTo = (clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    d.clientY = clientY;
    d.y = clientY + window.scrollY;
    if (!d.moved && Math.abs(d.y - d.startY) > 4) {
      d.moved = true;
      if (d.untick) setSelected((s) => (s && s.size === 1 && s.has(d.from) ? new Set() : s));
    }
    paint();
  };
  const end = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    cancelAnimationFrame(rafRef.current);
    if (touchMoveRef.current) window.removeEventListener('touchmove', touchMoveRef.current);
    // Put everything back and apply the new order in the same moment (no jump).
    listRef.current?.querySelector('.list')?.classList.remove('dragging');
    d.nodes.forEach((n) => {
      n.style.transform = '';
      n.classList.remove('lifted');
    });
    const { from, to } = d;
    if (!d.moved || from === to) return;
    setRows((r) => {
      const tracks = r.tracks.slice();
      const positions = r.positions.slice();
      const [t] = tracks.splice(from, 1);
      const [p] = positions.splice(from, 1);
      tracks.splice(to, 0, t);
      positions.splice(to, 0, p);
      const next = { tracks, positions };
      rowsRef.current = next;
      return next;
    });
    // Ticks follow their songs.
    setSelected((s) => {
      if (!s) return s;
      const order = Array.from({ length: rowsRef.current.tracks.length }, (_, i) => i);
      const [x] = order.splice(from, 1);
      order.splice(to, 0, x);
      return new Set(order.map((old, i) => (s.has(old) ? i : -1)).filter((i) => i >= 0));
    });
    drops.current += 1;
    saveSoon();
  };

  // Finger and mouse tracking for the whole page while a song is lifted.
  // touchmove (added only during a drag) is not passive, so the page doesn't scroll under the finger.
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.touch) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) moveTo(t.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d && !d.touch) moveTo(e.clientY);
    };
    const onTouchEnd = () => {
      if (dragRef.current?.touch) end();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (dragRef.current && (!dragRef.current.touch || e.pointerType !== 'mouse')) end();
    };
    touchMoveRef.current = onTouchMove;
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page with an unsaved order: send it anyway.
  useEffect(() => {
    const out = () => {
      if (savedDrops.current === drops.current) return;
      try {
        fetch(`/api/hub-playlists/${playlistId}/items`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: rowsRef.current.positions }),
          keepalive: true,
        });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', out);
    return () => {
      window.removeEventListener('pagehide', out);
      if (saveTimer.current && savedDrops.current !== drops.current) {
        window.clearTimeout(saveTimer.current);
        out();
      }
    };
  }, [playlistId]);

  // Tell the tag pills above (PlaylistTags) when edit mode opens or closes,
  // so their × buttons only show while editing.
  const editing = !!selected;
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('mh-playlist-edit', { detail: { id: playlistId, on: editing } }));
    } catch {
      /* ignore */
    }
  }, [editing, playlistId]);
  useEffect(
    () => () => {
      try {
        window.dispatchEvent(new CustomEvent('mh-playlist-edit', { detail: { id: playlistId, on: false } }));
      } catch {
        /* ignore */
      }
    },
    [playlistId],
  );

  // ── Removing / moving / copying ──
  const removePositions = async (positions: number[]) => {
    const res = await fetch(`/api/hub-playlists/${playlistId}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
  };
  // Take songs off the page at once; put them back if the server says no.
  const dropRows = async (indexes: number[]) => {
    await flush();
    const gone = new Set(indexes);
    const before = rowsRef.current;
    setRows((r) => {
      const next = { tracks: r.tracks.filter((_, j) => !gone.has(j)), positions: r.positions.filter((_, j) => !gone.has(j)) };
      rowsRef.current = next;
      return next;
    });
    try {
      await removePositions(indexes.map((i) => before.positions[i]));
      router.refresh();
    } catch (e) {
      setRows(before);
      rowsRef.current = before;
      throw e;
    }
  };

  const chosen = () => [...(selected ?? [])].sort((a, b) => a - b);
  const done = async () => {
    setSelected(null);
    await flush();
  };
  const toggle = (i: number) =>
    setSelected((old) => {
      const next = new Set(old ?? []);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const copy = () => {
    const idx = chosen();
    if (!idx.length) return;
    pick(idx.map((i) => rows.tracks[i]), { verb: 'Copy', exclude: playlistId });
  };
  const move = () => {
    const idx = chosen();
    if (!idx.length) return;
    pick(idx.map((i) => rows.tracks[i]), {
      verb: 'Move',
      exclude: playlistId,
      onAdded: async () => {
        await dropRows(idx);
        setSelected(new Set());
      },
    });
  };
  const removeSelected = async () => {
    const idx = chosen();
    if (!idx.length) return;
    setError(null);
    try {
      await dropRows(idx);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message || 'Couldn’t remove them. Try again.');
    }
  };
  const removeOne = async (i: number) => {
    setError(null);
    try {
      await dropRows([i]);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t remove it. Try again.');
    }
  };

  // Hold: open edit mode with that song ticked, and (in hub playlists) pick it up.
  const onHold = (i: number, at: { y: number; touch: boolean }) => {
    const wasEditing = !!selected;
    const already = !!selected?.has(i);
    if (!wasEditing) setSelected(new Set([i]));
    else if (!already) setSelected((s) => new Set([...(s ?? []), i]));
    begin(i, at, !already);
  };

  const n = selected?.size ?? 0;
  const all = n === rows.tracks.length && n > 0;

  return (
    <>
      {selected && (
        <div className="sel-top" role="toolbar" aria-label="Editing this playlist">
          <div className="sel-line">
            <span className="sel-count">
              {n === 0 ? 'Editing' : `${n.toLocaleString()} selected`}
              {saving !== 'idle' && <span className="small muted sel-saved"> · {saving === 'saving' ? 'Saving order…' : 'Order saved'}</span>}
            </span>
            <button
              type="button"
              className="sel-all"
              onClick={() => setSelected(all ? new Set() : new Set(rows.tracks.map((_, i) => i)))}
            >
              {all ? 'Select none' : 'Select all'}
            </button>
            <button type="button" className="sel-all primary" onClick={() => void done()}>
              Done
            </button>
          </div>
          <div className="sel-acts">
            <button type="button" disabled={!n} onClick={copy}>Copy to…</button>
            {hub && (
              <button type="button" disabled={!n} onClick={move}>Move to…</button>
            )}
            {hub && (
              <button type="button" className="danger" disabled={!n} onClick={removeSelected}>Remove</button>
            )}
          </div>
          {hub && <p className="small muted sel-tip">Drag ≡ to reorder. Tap songs to select them.</p>}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div ref={listRef} className="edit-list">
        <TrackList
          tracks={rows.tracks}
          onRemove={hub ? removeOne : undefined}
          selected={selected}
          onHold={onHold}
          onToggle={toggle}
          grips={hub}
          onGrip={(i, at) => begin(i, at, false)}
        />
      </div>
      {rows.tracks.length > 0 && !selected && (
        <p className="small muted sel-hint">
          {hub ? 'Press and hold a song to edit: drag it to a new place, or select several.' : 'Press and hold a song to select several.'}
        </p>
      )}
      {rows.tracks.length === 0 && hub && (
        <p className="muted">
          No songs yet. Tap ⋯ on any song in your Library or another playlist and choose Add to playlist.
        </p>
      )}
    </>
  );
}
