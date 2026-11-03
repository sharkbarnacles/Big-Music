'use client';

import { PLAYER_ICONS, type PlayerIconName } from '@/lib/playerIcons';
import { splitTitle } from '@/lib/titles';
import { useEffect, useRef, useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';

// "Up next" under the Now Playing controls (Queue Lab pick P3 + H3 + L3 + E3,
// cleaned up 2026-11-03): the song playing now is pinned on top, then one flat
// list with thin dividers. Songs you added sit under "Next up", the rest under
// "From <where it's from>". Drag a song by its ≡ grip (press it for a moment first); the other songs slide
// out of the way, and everything snaps into place when you let go. Tap a song
// to play it; ⋯ has the other options.

const SHOW = 150; // rows drawn at once (the rest still play)
const HOLD_MS = 160; // a still press on the grip this long lifts the song
const SLOP = 8; // moving more than this first = scrolling, not dragging

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

// A drag in progress. Positions are measured once when it starts, in the
// sheet's scroll coordinates, so nothing is re-measured while rows move.
type Drag = {
  k: number; // which visible row (index into `rows`)
  startY: number; // finger position when it started
  startScroll: number;
  dy: number; // how far the lifted row has moved
  slot: number; // where it would land (index into `rows`)
  tops: number[]; // each visible row's top
  heights: number[];
};

const picon = (name: PlayerIconName) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="picon" dangerouslySetInnerHTML={{ __html: PLAYER_ICONS[name] }} />
);

// A stable key per queue entry, so React keeps each row's element while the order changes.
const keys = new WeakMap<TrackRowData, number>();
let nextKey = 1;
const keyOf = (t: TrackRowData) => {
  let k = keys.get(t);
  if (!k) keys.set(t, (k = nextKey++));
  return k;
};

