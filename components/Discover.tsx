'use client';

// Pieces of the Discover tab that react to taps (playing, hearts, the archive calendar).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLAYER_ICONS } from '@/lib/playerIcons';
import { SPIRAL } from '@/lib/icons';
import { artistLine, splitTitle } from '@/lib/titles';
import type { TrackRowData } from '@/lib/tracks';
import { readRadioMode, RADIO_MODE_KEY, usePlayer, type RadioMode } from './Player';
import { smallCover } from '@/lib/img';

export type ItemLite = { id: string; reason: string | null; hearted: boolean };

// Reasons are stored in full ("Because you like HYUKOH"); on screen only the
// part that matters is shown, so it fits: "HYUKOH".
export function shortReason(reason: string | null): string | null {
  if (!reason) return null;
  // "From “Liked Songs”" (Forgotten favorites) → "“Liked Songs”", so the chip reads "via “Liked Songs”".
  return reason.replace(/^Because you (like|played) /i, '').replace(/^From /i, '').replace(/ a lot$/i, '');
}

// The keep button (soft star, same as Now Playing): the song goes into your "Discoveries" playlist (and your Library).
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
        <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: on ? PLAYER_ICONS.kept : PLAYER_ICONS.keep }} />
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
            onClick={() => player.playList(tracks, i, { noShuffle: true, from: 'Daily discover' })}
            aria-label={`Play ${t.title} by ${t.artist}`}
          >
            <span className="d-cover">{t.image_url ? <img src={smallCover(t.image_url, 'tile')} alt="" loading="lazy" decoding="async" /> : null}</span>
            <span className="d-nm">{splitTitle(t.title).title}</span>
            <span className="d-ar">{t.artist}</span>
            {items[i].reason && (
              <span className="d-why" title={items[i].reason ?? undefined}>
                {shortReason(items[i].reason)}
              </span>
            )}
          </button>
          <HeartButton itemId={items[i].id} initial={items[i].hearted} small />
        </div>
      ))}
    </div>
  );
}

