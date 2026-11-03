'use client';

import { PLAYER_ICONS, type PlayerIconName } from '@/lib/playerIcons';
import { useEffect, useRef, useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';

// "Up next" under the Now Playing controls (Queue Lab pick P3 + H3 + L3 + E3):
// songs you added sit in "Next up", the rest under "From <where it's from>".
// Each row has a ⋯ menu; hold a row for a moment, then drag it to a new spot.

const SHOW = 150; // rows drawn at once (the rest still play)
const HOLD_MS = 350; // how long to hold before a row lifts
const SLOP = 8; // moving more than this before the hold ends = scrolling, not dragging

type Props = {
  queue: TrackRowData[];
  index: number;
  more: number; // songs not fetched yet (big lists)
  from: string;
  shuffle: boolean;
  isAdded: (t: TrackRowData) => boolean;
  scroller: () => HTMLElement | null; // the Now Playing sheet (it scrolls)
  onPlay: (j: number) => void;
  onMove: (from: number, to: number, added?: boolean) => void;
  onRemove: (j: number) => void;
  onKeep: (t: TrackRowData) => void;
  onAddToPlaylist: (t: TrackRowData) => void;
};

type Drag = { j: number; startY: number; y: number; target: number | null };

const picon = (name: PlayerIconName) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="picon" dangerouslySetInnerHTML={{ __html: PLAYER_ICONS[name] }} />
);

export default function QueueList(p: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hold = useRef<{ timer: number; j: number; x: number; y: number } | null>(null);
  const pointerY = useRef(0);
  const justDragged = useRef(false); // the tap that ends a drag must not also play the song
  const propsRef = useRef(p);
  propsRef.current = p;

  const end = Math.min(p.queue.length, p.index + 1 + SHOW);
  const rows: number[] = [];
  for (let j = p.index + 1; j < end; j++) rows.push(j);
  const left = Math.max(0, p.queue.length - p.index - 1 + p.more);

  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Where would the lifted row land? "Before queue position N" (N can be one past the last row).
  const findTarget = (y: number): number | null => {
    const list = listRef.current;
    const d = dragRef.current;
    if (!list || !d) return null;
    const els = Array.from(list.querySelectorAll<HTMLElement>('[data-q]'));
    for (const el of els) {
      const j = Number(el.dataset.q);
      if (j === d.j) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return j;
    }
    const last = els[els.length - 1];
    return last ? Number(last.dataset.q) + 1 : null;
  };

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const onPointerDown = (j: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || dragRef.current) return;
    if ((e.target as HTMLElement).closest('.q-more')) return;
    cancelHold();
    const y = e.clientY;
    pointerY.current = y;
    hold.current = {
      j,
      x: e.clientX,
      y,
      timer: window.setTimeout(() => {
        hold.current = null;
        setMenu(null);
        setD({ j, startY: pointerY.current, y: pointerY.current, target: null });
      }, HOLD_MS),
    };
  };

  // While holding/dragging, follow the finger anywhere on the screen.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointerY.current = e.clientY;
      const h = hold.current;
      if (h && (Math.abs(e.clientX - h.x) > SLOP || Math.abs(e.clientY - h.y) > SLOP)) cancelHold();
      const d = dragRef.current;
      if (d) setD({ ...d, y: e.clientY, target: findTarget(e.clientY) });
    };
    const up = () => {
      cancelHold();
      const d = dragRef.current;
      if (!d) return;
      setD(null);
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 350);
      if (d.target == null) return;
      const to = d.target > d.j ? d.target - 1 : d.target;
      if (to !== d.j) propsRef.current.onMove(d.j, to);
    };
    // iOS: stop the page from scrolling while a row is lifted (needs a non-passive listener).
    const touchMove = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', touchMove);
      cancelHold();
    };
  }, []);

  // Near the top or bottom edge while dragging: scroll the sheet gently.
  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      const s = propsRef.current.scroller();
      const y = pointerY.current;
      const edge = 90;
      const h = window.innerHeight;
      const dy = y < edge ? -Math.ceil((edge - y) / 8) : y > h - edge ? Math.ceil((y - (h - edge)) / 8) : 0;
      if (s && dy) {
        s.scrollTop += dy;
        const d = dragRef.current;
        if (d) setD({ ...d, target: findTarget(y) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  const lastRow = rows[rows.length - 1];
  const out: React.ReactNode[] = [];
  let group: string | null = null;
  for (const j of rows) {
    const t = p.queue[j];
    const g = p.isAdded(t) ? 'added' : 'from';
    if (g !== group) {
      group = g;
      out.push(
        <div className="q-group" key={`g-${j}`}>
          {g === 'added' ? 'Next up · added by you' : `From ${p.from}${p.shuffle ? ' · shuffled' : ''}`}
        </div>,
      );
    }
    const lifted = drag?.j === j;
    if (drag && drag.target === j && !lifted) out.push(<div className="q-drop" key={`d-${j}`} />);
    out.push(
      <div
        key={`${t.id}-${j}`}
        data-q={j}
        className={`q-row${lifted ? ' lifted' : ''}`}
        style={lifted ? { transform: `translateY(${drag.y - drag.startY}px)` } : undefined}
        onPointerDown={onPointerDown(j)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className="q-play"
          onClick={() => !dragRef.current && !justDragged.current && p.onPlay(j)}
          aria-label={`Play ${t.title} by ${t.artist}`}
        >
          {t.image_url ? <img src={t.image_url} alt="" loading="lazy" draggable={false} /> : <span className="ph" />}
          <span className="q-text">
            <span className="title">{t.title}</span>
            <span className="sub">{t.artist}</span>
          </span>
        </button>
        <button
          type="button"
          className="q-more np-icon"
          aria-label={`More for ${t.title}`}
          aria-expanded={menu === j}
          onClick={() => setMenu(menu === j ? null : j)}
        >
          {picon('more')}
        </button>
        {menu === j && (
          <>
            <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenu(null)} />
            <div className="row-menu q-menu" role="menu">
              {j !== p.index + 1 && (
                <button type="button" role="menuitem" onClick={() => { setMenu(null); p.onMove(j, p.index + 1, true); }}>Play next</button>
              )}
              {j !== p.queue.length - 1 && (
                <button type="button" role="menuitem" onClick={() => { setMenu(null); p.onMove(j, p.queue.length - 1, false); }}>Move to end</button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenu(null); p.onKeep(t); }}>Keep in Discoveries ☆</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); p.onAddToPlaylist(t); }}>Add to playlist…</button>
              <button type="button" role="menuitem" className="danger-item" onClick={() => { setMenu(null); p.onRemove(j); }}>Remove from queue</button>
            </div>
          </>
        )}
      </div>,
    );
    if (drag && j === lastRow && drag.target === j + 1) out.push(<div className="q-drop" key="d-end" />);
  }

  return (
    <div className={`q-list${drag ? ' dragging' : ''}`} ref={listRef}>
      <div className="q-head">
        <span>Up next</span>
        <span className="q-count">{left.toLocaleString()} {left === 1 ? 'song' : 'songs'}</span>
      </div>
      {rows.length === 0 ? <p className="q-empty">Nothing after this song.</p> : out}
      {left > rows.length && <p className="q-empty">…and {(left - rows.length).toLocaleString()} more</p>}
      {rows.length > 1 && <p className="q-hint">Hold a song, then drag to move it.</p>}
    </div>
  );
}