export default function QueueList(p: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [allEarlier, setAllEarlier] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerY = useRef(0);
  const propsRef = useRef(p);
  propsRef.current = p;

  const end = Math.min(p.queue.length, p.index + 1 + SHOW);
  const rows: number[] = [];
  for (let j = p.index + 1; j < end; j++) rows.push(j);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const left = Math.max(0, p.queue.length - p.index - 1 + p.more);
  const now = p.queue[p.index];

  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Where the lifted row's middle is, compared with the other rows' middles.
  const slotFor = (d: Drag, dy: number) => {
    const mid = d.tops[d.k] + dy + d.heights[d.k] / 2;
    let slot = 0;
    for (let i = 0; i < d.tops.length; i++) {
      if (i === d.k) continue;
      if (mid > d.tops[i] + d.heights[i] / 2) slot++;
    }
    return slot;
  };

  const update = (y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const s = propsRef.current.scroller();
    const dy = y - d.startY + ((s?.scrollTop ?? 0) - d.startScroll);
    setD({ ...d, dy, slot: slotFor(d, dy) });
  };

  // The grip needs a short, still press before a song lifts. A quick swipe
  // that starts on a grip (easy to do with a right thumb) scrolls the page
  // like anywhere else, instead of grabbing a song.
  const hold = useRef<{ timer: number; k: number; x: number; y: number } | null>(null);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const lift = (k: number) => {
    const list = listRef.current;
    if (!list) return;
    setMenu(null);
    const els = Array.from(list.querySelectorAll<HTMLElement>('[data-k]'));
    const s = propsRef.current.scroller();
    const off = s?.scrollTop ?? 0;
    const tops = els.map((el) => el.getBoundingClientRect().top + off);
    const heights = els.map((el) => el.getBoundingClientRect().height);
    setD({ k, startY: pointerY.current, startScroll: off, dy: 0, slot: k, tops, heights });
    navigator.vibrate?.(8);
  };
  const startDrag = (k: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    cancelHold();
    pointerY.current = e.clientY;
    // A mouse lifts straight away; a finger after a short still press.
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      return lift(k);
    }
    hold.current = {
      k,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        lift(k);
      }, HOLD_MS),
    };
  };

  // While dragging, follow the finger anywhere on the screen.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const h = hold.current;
      if (h && (Math.abs(e.clientX - h.x) > SLOP || Math.abs(e.clientY - h.y) > SLOP)) cancelHold();
      pointerY.current = e.clientY;
      if (!dragRef.current) return;
      update(e.clientY);
    };
    const up = () => {
      cancelHold();
      const d = dragRef.current;
      if (!d) return;
      setD(null); // rows drop their offsets in the same render as the new order
      const r = rowsRef.current;
      if (d.slot !== d.k && r[d.k] != null && r[d.slot] != null) propsRef.current.onMove(r[d.k], r[d.slot]);
    };
    // iOS: stop the page from scrolling while a song is being dragged.
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
      const step = y < edge ? -Math.ceil((edge - y) / 8) : y > h - edge ? Math.ceil((y - (h - edge)) / 8) : 0;
      if (s && step) {
        s.scrollTop += step;
        update(y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  // How far each row moves during a drag: the lifted one follows the finger,
  // rows between its old and new place slide up or down by its height.
  const offset = (k: number): number => {
    if (!drag) return 0;
    if (k === drag.k) return drag.dy;
    const h = drag.heights[drag.k];
    if (drag.slot > drag.k && k > drag.k && k <= drag.slot) return -h;
    if (drag.slot < drag.k && k < drag.k && k >= drag.slot) return h;
    return 0;
  };

  const out: React.ReactNode[] = [];
  let group: string | null = null;
  rows.forEach((j, k) => {
    const t = p.queue[j];
    const g = p.isAdded(t) ? 'added' : 'from';
    if (g !== group) {
      group = g;
      out.push(
        <div className="q-group" key={`g-${g}-${j}`}>
          {g === 'added' ? 'Next up · added by you' : `From ${p.from}${p.shuffle ? ' · shuffled' : ''}`}
        </div>,
      );
    }
    const lifted = drag?.k === k;
    const dy = offset(k);
    out.push(
      <div
        key={keyOf(t)}
        data-k={k}
        className={`q-row${lifted ? ' lifted' : ''}`}
        style={dy ? { transform: `translate3d(0, ${dy}px, 0)` } : undefined}
      >
        <button type="button" className="q-play" onClick={() => !dragRef.current && p.onPlay(j)} aria-label={`Play ${t.title} by ${t.artist}`}>
          {t.image_url ? <img src={t.image_url} alt="" loading="lazy" draggable={false} /> : <span className="ph" />}
          <span className="q-text">
            <span className="title">{splitTitle(t.title).title}</span>
            <span className="sub">{t.artist}</span>
          </span>
        </button>
        <button
          type="button"
          className="q-more"
          aria-label={`More for ${t.title}`}
          aria-expanded={menu === j}
          onClick={() => setMenu(menu === j ? null : j)}
        >
          {picon('more')}
        </button>
        <span
          className="q-grip"
          role="button"
          tabIndex={-1}
          aria-label={`Drag ${t.title} to move it`}
          onPointerDown={startDrag(k)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" /></svg>
        </span>
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
  });

  // Songs before the one playing (played, or skipped by tapping a song further
  // down). They stay in the queue: tap one to go back to it.
  const earlierAll = p.index;
  const earlierShown = allEarlier ? Math.min(earlierAll, SHOW) : Math.min(earlierAll, 3);
  const earlier: number[] = [];
  for (let j = p.index - earlierShown; j < p.index; j++) earlier.push(j);

  return (
    <div className="q-list">
      {earlierAll > 0 && (
        <div className="q-earlier">
          <div className="q-group q-earlier-head">
            <span>Earlier</span>
            {earlierAll > 3 && (
              <button type="button" className="q-showall" onClick={() => setAllEarlier(!allEarlier)}>
                {allEarlier ? 'Show fewer' : `Show all ${earlierAll.toLocaleString()}`}
              </button>
            )}
          </div>
          {earlier.map((j) => {
            const t = p.queue[j];
            return (
              <div key={`e-${keyOf(t)}`} className="q-row past">
                <button type="button" className="q-play" onClick={() => p.onPlay(j)} aria-label={`Go back to ${t.title} by ${t.artist}`}>
                  {t.image_url ? <img src={t.image_url} alt="" loading="lazy" draggable={false} /> : <span className="ph" />}
                  <span className="q-text">
                    <span className="title">{splitTitle(t.title).title}</span>
                    <span className="sub">{t.artist}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {now && (
        <div className="q-now">
          <div className="q-group">Now playing</div>
          <div className="q-row current">
            <span className="q-play">
              {now.image_url ? <img src={now.image_url} alt="" draggable={false} /> : <span className="ph" />}
              <span className="q-text">
                <span className="title">
                  <span className="eq" aria-hidden="true"><i /><i /><i /></span>
                  {splitTitle(now.title).title}
                </span>
                <span className="sub">{now.artist}</span>
              </span>
            </span>
          </div>
        </div>
      )}
      <div className="q-head">
        <span>Up next</span>
        <span className="q-count">{left.toLocaleString()} {left === 1 ? 'song' : 'songs'}</span>
      </div>
      <div className={`q-rows${drag ? ' dragging' : ''}`} ref={listRef}>
        {rows.length === 0 ? <p className="q-empty">Nothing after this song.</p> : out}
      </div>
      {left > rows.length && <p className="q-empty">…and {(left - rows.length).toLocaleString()} more</p>}
    </div>
  );
}
