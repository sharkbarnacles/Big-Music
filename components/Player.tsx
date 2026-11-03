'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { sourceId, sourceUrl, type TrackRowData } from '@/lib/tracks';

// ── How playback works ────────────────────────────────────────────────
// Spotify songs: we tell the Spotify app (on your phone or computer) what to
//   play, along with the following Spotify songs in the list, so it keeps going.
//   Spotify doesn't allow playing inside a phone's web browser, so this is the
//   only way on iPhone. The Spotify app must have been opened recently.
// YouTube songs and music videos: played right here, in YouTube's own embedded
//   player. When one ends, the next song in the list with a YouTube version plays.
// Songs on both services play through Spotify (better sound, plays with the
// screen locked). "▶ Video" always uses YouTube.

type Mode = 'audio' | 'video';
type Via = 'spotify' | 'youtube';

type NowPlaying = {
  track: TrackRowData;
  via: Via;
  mode: Mode;
  device?: string; // which Spotify device is playing
};

type Notice = { text: string; link?: { href: string; label: string } };

type PlayerApi = {
  now: NowPlaying | null;
  play: (list: TrackRowData[], index: number, mode: Mode) => void;
};

const PlayerContext = createContext<PlayerApi>({ now: null, play: () => {} });
export const usePlayer = () => useContext(PlayerContext);

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Loads YouTube's player library once.
function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.getElementById('yt-iframe-api')) {
      const script = document.createElement('script');
      script.id = 'yt-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
}