// One edition's songs (mix page, Discovery Page Lab R2): cover, title,
// artist (with any "feat."), and the library artist that led here as a teal chip.
export function DiscoverList({ tracks, items, from }: { tracks: TrackRowData[]; items: ItemLite[]; from?: string }) {
  const player = usePlayer();
  return (
    <div className="list mix-list">
      {tracks.map((t, i) => {
        const { title, feat } = splitTitle(t.title);
        const via = shortReason(items[i].reason);
        const active = player.current?.id === t.id;
        return (
          <div key={items[i].id} className={`item mix-row${active ? ' active' : ''}`}>
            <button
              type="button"
              className="row-play"
              onClick={() => player.playList(tracks, i, { noShuffle: true, from })}
              aria-label={`Play ${t.title} by ${t.artist}`}
            >
              {t.image_url ? <img src={smallCover(t.image_url)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />}
              <div className="main">
                <div className="title">
                  {active && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                  {title}
                </div>
                <div className="sub">{artistLine(t.artist, feat)}</div>
                {via && (
                  <span className="via-chip" title={items[i].reason ?? undefined}>
                    via {via}
                  </span>
                )}
              </div>
            </button>
            <HeartButton itemId={items[i].id} initial={items[i].hearted} />
          </div>
        );
      })}
    </div>
  );
}

// Mix page header (H2): a 2×2 mosaic of the edition's first covers beside the title.
export function Mosaic({ images }: { images: (string | null)[] }) {
  const four = [...new Set(images.filter(Boolean))].slice(0, 4) as string[];
  while (four.length < 4) four.push('');
  return (
    <div className="mix-mosaic" aria-hidden="true">
      {four.map((src, i) => (src ? <img key={i} src={smallCover(src)} alt="" decoding="async" /> : <span key={i} />))}
    </div>
  );
}

// Mix page actions (A1): a Play pill, then round Shuffle, Radio and Save buttons.
export function MixActions({
  tracks,
  from,
  editionId,
  savedId,
}: {
  tracks: TrackRowData[];
  from: string;
  editionId: string;
  savedId: string | null;
}) {
  const player = usePlayer();
  const [saved, setSaved] = useState<string | null>(savedId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 1800);
  };
  if (tracks.length === 0) return null;
  const playable = tracks.filter((t) => t.yt_audio_id);
  const radio = () => {
    const here = playable.find((t) => t.id === player.current?.id);
    const seed = here ?? playable[Math.floor(Math.random() * playable.length)];
    if (seed) player.startRadio(seed);
  };
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/discover/save-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save');
      setSaved(d.playlistId);
      flash(saved ? 'Playlist updated' : `Saved as “${d.name}”`);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mix-acts">
        <button type="button" className="mix-play" onClick={() => player.playList(tracks, 0, { noShuffle: true, from })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
          Play
        </button>
        <button type="button" className="round-btn" aria-label="Shuffle" onClick={() => player.playList(tracks, -1, { shuffle: true, from })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SPIRAL} /></svg>
        </button>
        <button type="button" className="round-btn" aria-label="Start a radio from this mix" disabled={!playable.length} onClick={radio}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="picon" dangerouslySetInnerHTML={{ __html: PLAYER_ICONS.radio }} />
        </button>
        <button
          type="button"
          className={`round-btn${saved ? ' on' : ''}`}
          aria-label={saved ? 'Update the saved playlist' : 'Save as playlist'}
          disabled={busy}
          onClick={save}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {saved ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
          </svg>
        </button>
        {saved && (
          <Link href={`/playlists/${saved}`} className="mix-open muted small">
            Open playlist ›
          </Link>
        )}
      </div>
      {msg && (
        <span className="d-toast" role="status">
          {msg}
        </span>
      )}
    </>
  );
}

type ArchiveEdition = { id: string; kind: string; edition_date: string; title: string; subtitle: string | null; count: number };
const WEEKLY = new Set(['weekly', 'releases', 'month', 'forgotten']);
const RADIO_KIND = 'radio';

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
          const radio = list.some((e) => e.kind === RADIO_KIND);
          return (
            <button
              key={iso}
              type="button"
              className={`${list.length ? 'has' : ''}${daily ? ' daily' : ''}${mix ? ' mix' : ''}${radio ? ' radio' : ''}${iso === today ? ' today' : ''}`}
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
        <span><i className="radio" />radio</span>
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

// Explore: the radio dial (Familiar ↔ New) and quick ways to start a radio.
// Any song's ⋯ menu and the Now Playing screen also have "Start radio".
const MODES: { id: RadioMode; label: string; note: string }[] = [
  { id: 'familiar', label: 'Familiar', note: 'Everything the radio suggests, including songs you already have.' },
  { id: 'mixed', label: 'Mixed', note: 'Mostly new to you, with about one song in three you already have.' },
  { id: 'new', label: 'New', note: 'Only songs that aren’t in your library.' },
];

// The radio icon on Discover: a planet with a ring. The back of the ring is
// hidden behind the planet (the planet is filled with the button's colour).
export function PlanetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="planet">
      <g transform="rotate(-20 12 12)">
        <path d="M1.8 12a10.2 3.7 0 0 1 20.4 0" />
        <circle cx="12" cy="12" r="5.4" className="planet-body" />
        <path d="M1.8 12a10.2 3.7 0 0 0 20.4 0" />
      </g>
    </svg>
  );
}

// Ready-made ideas for a radio from words.
const IDEAS = ['Chill', 'Focus', 'Workout', 'Rainy day', 'Late night', 'Sad songs', 'Party', 'K-indie', 'City pop', 'Lo-fi', 'Shoegaze', 'Jazz'];

export function RadioExplore({ seeds }: { seeds: { label: string; tracks: TrackRowData[] }[] }) {
  const player = usePlayer();
  const [mode, setMode] = useState<RadioMode>('mixed');
  useEffect(() => setMode(readRadioMode()), []);
  const choose = (m: RadioMode) => {
    setMode(m);
    try {
      localStorage.setItem(RADIO_MODE_KEY, m);
    } catch {
      /* private browsing */
    }
  };
  const start = (list: TrackRowData[]) => {
    const playable = list.filter((t) => t.yt_audio_id);
    if (playable.length) player.startRadio(playable[Math.floor(Math.random() * playable.length)]);
  };
  const usable = seeds.filter((s) => s.tracks.some((t) => t.yt_audio_id));
  // A radio from words: a genre, a mood, an artist, or anything you'd type into a search.
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fromWords = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setBusy(q);
    setErr(null);
    try {
      const res = await fetch(`/api/radio/seed?q=${encodeURIComponent(q)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'The radio couldn’t start.');
      const top: TrackRowData[] = (d.tracks ?? []).filter((t: TrackRowData) => t.yt_audio_id);
      if (!top.length) throw new Error(`Nothing found for “${q}”. Try other words.`);
      // One of the best few matches, so the same words don't always give the same radio.
      player.startRadio(top[Math.floor(Math.random() * Math.min(3, top.length))], q);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="d-radio">
      <div className="d-dial" role="radiogroup" aria-label="Radio: familiar or new">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => choose(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small d-hint">{MODES.find((m) => m.id === mode)?.note}</p>
      <form
        className="d-words"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          fromWords(words);
        }}
      >
        <input
          id="radio-words"
          type="search"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="A genre, mood or artist…"
          aria-label="Start a radio from words"
          enterKeyHint="go"
        />
        <button type="submit" className="primary" disabled={!words.trim() || Boolean(busy)}>
          {busy && busy === words.trim() ? 'Starting…' : 'Start'}
        </button>
      </form>
      <div className="d-ideas">
        {IDEAS.map((idea) => (
          <button key={idea} type="button" className="chip" disabled={Boolean(busy)} onClick={() => fromWords(idea)}>
            {busy === idea ? 'Starting…' : idea}
          </button>
        ))}
      </div>
      {err && <p className="small d-err" role="alert">{err}</p>}
      {usable.length > 0 && (
        <div className="d-radio-starts">
          {usable.map((s) => (
            <button key={s.label} type="button" className="chip" onClick={() => start(s.tracks)}>
              <PlanetIcon />
              {s.label}
            </button>
          ))}
        </div>
      )}
      <p className="muted small d-hint">
        Or start one from any song: tap its ⋯ menu, or Start radio on the Now Playing screen. Radios keep going as long as you
        listen, and the songs play right here.
      </p>
    </div>
  );
}

// "Save as playlist" on a saved radio or any Discover edition's page.
export function SaveAsPlaylist({ editionId, savedId }: { editionId: string; savedId: string | null }) {
  const [state, setState] = useState<{ busy: boolean; id: string | null; msg: string | null }>({ busy: false, id: savedId, msg: null });
  async function save() {
    setState((s) => ({ ...s, busy: true, msg: null }));
    try {
      const res = await fetch('/api/discover/save-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save');
      setState({ busy: false, id: d.playlistId, msg: `Saved as “${d.name}”` });
    } catch (err) {
      setState((s) => ({ ...s, busy: false, msg: (err as Error).message }));
    }
  }
  return (
    <div className="d-save">
      <button type="button" className="chip" onClick={save} disabled={state.busy}>
        {state.busy ? 'Saving…' : state.id ? 'Update the playlist' : 'Save as playlist'}
      </button>
      {state.id && (
        <Link href={`/playlists/${state.id}`} className="muted small">
          Open playlist ›
        </Link>
      )}
      {state.msg && <span className="muted small">{state.msg}</span>}
    </div>
  );
}
