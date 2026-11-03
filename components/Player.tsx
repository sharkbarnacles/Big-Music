'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { sourceId, sourceUrl, type TrackRowData } from '@/lib/tracks';

// ── How playback works ────────────────────────────────────────────────
// The hub owns the queue: which songs, in what order, shuffle and repeat.
// Each song is then played by one of two "engines":
//
//  • Spotify — the hub tells a Spotify player what to play, through your
//    account, without you leaving the hub. On a computer that player is this
//    browser tab (Spotify's in-browser player). On a phone it's the Spotify
//    app running in the background, because Spotify doesn't allow playing
//    inside phone browsers. The hub also hands Spotify the next few Spotify
//    songs, so music continues with the screen locked, and checks every few
//    seconds what's playing to keep its queue in step.
//  • YouTube — YouTube's embedded player, right inside the hub. Used for
//    songs that are only on YouTube, music videos, and everything when
//    "YouTube mode" is on (no Spotify app needed, but the screen must stay on).

type Engine = 'spotify' | 'youtube';
type Repeat = 'off' | 'all' | 'one';
type Choice = { engine: Engine; id: string } | { engine: 'lookup' };
type Notice = { text: string; link?: { href: string; label: string }; action?: { label: string; run: () => void } };

type PlayOptions = { shuffle?: boolean; noShuffle?: boolean; video?: boolean };

type PlayerApi = {
  current: TrackRowData | null;
  youtubeMode: boolean;
  setYoutubeMode: (on: boolean) => void;
  playList: (list: TrackRowData[], start: number, opts?: PlayOptions) => void;
  playNext: (track: TrackRowData) => void;
  addToQueue: (track: TrackRowData) => void;
};

const PlayerContext = createContext<PlayerApi>({
  current: null,
  youtubeMode: false,
  setYoutubeMode: () => {},
  playList: () => {},
  playNext: () => {},
  addToQueue: () => {},
});
export const usePlayer = () => useContext(PlayerContext);

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
    Spotify?: any;
    onSpotifyWebPlaybackSDKReady?: () => void;
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

