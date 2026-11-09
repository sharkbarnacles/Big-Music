'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ImportButton from './ImportButton';
import { usePlayer } from './Player';

type Conn = { account: string | null } | null;

const SERVICES = [
  { id: 'spotify', name: 'Spotify', connect: '/api/auth/spotify/start' },
  { id: 'youtube', name: 'YouTube Music', connect: '/api/auth/google/start' },
] as const;

const ICON = {
  plug: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM4 21a8 8 0 0 1 16 0',
};

export default function HeaderBar({ spotify, youtube }: { spotify: Conn; youtube: Conn }) {
  const [open, setOpen] = useState<null | 'services' | 'account'>(null);
  const { youtubeMode, setYoutubeMode } = usePlayer();
  const conns = { spotify, youtube };
  const needsAttention = !spotify || !youtube;

  // Close the panel with the Escape key on a keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <header className="top-bar">
        <Link href="/" className="brand-small">Music Hub</Link>
        <div className="top-actions">
          {/* Which service plays songs (was inside the Now Playing "⋯" menu). */}
          <div className="mode-switch" role="group" aria-label="Play songs with">
            <button type="button" className="spotify" aria-pressed={!youtubeMode} onClick={() => youtubeMode && setYoutubeMode(false)}>
              <span className="dot spotify" aria-hidden="true" />Spotify
            </button>
            <button type="button" className="youtube" aria-pressed={youtubeMode} onClick={() => !youtubeMode && setYoutubeMode(true)}>
              <span className="dot youtube" aria-hidden="true" />YouTube
            </button>
          </div>
          <button
            type="button"
            className="round-btn"
            aria-label={needsAttention ? 'Services (one needs connecting)' : 'Services (both connected)'}
            onClick={() => setOpen('services')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.plug} /></svg>
            <span className="status-dots" aria-hidden="true">
              <span className="dot spotify" style={{ opacity: spotify ? 1 : 0.25 }} />
              <span className="dot youtube" style={{ opacity: youtube ? 1 : 0.25 }} />
            </span>
          </button>
          <button type="button" className="round-btn" aria-label="Account" onClick={() => setOpen('account')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.user} /></svg>
          </button>
        </div>
      </header>

      {open && (
        <>
          <button type="button" className="panel-back" aria-label="Close panel" onClick={() => setOpen(null)} />
          <div className="panel-sheet" role="dialog" aria-label={open === 'services' ? 'Services' : 'Account'}>
            <div className="panel-grab" aria-hidden="true" />
            {open === 'services' ? (
              <>
                <h3>Services</h3>
                {SERVICES.map((s) => {
                  const conn = conns[s.id];
                  return (
                    <div className="svc-card" key={s.id}>
                      <div className="svc-top">
                        <b><span className={`dot ${s.id}`} />{s.name}</b>
                        <span className="small muted">{conn ? `Connected as ${conn.account ?? 'you'}` : 'Not connected'}</span>
                      </div>
                      <div className="svc-acts">
                        {conn && <ImportButton service={s.id} label="Import playlists" />}
                        {conn && (
                          <Link className="btn" href={`/choose?service=${s.id}`} onClick={() => setOpen(null)}>
                            Choose which
                          </Link>
                        )}
                        <a className={`btn${conn ? '' : ' primary'}`} href={s.connect}>{conn ? 'Reconnect' : 'Connect'}</a>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <h3>Account</h3>
                <p className="small muted" style={{ margin: 0 }}>You’re logged in to Music Hub on this device.</p>
                <form action="/api/logout" method="post">
                  <button type="submit" className="panel-wide">Log out</button>
                </form>
              </>
            )}
            <button type="button" className="panel-wide primary" onClick={() => setOpen(null)}>Done</button>
          </div>
        </>
      )}
    </>
  );
}
