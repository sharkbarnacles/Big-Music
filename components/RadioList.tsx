'use client';

import Link from 'next/link';
import { useState } from 'react';
import { smallCover } from '@/lib/img';
import type { RadioCard } from '@/lib/radioList';
import { usePlayer } from './Player';

// Library → Radios: every radio you've started, newest first. Tap a row to
// open the radio's page; the round button plays it straight away.

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? 'short' : undefined, day: 'numeric', month: 'short' });
};

export default function RadioList({ radios }: { radios: RadioCard[] }) {
  const player = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const shown = q.trim()
    ? radios.filter((r) => `${r.title} ${r.subtitle ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : radios;

  const play = async (r: RadioCard) => {
    if (busy) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/speed-dial/play?radio=${encodeURIComponent(r.id)}`);
      const body = await res.json();
      if (res.ok && body.tracks?.length) player.playList(body.tracks, 0, { noShuffle: true, from: body.from ?? `Radio · ${r.title}` });
    } finally {
      setBusy(null);
    }
  };

  if (!radios.length) return <p className="muted">Radios you start (from a song, a playlist or some words) show up here.</p>;

  return (
    <>
      {radios.length > 8 && (
        <input
          type="search"
          className="radio-filter"
          placeholder="Find a radio"
          aria-label="Find a radio"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <ul className="radio-list">
        {shown.map((r) => {
          const four = [...r.covers];
          while (four.length < 4) four.push('');
          return (
            <li key={r.id}>
              <Link href={`/discover/${r.id}`} className="radio-row">
                <span className="radio-mosaic" aria-hidden="true">
                  {four.map((src, i) => (src ? <img key={i} src={smallCover(src)} alt="" loading="lazy" decoding="async" /> : <span key={i} />))}
                </span>
                <span className="radio-text">
                  <span className="radio-name">{r.title}</span>
                  <span className="radio-meta">
                    {r.count} songs · {when(r.date)}
                    {r.subtitle ? ` · ${r.subtitle}` : ''}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                className={`radio-play${busy === r.id ? ' busy' : ''}`}
                aria-label={`Play ${r.title}`}
                onClick={() => play(r)}
              >
                {busy === r.id ? <span className="play-spin" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="muted small">No radio matches “{q}”.</p>}
    </>
  );
}