async function spotifyAction(query: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/player/spotify?${query}`, { method: 'POST' });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data.message ?? 'Spotify did not respond.' };
  } catch {
    return { ok: false, message: 'Couldn’t reach your app. Check your connection.' };
  }
}

function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const isPhone = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const BAR_HEIGHT = 68;
const YT_MODE_KEY = 'musichub.youtubeMode';

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // ── State (and refs that mirror it, for callbacks from YouTube/Spotify) ──
  const [queue, setQueue] = useState<TrackRowData[]>([]);
  const [index, setIndex] = useState(-1);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [youtubeMode, setYoutubeModeState] = useState(true); // YouTube-first by default
  const [video, setVideo] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [device, setDevice] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const queueRef = useRef<TrackRowData[]>([]);
  const baseRef = useRef<TrackRowData[]>([]); // the list in its original order (for turning shuffle off)
  const indexRef = useRef(-1);
  const engineRef = useRef<Engine | null>(null);
  const playingRef = useRef(false);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<Repeat>('off');
  const ytModeRef = useRef(true);
  const videoRef = useRef(false);
  const posRef = useRef({ ms: 0, at: 0 }); // last known Spotify position
  const draggingRef = useRef(false);
  const tokenRef = useRef(0); // increases on every new play, so stale replies are ignored
  const runRef = useRef<{ ids: string[]; idx: number[] } | null>(null); // songs handed to Spotify
  const lastPlayedEndRef = useRef(false);
  const pollingRef = useRef(false);
  const ytErrorsRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytPendingRef = useRef<{ id: string; start: number } | null>(null);
  const sdkPlayerRef = useRef<any>(null);
  const sdkDeviceRef = useRef<string | null>(null);

  const current = index >= 0 ? queue[index] ?? null : null;

  const setQ = (q: TrackRowData[], i: number) => {
    queueRef.current = q;
    indexRef.current = i;
    setQueue(q);
    setIndex(i);
  };
  const setI = (i: number) => {
    indexRef.current = i;
    setIndex(i);
  };
  const setEng = (e: Engine | null) => {
    engineRef.current = e;
    setEngine(e);
  };
  const setPlay = (p: boolean) => {
    playingRef.current = p;
    setPlaying(p);
  };
  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };
  // Browsers only allow sound after a tap; this lets Spotify's in-browser player start.
  const gesture = () => sdkPlayerRef.current?.activateElement?.();

  const currentProgress = () =>
    engineRef.current === 'spotify' && playingRef.current
      ? posRef.current.ms + (Date.now() - posRef.current.at)
      : progress;

  // ── Choosing how to play a song ──────────────────────────────────────

  const decide = (track: TrackRowData, wantVideo: boolean): Choice => {
    if (wantVideo && track.video_id) return { engine: 'youtube', id: track.video_id };
    const spotify = sourceId(track, 'spotify');
    if (!ytModeRef.current && spotify) return { engine: 'spotify', id: spotify };
    const yt = track.yt_audio_id ?? sourceId(track, 'youtube') ?? track.video_id;
    if (yt) return { engine: 'youtube', id: yt };
    return { engine: 'lookup' };
  };

  const nextIndex = (i: number): number | null => {
    const n = queueRef.current.length;
    if (i + 1 < n) return i + 1;
    if (repeatRef.current === 'all' && n > 0) return 0;
    return null;
  };

  // Asks the server to find a YouTube version of a Spotify-only song.
  const lookup = async (track: TrackRowData): Promise<string | null> => {
    try {
      const res = await fetch('/api/youtube/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: track.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.audioId) {
        track.yt_audio_id = data.audioId; // remember for the rest of this session
        return data.audioId;
      }
      if (data.message) showToast(data.message);
    } catch {
      /* handled by caller */
    }
    return null;
  };

  // ── Playing ──────────────────────────────────────────────────────────

  const playAt = async (i: number, opts: { positionMs?: number; skips?: number } = {}) => {
    const track = queueRef.current[i];
    if (!track) return;
    const token = ++tokenRef.current;
    setI(i);
    setNotice(null);
    setProgress(opts.positionMs ?? 0);
    setDuration(track.duration_ms ?? 0);

    let choice = decide(track, videoRef.current);
    if (choice.engine === 'lookup') {
      setBusy(true);
      const id = await lookup(track);
      if (token !== tokenRef.current) return;
      setBusy(false);
      if (!id) {
        const skips = (opts.skips ?? 0) + 1;
        const n = nextIndex(i);
        showToast(`Skipped “${track.title}”: no YouTube version yet`);
        if (n !== null && skips < 5) playAt(n, { skips });
        else setPlay(false);
        return;
      }
      choice = { engine: 'youtube', id };
    }
    if (choice.engine === 'spotify') await startSpotify(i, token, opts.positionMs ?? 0);
    else startYouTube(choice.id, opts.positionMs ?? 0);
  };

  const startSpotify = async (i: number, token: number, positionMs: number) => {
    if (engineRef.current === 'youtube') ytPlayerRef.current?.pauseVideo?.();
    setEng('spotify');

    // Hand Spotify this song plus the following Spotify songs (up to 50),
    // so it keeps playing even while the phone is locked.
    const list = queueRef.current;
    const ids: string[] = [];
    const idx: number[] = [];
    for (let j = i; j < list.length && ids.length < 50; j++) {
      const c = decide(list[j], videoRef.current);
      if (c.engine !== 'spotify') break;
      ids.push(c.id);
      idx.push(j);
    }
    runRef.current = { ids, idx };
    lastPlayedEndRef.current = false;
    setPlay(true);
    setBusy(true);
    try {
      const res = await fetch('/api/play/spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          positionMs,
          deviceId: sdkDeviceRef.current,
          repeatOne: repeatRef.current === 'one',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (token !== tokenRef.current) return;
      if (!res.ok) {
        setPlay(false);
        const href = sourceUrl(list[i], 'spotify');
        setNotice({
          text: data.message ?? 'Spotify couldn’t play this song.',
          link: data.error === 'no_device' && href ? { href, label: 'Open Spotify' } : undefined,
          action: { label: 'Use YouTube mode', run: () => setYoutubeMode(true) },
        });
        return;
      }
      setDevice(data.device ?? null);
      posRef.current = { ms: positionMs, at: Date.now() };
      setTimeout(() => pollSpotify(), 1500);
    } catch {
      if (token === tokenRef.current) {
        setPlay(false);
        setNotice({ text: 'Couldn’t reach your app. Check your connection.' });
      }
    } finally {
      if (token === tokenRef.current) setBusy(false);
    }
  };

  const startYouTube = (id: string, startMs: number) => {
    if (engineRef.current === 'spotify' && playingRef.current) spotifyAction('action=pause');
    runRef.current = null;
    setEng('youtube');
    setDevice(null);
    setPlay(true);
    playYouTube(id, startMs / 1000);
  };

  const playYouTube = async (id: string, start: number) => {
    const YT = await loadYouTubeApi();
    if (ytPlayerRef.current) {
      ytPlayerRef.current.loadVideoById({ videoId: id, startSeconds: start });
      return;
    }
    if (ytPendingRef.current) {
      ytPendingRef.current = { id, start }; // player still starting; it picks this up
      return;
    }
    ytPendingRef.current = { id, start };
    // YouTube replaces the element it's given, so hand it a plain child div.
    const target = document.createElement('div');
    hostRef.current?.replaceChildren(target);
    new YT.Player(target, {
      width: '100%',
      height: '100%',
      videoId: id,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start) },
      events: {
        onReady: (e: any) => {
          ytPlayerRef.current = e.target;
          const latest = ytPendingRef.current;
          ytPendingRef.current = null;
          if (latest && latest.id !== id) e.target.loadVideoById({ videoId: latest.id, startSeconds: latest.start });
          else e.target.playVideo();
        },
        onStateChange: (e: any) => api.current.onYouTubeState(e.data),
        onError: () => api.current.onYouTubeError(),
      },
    });
  };

  // Called by YouTube; goes through a ref so it always sees the latest state.
  const onYouTubeState = (state: number) => {
    if (engineRef.current !== 'youtube') return;
    if (state === 1) {
      ytErrorsRef.current = 0;
      setPlay(true);
    }
    if (state === 2) setPlay(false);
    if (state === 0) {
      if (repeatRef.current === 'one') {
        ytPlayerRef.current?.seekTo(0, true);
        ytPlayerRef.current?.playVideo();
        return;
      }
      const n = nextIndex(indexRef.current);
      if (n !== null) playAt(n);
      else setPlay(false);
    }
  };

  const onYouTubeError = () => {
    if (engineRef.current !== 'youtube') return;
    const track = queueRef.current[indexRef.current];
    ytErrorsRef.current += 1;
    showToast(`Skipped “${track?.title ?? 'song'}”: YouTube won’t play it here`);
    const n = nextIndex(indexRef.current);
    if (n !== null && ytErrorsRef.current < 5) playAt(n);
    else setPlay(false);
  };

  // ── Keeping in step with Spotify ────────────────────────────────────

  const pollSpotify = async () => {
    if (engineRef.current !== 'spotify' || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch('/api/player/spotify', { cache: 'no-store' });
      if (!res.ok || engineRef.current !== 'spotify') return;
      const d = await res.json();
      if (!d.active) {
        setPlay(false);
        return;
      }
      if (!draggingRef.current) {
        posRef.current = { ms: d.progressMs, at: Date.now() };
        setProgress(d.progressMs);
      }
      if (d.durationMs) setDuration(d.durationMs);
      setDevice(d.deviceName);
      setPlay(d.isPlaying);

      const run = runRef.current;
      if (!run) return;
      const pos = run.ids.findIndex((id) => d.trackIds.includes(id));
      if (pos < 0) return; // something else is playing in Spotify
      const qi = run.idx[pos];
      if (qi !== indexRef.current) setI(qi);

      // The last song Spotify was given has finished: the hub plays what's next
      // (for example a YouTube-only song). Only works while the hub is open.
      const isLast = pos === run.ids.length - 1;
      if (d.isPlaying) {
        lastPlayedEndRef.current = isLast;
        return;
      }
      const atEdge = d.progressMs < 1500 || d.durationMs - d.progressMs < 3000;
      if (isLast && lastPlayedEndRef.current && atEdge && repeatRef.current !== 'one') {
        lastPlayedEndRef.current = false;
        const n = nextIndex(qi);
        if (n !== null) playAt(n);
      }
    } catch {
      /* try again on the next check */
    } finally {
      pollingRef.current = false;
    }
  };

  // If the songs after the current one changed (shuffle, play next…),
  // give Spotify the new line-up, continuing the current song where it is.
  const resyncSpotify = () => {
    if (engineRef.current !== 'spotify' || !runRef.current) return;
    const list = queueRef.current;
    const ids: string[] = [];
    for (let j = indexRef.current; j < list.length && ids.length < 50; j++) {
      const c = decide(list[j], videoRef.current);
      if (c.engine !== 'spotify') break;
      ids.push(c.id);
    }
    const run = runRef.current;
    const start = run.idx.indexOf(indexRef.current);
    const remaining = start >= 0 ? run.ids.slice(start) : [];
    if (ids.join() !== remaining.join()) {
      const wasPlaying = playingRef.current;
      playAt(indexRef.current, { positionMs: currentProgress() }).then(() => {
        if (!wasPlaying) spotifyAction('action=pause').then(() => setPlay(false));
      });
    }
  };

  // ── Controls ────────────────────────────────────────────────────────

  const togglePlay = async () => {
    gesture();
    if (!current || busy) return;
    if (engineRef.current === 'youtube') {
      if (playingRef.current) ytPlayerRef.current?.pauseVideo?.();
      else ytPlayerRef.current?.playVideo?.();
      return;
    }
    if (playingRef.current) {
      const r = await spotifyAction('action=pause');
      if (r.ok) {
        posRef.current = { ms: currentProgress(), at: Date.now() };
        setPlay(false);
      } else setNotice({ text: r.message ?? 'Spotify didn’t pause.' });
    } else {
      const r = await spotifyAction('action=resume');
      if (r.ok) {
        posRef.current = { ms: progress, at: Date.now() };
        setPlay(true);
      } else playAt(indexRef.current, { positionMs: progress }); // Spotify forgot; start it again
    }
  };

  const next = () => {
    gesture();
    const n = nextIndex(indexRef.current);
    if (n !== null) playAt(n);
  };

  const prev = () => {
    gesture();
    if (currentProgress() > 3000 || indexRef.current <= 0) seek(0);
    else playAt(indexRef.current - 1);
  };

  const seek = (ms: number) => {
    setProgress(ms);
    if (engineRef.current === 'youtube') ytPlayerRef.current?.seekTo?.(ms / 1000, true);
    if (engineRef.current === 'spotify') {
      posRef.current = { ms, at: Date.now() };
      spotifyAction(`action=seek&positionMs=${Math.floor(ms)}`);
    }
  };

  const toggleShuffle = () => {
    const cur = queueRef.current[indexRef.current];
    if (!shuffleRef.current) {
      const rest = cur ? baseRef.current.filter((t) => t !== cur) : baseRef.current;
      const q = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
      setQ(q, cur ? 0 : -1);
    } else {
      const base = baseRef.current;
      setQ(base, cur ? Math.max(0, base.indexOf(cur)) : -1);
    }
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
    resyncSpotify();
  };

  const cycleRepeat = () => {
    const r: Repeat = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = r;
    setRepeat(r);
    if (engineRef.current === 'spotify') spotifyAction(`action=repeat&state=${r === 'one' ? 'track' : 'off'}`);
  };

  const setYoutubeMode = (on: boolean) => {
    ytModeRef.current = on;
    setYoutubeModeState(on);
    try {
      localStorage.setItem(YT_MODE_KEY, on ? '1' : '0');
    } catch {
      /* private browsing: the switch just won't be remembered */
    }
    setNotice(null);
    const track = queueRef.current[indexRef.current];
    if (!track) return;
    const wanted = decide(track, videoRef.current).engine;
    if (wanted !== engineRef.current) playAt(indexRef.current, { positionMs: currentProgress() });
    else resyncSpotify();
  };

  const toggleVideo = () => {
    gesture();
    videoRef.current = !videoRef.current;
    setVideo(videoRef.current);
    if (current) playAt(indexRef.current);
  };

  const playList = (list: TrackRowData[], start: number, opts: PlayOptions = {}) => {
    gesture();
    if (list.length === 0) return;
    baseRef.current = list.slice();
    if (opts.noShuffle) shuffleRef.current = false;
    if (opts.shuffle) shuffleRef.current = true;
    setShuffle(shuffleRef.current);
    videoRef.current = Boolean(opts.video);
    setVideo(videoRef.current);

    let q = baseRef.current;
    let i = Math.max(0, start);
    if (shuffleRef.current) {
      const first = start >= 0 ? list[start] : null;
      const rest = first ? q.filter((_, j) => j !== start) : q;
      q = first ? [first, ...shuffled(rest)] : shuffled(rest);
      i = 0;
    }
    setQ(q, i);
    playAt(i);
  };

  const playNext = (track: TrackRowData) => {
    if (indexRef.current < 0) return playList([track], 0);
    const q = queueRef.current.slice();
    q.splice(indexRef.current + 1, 0, track);
    const cur = queueRef.current[indexRef.current];
    const base = baseRef.current.slice();
    base.splice(Math.max(0, base.indexOf(cur)) + 1, 0, track);
    baseRef.current = base;
    setQ(q, indexRef.current);
    showToast(`Playing next: ${track.title}`);
    resyncSpotify();
  };

  const addToQueue = (track: TrackRowData) => {
    if (indexRef.current < 0) return playList([track], 0);
    baseRef.current = [...baseRef.current, track];
    setQ([...queueRef.current, track], indexRef.current);
    showToast(`Added to queue: ${track.title}`);
    resyncSpotify();
  };

  const removeAt = (j: number) => {
    if (j === indexRef.current) return;
    const q = queueRef.current.slice();
    const [gone] = q.splice(j, 1);
    const bi = baseRef.current.indexOf(gone);
    if (bi >= 0) baseRef.current = baseRef.current.filter((_, k) => k !== bi);
    setQ(q, j < indexRef.current ? indexRef.current - 1 : indexRef.current);
    resyncSpotify();
  };

  const closePlayer = () => {
    tokenRef.current++;
    if (engineRef.current === 'youtube') ytPlayerRef.current?.pauseVideo?.();
    if (engineRef.current === 'spotify' && playingRef.current) spotifyAction('action=pause');
    runRef.current = null;
    setEng(null);
    setPlay(false);
    setNotice(null);
    setSheetOpen(false);
    setQ([], -1);
  };

  // Lets YouTube's callbacks reach the latest versions of these functions.
  const api = useRef({ onYouTubeState, onYouTubeError });
  api.current = { onYouTubeState, onYouTubeError };
  const pollRef = useRef(pollSpotify);
  pollRef.current = pollSpotify;

  // ── Background work ─────────────────────────────────────────────────

  // Remember the YouTube mode switch; load YouTube's library early.
  useEffect(() => {
    try {
      // On unless you've switched it off on this device.
      const on = localStorage.getItem(YT_MODE_KEY) !== '0';
      ytModeRef.current = on;
      setYoutubeModeState(on);
    } catch {
      /* ignore */
    }
    loadYouTubeApi().catch(() => {});
  }, []);

  // On computers, start Spotify's in-browser player so songs play in this tab.
  useEffect(() => {
    if (isPhone() || window.location.pathname === '/login') return;
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Music Hub (this browser)',
        volume: 0.8,
        getOAuthToken: (cb: (t: string) => void) => {
          fetch('/api/spotify/token')
            .then((r) => r.json())
            .then((d) => d.token && cb(d.token))
            .catch(() => {});
        },
      });
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        sdkDeviceRef.current = device_id;
      });
      player.addListener('not_ready', () => {
        sdkDeviceRef.current = null;
      });
      player.connect();
      sdkPlayerRef.current = player;
    };
    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(script);
    }
  }, []);

  // While Spotify is the engine, check what it's playing every few seconds
  // (only while the hub is on screen), and right away when you come back.
  useEffect(() => {
    if (engine !== 'spotify') return;
    const tick = () => document.visibilityState === 'visible' && pollRef.current();
    const timer = setInterval(tick, 2500);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [engine]);

  // Move the progress bar smoothly.
  useEffect(() => {
    if (!engine) return;
    const timer = setInterval(() => {
      if (draggingRef.current) return;
      if (engineRef.current === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
        setProgress(ytPlayerRef.current.getCurrentTime() * 1000);
        const d = ytPlayerRef.current.getDuration?.();
        if (d) setDuration(d * 1000);
      } else if (engineRef.current === 'spotify' && playingRef.current) {
        setProgress(posRef.current.ms + (Date.now() - posRef.current.at));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [engine]);

  // ── Layout ──────────────────────────────────────────────────────────

  const ytActive = engine === 'youtube';
  // Where YouTube's player sits: over the artwork in Now Playing, a wide
  // panel above the bar for music videos, a small square in the bar, or hidden.
  const hostStyle: React.CSSProperties =
    ytActive && sheetOpen && !queueOpen
      ? {
          top: 'calc(env(safe-area-inset-top) + 64px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(calc(100% - 40px), 520px)',
          aspectRatio: '16 / 9',
          zIndex: 41,
          borderRadius: 12,
        }
      : ytActive && !sheetOpen && video
        ? {
            left: 0,
            right: 0,
            bottom: `calc(var(--nav-h) + ${BAR_HEIGHT + 16}px + env(safe-area-inset-bottom))`,
            width: '100%',
            aspectRatio: '16 / 9',
            maxHeight: '45vh',
          }
        : ytActive && !sheetOpen
          ? {
              // over the artwork square in the floating player card
              left: 'calc(max(10px, env(safe-area-inset-left)) + 9px)',
              bottom: `calc(var(--nav-h) + ${8 + (BAR_HEIGHT - 48) / 2}px + env(safe-area-inset-bottom))`,
              width: 48,
              height: 48,
              borderRadius: 6,
            }
          : { left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' };

  const pct = duration ? Math.min(100, (progress / duration) * 100) : 0;
  const status = busy
    ? 'Starting…'
    : engine === 'spotify'
      ? `Spotify${device ? ` · ${device}` : ''}`
      : video && current?.video_id
        ? 'Music video · in the hub'
        : 'YouTube · in the hub';

  const commitSeek = (ms: number) => {
    draggingRef.current = false;
    seek(ms);
  };

  const icon = (d: string, filled = false) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? 'filled' : undefined}>
      <path d={d} />
    </svg>
  );
  const ICON = {
    play: 'M7 4l13 8-13 8z',
    pause: 'M8 5v14M16 5v14',
    next: 'M5 5l10 7-10 7zM19 5v14',
    prev: 'M19 5L9 12l10 7zM5 5v14',
    // Spiral (owner's pick for Shuffle).
    shuffle: 'M12 12a1.5 1.5 0 0 1 1.5 1.5a3 3 0 0 1-3 3a4.5 4.5 0 0 1-4.5-4.5a6 6 0 0 1 6-6a7.5 7.5 0 0 1 7.5 7.5',
    repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    down: 'M6 9l6 6 6-6',
    queue: 'M3 6h13M3 12h13M3 18h9M17 15l5 3-5 3z',
    video: 'M3 5h18v14H3zM10 9l5 3-5 3z',
    close: 'M6 6l12 12M18 6L6 18',
  };

  return (
    <PlayerContext.Provider value={{ current, youtubeMode, setYoutubeMode, playList, playNext, addToQueue }}>
      {children}

      {/* Space so the bar never covers the end of a list. */}
      {current && <div aria-hidden="true" style={{ height: BAR_HEIGHT + 24 + (video && ytActive ? 240 : 0) }} />}

      <div ref={hostRef} className="yt-host" style={hostStyle} />

      {(toast || notice) && !sheetOpen && (
        <div className="player-float" style={{ bottom: `calc(var(--nav-h) + ${current ? BAR_HEIGHT + 16 : 10}px + env(safe-area-inset-bottom))` }}>
          {notice ? (
            <div className="player-notice">
              <span>{notice.text}</span>
              {notice.link && (
                <a href={notice.link.href} target="_blank" rel="noreferrer">
                  {notice.link.label}
                </a>
              )}
              {notice.action && (
                <button type="button" className="link" onClick={notice.action.run}>
                  {notice.action.label}
                </button>
              )}
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
                ✕
              </button>
            </div>
          ) : (
            <div className="player-toast" role="status">
              {toast}
            </div>
          )}
        </div>
      )}

      {current && !sheetOpen && (
        <div className="player-bar" role="region" aria-label="Player" style={{ height: BAR_HEIGHT }}>
          <div className="player-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
          {ytActive ? (
            <div className="player-art-slot" />
          ) : current.image_url ? (
            <img className="player-art" src={current.image_url} alt="" />
          ) : (
            <div className="player-art" />
          )}
          <button type="button" className="player-text" onClick={() => setSheetOpen(true)} aria-label="Open Now Playing">
            <span className="title">{current.title}</span>
            <span className="sub">
              {current.artist} · {status}
            </span>
          </button>
          <div className="player-controls">
            <button type="button" className="ctrl primary" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {playing ? icon(ICON.pause) : icon(ICON.play, true)}
            </button>
            <button type="button" className="ctrl" aria-label="Next song" onClick={next}>
              {icon(ICON.next)}
            </button>
          </div>
        </div>
      )}

      {current && sheetOpen && (
        <div className="sheet" role="dialog" aria-label="Now playing">
          <div className="sheet-head">
            <button type="button" className="ctrl" aria-label="Close Now Playing" onClick={() => setSheetOpen(false)}>
              {icon(ICON.down)}
            </button>
            <span>{queueOpen ? 'Queue' : 'Now playing'}</span>
            <button
              type="button"
              className={`ctrl${queueOpen ? ' on' : ''}`}
              aria-label={queueOpen ? 'Back to Now Playing' : 'Show queue'}
              onClick={() => setQueueOpen(!queueOpen)}
            >
              {icon(ICON.queue)}
            </button>
          </div>

          {!queueOpen ? (
            <div className="sheet-body">
              <div className={`sheet-art${ytActive ? ' wide' : ''}`}>
                {!ytActive && current.image_url && <img src={current.image_url} alt="" />}
              </div>
              <div className="sheet-title">{current.title}</div>
              <div className="sheet-artist">{current.artist}</div>

              <div className="sheet-progress">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(duration))}
                  value={Math.floor(Math.min(progress, duration || progress))}
                  aria-label="Position in song"
                  onChange={(e) => {
                    draggingRef.current = true;
                    setProgress(Number(e.target.value));
                  }}
                  onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                  onKeyUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                />
                <div className="times">
                  <span>{formatTime(progress)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="sheet-controls">
                <button type="button" className={`ctrl${shuffle ? ' on' : ''}`} aria-label="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}>
                  {icon(ICON.shuffle)}
                </button>
                <button type="button" className="ctrl big" aria-label="Previous" onClick={prev}>
                  {icon(ICON.prev)}
                </button>
                <button type="button" className="ctrl primary huge" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                  {playing ? icon(ICON.pause) : icon(ICON.play, true)}
                </button>
                <button type="button" className="ctrl big" aria-label="Next" onClick={next}>
                  {icon(ICON.next)}
                </button>
                <button
                  type="button"
                  className={`ctrl${repeat !== 'off' ? ' on' : ''}`}
                  aria-label={`Repeat: ${repeat}`}
                  onClick={cycleRepeat}
                >
                  {icon(ICON.repeat)}
                  {repeat === 'one' && <span className="repeat-one">1</span>}
                </button>
              </div>

              <div className="sheet-options">
                {current.video_id && (
                  <button type="button" className={`chip${video ? ' on' : ''}`} onClick={toggleVideo}>
                    {icon(ICON.video)} {video ? 'Watching video' : 'Watch video'}
                  </button>
                )}
                <label className="switch">
                  <input type="checkbox" checked={youtubeMode} onChange={(e) => setYoutubeMode(e.target.checked)} />
                  <span className="track" aria-hidden="true" />
                  YouTube mode
                </label>
              </div>
              <p className="sheet-device">
                {engine === 'spotify'
                  ? `Playing through Spotify${device ? ` on ${device}` : ''}. Keeps going with your screen locked.`
                  : 'Playing inside the hub with YouTube. Keep the screen on.'}
              </p>
              {notice && (
                <div className="player-notice inline">
                  <span>{notice.text}</span>
                  {notice.link && (
                    <a href={notice.link.href} target="_blank" rel="noreferrer">
                      {notice.link.label}
                    </a>
                  )}
                  {notice.action && (
                    <button type="button" className="link" onClick={notice.action.run}>
                      {notice.action.label}
                    </button>
                  )}
                </div>
              )}
              <button type="button" className="sheet-stop" onClick={closePlayer}>
                Stop and close player
              </button>
            </div>
          ) : (
            <div className="sheet-body queue">
              <div className="queue-label">Now playing</div>
              <div className="queue-row now">
                <span className="title">{current.title}</span>
                <span className="sub">{current.artist}</span>
              </div>
              <div className="queue-label">
                Up next{shuffle ? ' · shuffled' : ''} · {Math.max(0, queue.length - index - 1)} songs
              </div>
              {queue.slice(index + 1, index + 151).map((t, k) => {
                const j = index + 1 + k;
                return (
                  <div className="queue-row" key={`${t.id}-${j}`}>
                    <button type="button" className="queue-play" onClick={() => playAt(j)}>
                      <span className="title">{t.title}</span>
                      <span className="sub">{t.artist}</span>
                    </button>
                    <button type="button" className="ctrl" aria-label={`Remove ${t.title} from queue`} onClick={() => removeAt(j)}>
                      {icon(ICON.close)}
                    </button>
                  </div>
                );
              })}
              {queue.length - index - 1 > 150 && <p className="muted small">…and {queue.length - index - 151} more</p>}
            </div>
          )}
        </div>
      )}
    </PlayerContext.Provider>
  );
}
