'use client';

// Pieces of the Discover tab that react to taps (playing, hearts, the archive calendar).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import { usePlayer } from './Player';

export type ItemLite = { id: string; reason: string | null; hearted: boolean };

const HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';

// Heart = keep: the song goes into your "Discoveries" playlist (and your Library).
export function HeartButton({ itemId, initial, small = false }: { itemId: string; initial: boolean; small?: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    const next = !on;
    setOn(next); // show it straight away; undo if the server says no
    setBusy(true);
    try {
      const res = await fetch('/api/discover/heart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, on: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setMsg(next ? 'Kept in Discoveries' : 'Removed from Discoveries');
    } catch (err) {
      setOn(!next);
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 1600);
    }
  }
  return (
    <>
      <button
        type="button"
        className={`d-heart${small ? ' small' : ''}`}
        aria-pressed={on}
        aria-label={on ? 'Remove from Discoveries' : 'Keep in Discoveries'}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={HEART} />
        </svg>
      </button>
      {msg && (
        <span className="d-toast" role="status">
          {msg}
        </span>
      )}
    </>
  );
}

// Today: two rows of small covers that scroll sideways together. Tap one to play from there.
export function TodayGrid({ tracks, items }: { tracks: TrackRowData[]; items: ItemLite[] }) {
  const player = usePlayer();
  return (
    <div className="d-grid2">
      {tracks.map((t, i) => (
        <div key={items[i].id} className={`d-tile${player.current?.id === t.id ? ' active' : ''}`}>
          <button
            type="button"
            className="d-tile-play"
            onClick={() => player.playList(tracks, i, { noShuffle: true })}
            aria-label={`Play ${t.title} by ${t.artist}`}
          >
            <span className="d-cover">{t.image_url ? <img src={t.image_url} alt="" loading="lazy" /> : null}</span>
            <span className="d-nm">{t.title}</span>
            <span className="d-ar">{t.artist}</span>
            {items[i].reason && <span className="d-why">{items[i].reason}</span>}
          </button>
          <HeartButton itemId={items[i].id} initial={items[i].hearted} small />
        </div>
      ))}
    </div>
  );
}

// A list of songs with reasons and hearts (one edition's page).
export function DiscoverList({ tracks, items }: { tracks: TrackRowData[]; items: ItemLite[] }) {
  const player = usePlayer();
  return (
    <div className="list">
      {tracks.map((t, i) => (
        <div key={items[i].id} className={`item${player.current?.id === t.id ? ' active' : ''}`}>
          <button type="button" className="row-play" onClick={() => player.playList(tracks, i, { noShuffle: true })} aria-label={`Play ${t.title} by ${t.artist}`}>
            {t.image_url ? <img src={t.image_url} alt="" loading="lazy" /> : <div className="ph" />}
            <div className="main">
              <div className="title">{t.title}</div>
              <div className="sub">{t.artist}</div>
              {items[i].reason && <div className="d-why">{items[i].reason}</div>}
            </div>
          </button>
          <div className="end">
            <HeartButton itemId={items[i].id} initial={items[i].hearted} />
          </div>
        </div>
      ))}
    </div>
  );
}

type ArchiveEdition = { id: string; kind: string; edition_date: string; title: string; subtitle: string | null; count: number };
const WEEKLY = new Set(['weekly', 'releases', 'month', 'forgotten']);

// Past editions: a month calendar. Teal dot = a daily pick, pale dot = a weekly/monthly mix.
export function ArchiveCalendar({ today }: { today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editions, setEditions] = useState<ArchiveEdition[] | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEditions(null);
    fetch(`/api/discover/archive?month=${month}`)
      .then((r) => r.json())
      .then((d) => alive && setEditions(d.editions ?? []))
      .catch(() => alive && setEditions([]));
    return () => {
      alive = false;
    };
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const byDay = new Map<string, ArchiveEdition[]>();
  for (const e of editions ?? []) byDay.set(e.edition_date, [...(byDay.get(e.edition_date) ?? []), e]);
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
    setDay(null);
  };
  const picked = day ? byDay.get(day) ?? [] : [];

  return (
    <div className="d-archive">
      <div className="d-calhead">
        <button type="button" className="d-arrow" onClick={() => shift(-1)} aria-label="Previous month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span>{label}</span>
        <button type="button" className="d-arrow" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)} aria-label="Next month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div className="d-cal">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="d-dow">{d}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`;
          const list = byDay.get(iso) ?? [];
          const daily = list.some((e) => e.kind === 'daily');
          const mix = list.some((e) => WEEKLY.has(e.kind));
          return (
            <button
              key={iso}
              type="button"
              className={`${list.length ? 'has' : ''}${daily ? ' daily' : ''}${mix ? ' mix' : ''}${iso === today ? ' today' : ''}`}
              disabled={!list.length}
              aria-pressed={day === iso}
              aria-label={`${iso}${list.length ? `: ${list.map((e) => e.title).join(', ')}` : ''}`}
              onClick={() => setDay(day === iso ? null : iso)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="d-legend">
        <span><i className="daily" />daily pick</span>
        <span><i className="mix" />weekly or monthly mix</span>
      </div>
      {day ? (
        <div className="d-picked">
          {picked.map((e) => (
            <Link key={e.id} href={`/discover/${e.id}`} className="d-picked-row">
              <span>{e.title}</span>
              <span className="muted">{e.count} songs ›</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted small d-hint">{editions === null ? 'Loading…' : editions.length ? 'Tap a day to open what you got, exactly as it was.' : 'Nothing this month yet.'}</p>
      )}
    </div>
  );
}