async function spotifyControl(action: 'pause' | 'resume' | 'next' | 'previous') {
  const res = await fetch(`/api/player/spotify?action=${action}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message ?? data.error ?? 'Spotify did not respond.');
  }
}

// The YouTube ID to use for a song in a given mode, or null.
function youtubeIdFor(track: TrackRowData, mode: Mode): string | null {
  return mode === 'video' ? track.video_id : sourceId(track, 'youtube') ?? track.video_id;
}

const BAR_HEIGHT = 68;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Refs hold the latest values for YouTube's event callbacks.
  const queueRef = useRef<TrackRowData[]>([]);
  const indexRef = useRef(0);
  const nowRef = useRef<NowPlaying | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytPendingRef = useRef<string | null>(null);

  const update = useCallback((next: NowPlaying | null) => {
    nowRef.current = next;
    setNow(next);
  }, []);

  // Start loading YouTube's library early so the first play is quick.
  useEffect(() => {
    loadYouTubeApi().catch(() => {});
  }, []);

  // ── YouTube ─────────────────────────────────────────────────────────

  const advanceYouTube = useCallback(
    (step: 1 | -1) => {
      const mode = nowRef.current?.mode ?? 'audio';
      const list = queueRef.current;
      for (let i = indexRef.current + step; i >= 0 && i < list.length; i += step) {
        const id = youtubeIdFor(list[i], mode);
        if (id) {
          indexRef.current = i;
          update({ track: list[i], via: 'youtube', mode });
          ytPlayerRef.current?.loadVideoById(id);
          return true;
        }
      }
      return false;
    },
    [update],
  );

  const playYouTube = useCallback(
    async (videoId: string) => {
      const YT = await loadYouTubeApi();
      if (ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(videoId);
        return;
      }
      if (ytPendingRef.current) {
        ytPendingRef.current = videoId; // player still starting; it will pick this up
        return;
      }
      ytPendingRef.current = videoId;
      // YouTube replaces the element we give it, so hand it a plain child div
      // rather than one React manages.
      const target = document.createElement('div');
      hostRef.current?.replaceChildren(target);
      new YT.Player(target, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => {
            ytPlayerRef.current = e.target;
            const latest = ytPendingRef.current;
            ytPendingRef.current = null;
            if (latest && latest !== videoId) e.target.loadVideoById(latest);
            else e.target.playVideo();
          },
          onStateChange: (e: any) => {
            if (nowRef.current?.via !== 'youtube') return;
            if (e.data === 1) setPlaying(true); // playing
            if (e.data === 2) setPlaying(false); // paused
            if (e.data === 0 && !advanceYouTube(1)) setPlaying(false); // ended
          },
          onError: () => {
            // Video removed or blocked from embedding: skip to the next one.
            if (!advanceYouTube(1)) {
              setPlaying(false);
              setNotice({ text: 'YouTube won’t play this video here.' });
            }
          },
        },
      });
    },
    [advanceYouTube],
  );

  // ── Starting a song ─────────────────────────────────────────────────

  const play = useCallback(
    async (list: TrackRowData[], index: number, mode: Mode) => {
      const track = list[index];
      if (!track) return;
      queueRef.current = list;
      indexRef.current = index;
      setNotice(null);
      const previous = nowRef.current;

      const spotifyId = mode === 'audio' ? sourceId(track, 'spotify') : null;
      if (spotifyId) {
        ytPlayerRef.current?.pauseVideo?.();
        update({ track, via: 'spotify', mode });
        setPlaying(true);
        setBusy(true);
        const following = list
          .slice(index + 1)
          .map((t) => sourceId(t, 'spotify'))
          .filter((id): id is string => Boolean(id));
        try {
          const res = await fetch('/api/play/spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [spotifyId, ...following].slice(0, 50) }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setPlaying(false);
            const href = sourceUrl(track, 'spotify');
            setNotice({
              text: data.message ?? 'Spotify couldn’t play this song.',
              link: href ? { href, label: 'Open Spotify' } : undefined,
            });
            return;
          }
          if (nowRef.current?.track.id === track.id) update({ track, via: 'spotify', mode, device: data.device });
        } catch {
          setPlaying(false);
          setNotice({ text: 'Couldn’t reach your app. Check your connection.' });
        } finally {
          setBusy(false);
        }
        return;
      }

      const ytId = youtubeIdFor(track, mode);
      if (ytId) {
        if (previous?.via === 'spotify') spotifyControl('pause').catch(() => {});
        update({ track, via: 'youtube', mode });
        setPlaying(true);
        playYouTube(ytId);
        return;
      }

      setNotice({
        text: mode === 'video' ? 'No music video found for this song yet.' : 'This song has nothing to play from yet.',
      });
    },
    [playYouTube, update],
  );

  // ── Controls ────────────────────────────────────────────────────────

  const runSpotify = async (action: 'pause' | 'resume' | 'next' | 'previous') => {
    try {
      await spotifyControl(action);
      return true;
    } catch (err) {
      setNotice({ text: (err as Error).message });
      return false;
    }
  };

  const togglePlay = async () => {
    if (!now) return;
    if (now.via === 'youtube') {
      if (playing) ytPlayerRef.current?.pauseVideo?.();
      else ytPlayerRef.current?.playVideo?.();
      return;
    }
    if (await runSpotify(playing ? 'pause' : 'resume')) setPlaying(!playing);
  };

  const skip = async (step: 1 | -1) => {
    if (!now) return;
    if (now.via === 'youtube') {
      advanceYouTube(step);
      return;
    }
    if (!(await runSpotify(step === 1 ? 'next' : 'previous'))) return;
    // Keep the bar in step with Spotify's queue (the Spotify songs in the list).
    const list = queueRef.current;
    for (let i = indexRef.current + step; i >= 0 && i < list.length; i += step) {
      if (sourceId(list[i], 'spotify')) {
        indexRef.current = i;
        update({ ...now, track: list[i] });
        break;
      }
    }
    setPlaying(true);
  };

  const close = () => {
    if (now?.via === 'youtube') ytPlayerRef.current?.pauseVideo?.();
    if (now?.via === 'spotify' && playing) spotifyControl('pause').catch(() => {});
    setPlaying(false);
    setNotice(null);
    update(null);
  };

  const watchVideo = () => {
    if (now?.track.video_id) play(queueRef.current, indexRef.current, 'video');
  };
  const listenOnly = () => {
    if (now) play(queueRef.current, indexRef.current, 'audio');
  };

  const showYouTube = now?.via === 'youtube';
  const videoMode = showYouTube && now?.mode === 'video';
  const visible = Boolean(now || notice);

  // Where the YouTube player sits: a small square in the bar for songs,
  // a wide panel above the bar for music videos, hidden otherwise.
  // (env(safe-area-inset-bottom) is the space above an iPhone's home bar.)
  const hostStyle: React.CSSProperties = videoMode
    ? {
        left: 0,
        right: 0,
        bottom: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        width: '100%',
        aspectRatio: '16 / 9',
        maxHeight: '45vh',
      }
    : showYouTube
      ? {
          left: 12,
          bottom: `calc(${(BAR_HEIGHT - 48) / 2}px + env(safe-area-inset-bottom))`,
          width: 48,
          height: 48,
          borderRadius: 6,
        }
      : { left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' };

  return (
    <PlayerContext.Provider value={{ now, play }}>
      {children}

      {/* Space so the bar never covers the end of a list. */}
      {visible && <div aria-hidden="true" style={{ height: BAR_HEIGHT + 24 + (videoMode ? 240 : 0) }} />}

      <div ref={hostRef} className="yt-host" style={hostStyle} />

      {visible && (
        <div className="player-bar" role="region" aria-label="Player" style={{ height: BAR_HEIGHT }}>
          {notice && (
            <div className="player-notice">
              <span>{notice.text}</span>
              {notice.link && (
                <a href={notice.link.href} target="_blank" rel="noreferrer">
                  {notice.link.label}
                </a>
              )}
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
                ✕
              </button>
            </div>
          )}

          {now && (
            <>
              {showYouTube ? (
                <div className="player-art-slot" />
              ) : now.track.image_url ? (
                <img className="player-art" src={now.track.image_url} alt="" />
              ) : (
                <div className="player-art" />
              )}
              <div className="player-text">
                <div className="title">{now.track.title}</div>
                <div className="sub">
                  {now.track.artist} ·{' '}
                  {busy
                    ? 'starting…'
                    : now.via === 'spotify'
                      ? `Spotify${now.device ? ` on ${now.device}` : ''}`
                      : now.mode === 'video'
                        ? 'Music video'
                        : 'YouTube'}
                </div>
              </div>
              <div className="player-controls">
                {now.track.video_id && now.mode === 'audio' && (
                  <button type="button" className="ctrl" aria-label="Watch music video" onClick={watchVideo}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="3" />
                      <path d="M10 9l5 3-5 3z" />
                    </svg>
                  </button>
                )}
                {now.mode === 'video' && (
                  <button type="button" className="ctrl" aria-label="Listen without video" onClick={listenOnly}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </button>
                )}
                <button type="button" className="ctrl" aria-label="Previous" onClick={() => skip(-1)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M19 5L9 12l10 7zM5 5v14" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="ctrl primary"
                  aria-label={playing ? 'Pause' : 'Play'}
                  onClick={togglePlay}
                >
                  {playing ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14M16 5v14" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 4l13 8-13 8z" />
                    </svg>
                  )}
                </button>
                <button type="button" className="ctrl" aria-label="Next" onClick={() => skip(1)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 5l10 7-10 7zM19 5v14" />
                  </svg>
                </button>
                <button type="button" className="ctrl" aria-label="Close player" onClick={close}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </PlayerContext.Provider>
  );
}
