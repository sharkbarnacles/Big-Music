'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { smallCover } from '@/lib/img';
import type { DialItem, DialKind, SpeedDial as Dial } from '@/lib/speedDial';
import { usePlayer } from './Player';

// "Jump back in" (Speed Dial Lab pick S1 + C3 + T1 + P1 + A1 + N1, with the
// owner's change): at the top of Home's playlist view, a 3×2 grid of recent
// radios / albums / artists / songs, one kind at a time (chips). The round
// play button on a cover plays it right away; tapping anywhere else opens the
// radio, album or artist page. Songs have no page, so tapping a song plays it.

const KINDS: { id: DialKind; label: string; badge: string }[] = [
  { id: 'radio', label: 'Radios', badge: 'Radio' },
  { id: 'album', label: 'Albums', badge: 'Album' },
  { id: 'artist', label: 'Artists', badge: 'Artist' },
  { id: 'song', label: 'Songs', badge: 'Song' },
];
const KEY = 'mh-dial-kind';
const EMPTY: Record<DialKind, string> = {
  radio: 'Radios you start show up here.',
  album: 'Albums show up once you’ve played a couple of their songs.',
  artist: 'Artists show up once you’ve played them a few times.',
  song: 'Songs you listen to for 30 seconds show up here.',
};

export default function SpeedDial({ dial }: { dial: Dial }) {
  const player = usePlayer();
  const [kind, setKind] = useState<DialKind>('radio');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as DialKind | null;
      if (saved && KINDS.some((k) => k.id === saved)) setKind(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const choose = (k: DialKind) => {
    setKind(k);
    try {
      localStorage.setItem(KEY, k);
    } catch {
      /* ignore */
    }
  };

  const items = dial[kind];
  const badge = KINDS.find((k) => k.id === kind)!.badge;

  const play = async (it: DialItem) => {
    if (busy) return;
    // A song plays at once, followed by your other recent songs.
    if (it.play.track) {
      const list = dial.song.map((s) => s.play.track!).filter(Boolean);
      const at = Math.max(0, list.findIndex((t) => t.id === it.play.track!.id));
      player.playList(list, at, { noShuffle: true, from: 'Jump back in' });
      return;
    }
    setBusy(it.key);
    try {
      const qs = it.play.radio
        ? new URLSearchParams({ radio: it.play.radio })
        : it.play.album
          ? new URLSearchParams({ album: it.play.album.name, artist: it.play.album.artist })
          : new URLSearchParams({ artist: it.play.artist ?? '' });
      const res = await fetch(`/api/speed-dial/play?${qs}`);
      const body = await res.json();
      if (!res.ok || !body.tracks?.length) throw new Error(body.error || 'Nothing to play there yet.');
      if (body.shuffle) player.playList(body.tracks, -1, { shuffle: true, source: body.source, from: body.from });
      else player.playList(body.tracks, 0, { noShuffle: true, from: body.from });
    } catch (e) {
      setNote((e as Error).message);
      setTimeout(() => setNote(null), 3000);
    } finally {
      setBusy(null);
    }
  };

  const cover = (it: DialItem) => (
    <span className="dial-art">
      {it.image ? <img src={smallCover(it.image, 'tile')} alt="" loading="lazy" decoding="async" /> : <span className="ph" />}
      <button
        type="button"
        className={`dial-play${busy === it.key ? ' busy' : ''}`}
        aria-label={`Play ${it.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          play(it);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
    </span>
  );
  const label = (it: DialItem) => (
    <>
      <span className="dial-name">{it.title}</span>
      <span className="dial-sub">
        <span className={`dial-badge ${it.kind}`}>{badge}</span>
        {it.sub}
      </span>
    </>
  );

  return (
    <section className="dial" aria-label="Jump back in">
      <div className="pl-sec dial-head">Jump back in</div>
      <div className="dial-chips" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="pl-chip" aria-pressed={kind === k.id} onClick={() => choose(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="small muted dial-empty">{EMPTY[kind]}</p>
      ) : (
        <div className="dial-grid">
          {items.map((it) =>
            it.href ? (
              <Link key={it.key} href={it.href} className="dial-tile">
                {cover(it)}
                {label(it)}
              </Link>
            ) : (
              <div key={it.key} className="dial-tile" role="button" tabIndex={0} onClick={() => play(it)} onKeyDown={(e) => e.key === 'Enter' && play(it)}>
                {cover(it)}
                {label(it)}
              </div>
            ),
          )}
        </div>
      )}
      {note && (
        <div className="flash-toast" role="status">
          {note}
        </div>
      )}
    </section>
  );
}
