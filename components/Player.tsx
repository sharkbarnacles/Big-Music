'use client';

import { SPIRAL } from '@/lib/icons';
import { PLAYER_ICONS, type PlayerIconName } from '@/lib/playerIcons';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';
import SafeBoundary from './SafeBoundary';
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

// A list that's bigger than what's on screen (the whole Library, an artist…):
// the player fetches more songs from /api/library/tracks as it goes.
export type QueueSource = { query: string; total: number };
type PlayOptions = { shuffle?: boolean; noShuffle?: boolean; video?: boolean; source?: QueueSource; radio?: RadioOpts };
// A radio (YouTube Music "radio" from any song): more songs are fetched as you go.
type RadioOpts = { continuation: string | null; mode: RadioMode; editionId?: string | null };
export type RadioMode = 'familiar' | 'mixed' | 'new';
export const RADIO_MODE_KEY = 'mh-radio-mode';
export function readRadioMode(): RadioMode {
  try {
    const v = localStorage.getItem(RADIO_MODE_KEY);
    if (v === 'familiar' || v === 'mixed' || v === 'new') return v;
  } catch {
    /* private browsing */
  }
  return 'mixed';
}
type SourceState = QueueSource & { seed: string | null; next: number; loading: boolean };

type PlayerApi = {
  current: TrackRowData | null;
  youtubeMode: boolean;
  setYoutubeMode: (on: boolean) => void;
  playList: (list: TrackRowData[], start: number, opts?: PlayOptions) => void;
  playNext: (track: TrackRowData) => void;
  addToQueue: (track: TrackRowData) => void;
  startRadio: (track: TrackRowData) => void;
};

const PlayerContext = createContext<PlayerApi>({
  current: null,
  youtubeMode: false,
  setYoutubeMode: () => {},
  playList: () => {},
  playNext: () => {},
  startRadio: () => {},
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

const newSeed = () => Math.random().toString(36).slice(2, 10);

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
  const [moreOpen, setMoreOpen] = useState(false); // the ⋯ menu on Now Playing
  const [kept, setKept] = useState(false); // the star: is this song in Discoveries?
  const [radioEdition, setRadioEdition] = useState<string | null>(null); // the saved radio playing now

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
  const srcRef = useRef<SourceState | null>(null); // where more songs come from, if anywhere
  const radioRef = useRef<(RadioOpts & { loading: boolean }) | null>(null); // a running radio
  const [srcLeft, setSrcLeft] = useState(0); // songs not fetched yet (for "Up next")

  const hostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytPendingRef = useRef<{ id: string; start: number } | null>(null);
  const sdkPlayerRef = useRef<any>(null);
  const sdkDeviceRef = useRef<string | null>(null);

  const current = index >= 0 ? queue[index] ?? null : null;

  // Count a play once you've listened to a song for 30 seconds (each time it
  // comes up in the queue). Plays make the monthly Discover mixes.
  const countedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !playing || progress < 30_000) return;
    const key = `${index}:${current.id}`;
    if (countedRef.current === key) return;
    countedRef.current = key;
    fetch('/api/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: current.id, service: engine === 'spotify' ? 'spotify' : 'youtube' }),
    }).catch(() => {});
  }, [current, playing, progress, index, engine]);
  const pickPlaylist = usePlaylistPicker();

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
      if (!res.ok && data.error === 'no_device') {
        // Spotify is asleep: wake it up for you and let the server start the music.
        wakeSpotify(token, { ids, positionMs, deviceId: sdkDeviceRef.current, repeatOne: repeatRef.current === 'one' });
        return;
      }
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

  // Opens the Spotify app (that's what wakes it up on a phone) and asks the
  // server to start the music as soon as Spotify appears. The request is sent
  // with keepalive, so it finishes even if the hub goes into the background,
  // and the songs keep playing in Spotify with the phone locked.
  const wakeSpotify = (token: number, body: Record<string, unknown>) => {
    setBusy(true);
    setNotice({
      text: 'Waking Spotify… your music starts in a few seconds. You can lock your phone.',
      link: { href: 'spotify:', label: 'Open Spotify' },
    });
    fetch('/api/play/spotify', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, wait: true }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (token !== tokenRef.current) return;
        if (!ok) {
          setPlay(false);
          setNotice({
            text: d.message ?? 'Spotify didn’t wake up. Open the Spotify app, then press Play again.',
            action: { label: 'Use YouTube mode', run: () => setYoutubeMode(true) },
          });
          return;
        }
        setNotice(null);
        setDevice(d.device ?? null);
        setPlay(true);
        posRef.current = { ms: Number(body.positionMs) || 0, at: Date.now() };
        setTimeout(() => pollSpotify(), 1500);
      })
      .catch(() => {
        /* the hub was in the background; the next check catches up */
      })
      .finally(() => {
        if (token === tokenRef.current) setBusy(false);
      });
    // Opening Spotify is what makes it show up as a player.
    setTimeout(() => {
      window.location.href = 'spotify:';
    }, 150);
  };

  const startYouTube = (id: string, startMs: number) => {
    if (engineRef.current === 'spotify' && playingRef.current) spotifyAction('action=pause');
    runRef.current = null;
    setEng('youtube');
    setDevice(null);
    setPlay(true);
    wantPlayRef.current = true;
    playYouTube(id, startMs / 1000);
    watchYouTubeStart();
  };

  // ── Starting YouTube without an extra tap ──────────────────────────
  // iPhones only let a video start with sound right after a tap. The YouTube
  // player is therefore made as soon as the app opens (warmYouTube), so a tap
  // on Play reaches it straight away instead of after it has loaded. If a song
  // still doesn't start, the hub nudges it a few times, and when you come
  // back to the app it carries on where it was.
  const wantPlayRef = useRef(false); // you want music playing (not paused by you)
  const startWatchRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const ytState = (): number => {
    try {
      return ytPlayerRef.current?.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  };

  const watchYouTubeStart = () => {
    startWatchRef.current.forEach(clearTimeout);
    const token = tokenRef.current;
    const stillWaiting = () =>
      token === tokenRef.current && engineRef.current === 'youtube' && wantPlayRef.current && ![1, 3].includes(ytState());
    startWatchRef.current = [
      setTimeout(() => stillWaiting() && ytPlayerRef.current?.playVideo?.(), 1200),
      setTimeout(() => stillWaiting() && ytPlayerRef.current?.playVideo?.(), 2600),
      setTimeout(() => {
        if (!stillWaiting()) return;
        setPlay(false);
        setNotice({ text: 'Your iPhone wants one tap to start the sound: tap Play, or the picture above, once (only needed once after opening the app).' });
      }, 4500),
    ];
  };

  const warmYouTube = async () => {
    if (ytPlayerRef.current || ytPendingRef.current || !hostRef.current) return;
    const YT = await loadYouTubeApi();
    if (ytPlayerRef.current || ytPendingRef.current || !hostRef.current) return;
    ytPendingRef.current = { id: '', start: 0 };
    const target = document.createElement('div');
    hostRef.current.replaceChildren(target);
    new YT.Player(target, {
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: (e: any) => {
          ytPlayerRef.current = e.target;
          const latest = ytPendingRef.current;
          ytPendingRef.current = null;
          if (latest?.id) e.target.loadVideoById({ videoId: latest.id, startSeconds: latest.start });
        },
        onStateChange: (e: any) => api.current.onYouTubeState(e.data),
        onError: () => api.current.onYouTubeError(),
      },
    });
  };

  const playYouTube = async (id: string, start: number) => {
    // Already made: start right now, inside your tap (no waiting first).
    if (ytPlayerRef.current) {
      ytPlayerRef.current.loadVideoById({ videoId: id, startSeconds: start });
      return;
    }
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
      startWatchRef.current.forEach(clearTimeout);
      setNotice((n) => (n?.text.startsWith('Your iPhone wants one tap') ? null : n));
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
      if (playingRef.current) {
        wantPlayRef.current = false;
        ytPlayerRef.current?.pauseVideo?.();
      } else {
        wantPlayRef.current = true;
        setNotice(null);
        ytPlayerRef.current?.playVideo?.();
        watchYouTubeStart();
      }
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
    const src = srcRef.current;
    if (src) {
      // Big list: fetch the rest in the new order instead of shuffling what's loaded.
      shuffleRef.current = !shuffleRef.current;
      setShuffle(shuffleRef.current);
      if (shuffleRef.current) {
        srcRef.current = { ...src, seed: newSeed(), next: 0, loading: false };
        setQ(cur ? [cur] : [], cur ? 0 : -1);
      } else {
        const base = baseRef.current;
        const at = cur ? base.indexOf(cur) : -1;
        srcRef.current = { ...src, seed: null, next: at >= 0 ? base.length : 0, loading: false };
        setQ(at >= 0 ? base : cur ? [cur] : [], at >= 0 ? at : cur ? 0 : -1);
      }
      setSrcLeft(srcRef.current.total - srcRef.current.next);
      loadMore();
      resyncSpotify();
      return;
    }
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
    const src = opts.source && opts.source.total > list.length ? opts.source : null;
    srcRef.current = null;
    radioRef.current = opts.radio ? { ...opts.radio, loading: false } : null;
    if (!opts.radio) setRadioEdition(null);
    if (src && shuffleRef.current) {
      // Start right away with one song (tapped, or random from what's on
      // screen); the rest of the whole list follows in a shuffled order.
      const first = list[start >= 0 ? start : Math.floor(Math.random() * list.length)];
      srcRef.current = { ...src, seed: newSeed(), next: 0, loading: false };
      q = [first];
      i = 0;
    } else if (src) {
      srcRef.current = { ...src, seed: null, next: list.length, loading: false };
    } else if (shuffleRef.current) {
      const first = start >= 0 ? list[start] : null;
      const rest = first ? q.filter((_, j) => j !== start) : q;
      q = first ? [first, ...shuffled(rest)] : shuffled(rest);
      i = 0;
    }
    setQ(q, i);
    setSrcLeft(srcRef.current ? srcRef.current.total - srcRef.current.next : 0);
    playAt(i);
    loadMore();
  };

  // Fetches the next songs of a big list when fewer than 25 are left.
  const loadMore = async () => {
    if (radioRef.current) return loadMoreRadio();
    const src = srcRef.current;
    if (!src || src.loading || src.next >= src.total) return;
    if (queueRef.current.length - indexRef.current > 25) return;
    src.loading = true;
    try {
      const url = `/api/library/tracks?${src.query}&offset=${src.next}&limit=200${src.seed ? `&seed=${src.seed}` : ''}`;
      const res = await fetch(url);
      const body = await res.json();
      if (srcRef.current !== src) return; // something else started playing
      const got: TrackRowData[] = body.tracks ?? [];
      src.next = got.length ? src.next + got.length : src.total;
      if (typeof body.total === 'number') src.total = body.total;
      const have = new Set(queueRef.current.map((t) => t.id));
      const fresh = got.filter((t) => !have.has(t.id));
      if (!src.seed) baseRef.current = [...baseRef.current, ...got];
      setQ([...queueRef.current, ...fresh], indexRef.current);
      setSrcLeft(src.total - src.next);
    } catch {
      /* try again on the next song */
    } finally {
      src.loading = false;
    }
  };

  // A radio keeps going: when fewer than 10 songs are left, ask for more.
  const loadMoreRadio = async () => {
    const radio = radioRef.current;
    if (!radio || radio.loading || !radio.continuation) return;
    if (queueRef.current.length - indexRef.current > 10) return;
    radio.loading = true;
    try {
      const res = await fetch(
        `/api/radio?continuation=${encodeURIComponent(radio.continuation)}&mode=${radio.mode}${radio.editionId ? `&editionId=${radio.editionId}` : ''}`,
      );
      const body = await res.json();
      if (radioRef.current !== radio) return; // something else started playing
      radio.continuation = body.continuation ?? null;
      const have = new Set(queueRef.current.map((t) => t.id));
      const fresh: TrackRowData[] = (body.tracks ?? []).filter((t: TrackRowData) => !have.has(t.id));
      if (fresh.length) {
        baseRef.current = [...baseRef.current, ...fresh];
        setQ([...queueRef.current, ...fresh], indexRef.current);
      }
    } catch {
      /* try again on the next song */
    } finally {
      radio.loading = false;
    }
  };

  // Starts a radio from any song: it plays first, then songs like it.
  const startRadio = async (track: TrackRowData) => {
    const videoId = track.yt_audio_id;
    if (!videoId) {
      showToast('This song has no YouTube version yet, so a radio can’t start from it.');
      return;
    }
    const mode = readRadioMode();
    showToast(`Starting a radio from “${track.title}”…`);
    try {
      const seed = new URLSearchParams({
        videoId,
        mode,
        seedTitle: track.title,
        seedArtist: track.artist,
        seedImage: track.image_url ?? '',
        seedId: /^[0-9a-f-]{36}$/i.test(track.id) ? track.id : '',
      });
      const res = await fetch(`/api/radio?${seed.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Radio failed');
      const rest: TrackRowData[] = (body.tracks ?? []).filter((t: TrackRowData) => t.yt_audio_id !== videoId && t.id !== track.id);
      playList([track, ...rest], 0, { noShuffle: true, radio: { continuation: body.continuation ?? null, mode, editionId: body.editionId ?? null } });
      setRadioEdition(body.editionId ?? null);
    } catch (err) {
      showToast((err as Error).message || 'The radio couldn’t start. Try again in a moment.');
    }
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

  // The star: keep this song in your "Discoveries" playlist (any song, Discover or not).
  useEffect(() => {
    setKept(false);
    setMoreOpen(false);
    if (!current || !sheetOpen) return;
    let alive = true;
    fetch(`/api/keep?trackId=${encodeURIComponent(current.id)}`)
      .then((r) => r.json())
      .then((d) => alive && setKept(Boolean(d.kept)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current?.id, sheetOpen]);

  const toggleKeep = async () => {
    if (!current) return;
    const want = !kept;
    setKept(want);
    try {
      const res = await fetch('/api/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: current.id, on: want }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save');
      showToast(want ? 'Kept in Discoveries' : 'Removed from Discoveries');
    } catch (err) {
      setKept(!want);
      showToast((err as Error).message || 'Could not save');
    }
  };

  // Turns a saved radio (or any Discover edition) into one of your hub playlists.
  const saveEditionAsPlaylist = async (editionId: string) => {
    showToast('Saving as a playlist…');
    try {
      const res = await fetch('/api/discover/save-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save');
      showToast(`Saved as “${d.name}”`);
    } catch (err) {
      showToast((err as Error).message || 'Could not save');
    }
  };

  const closePlayer = () => {
    tokenRef.current++;
    wantPlayRef.current = false;
    radioRef.current = null;
    setRadioEdition(null);
    startWatchRef.current.forEach(clearTimeout);
    if (engineRef.current === 'youtube') ytPlayerRef.current?.pauseVideo?.();
    if (engineRef.current === 'spotify' && playingRef.current) spotifyAction('action=pause');
    runRef.current = null;
    setEng(null);
    setPlay(false);
    setNotice(null);
    setSheetOpen(false);
    srcRef.current = null;
    setSrcLeft(0);
    setQ([], -1);
  };

  // Lets YouTube's callbacks reach the latest versions of these functions.
  const api = useRef({ onYouTubeState, onYouTubeError });
  api.current = { onYouTubeState, onYouTubeError };
  const pollRef = useRef(pollSpotify);
  pollRef.current = pollSpotify;

  // ── Background work ─────────────────────────────────────────────────

  // Remember the YouTube mode switch; load YouTube's library early.
  // Keep big lists topped up as songs go by.
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    try {
      // On unless you've switched it off on this device.
      const on = localStorage.getItem(YT_MODE_KEY) !== '0';
      ytModeRef.current = on;
      setYoutubeModeState(on);
    } catch {
      /* ignore */
    }
    // Make the YouTube player now, so the first Play tap starts the sound.
    warmYouTube().catch(() => {});
  }, []);

  // Coming back to the app: if iPhone paused your music while you were away, carry on.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (engineRef.current === 'youtube' && wantPlayRef.current && ![1, 3].includes(ytState())) {
        ytPlayerRef.current?.playVideo?.();
        watchYouTubeStart();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
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
          // Same box as .sheet-art: a big square cover (a wide box for music videos).
          width: video ? 'min(calc(100vw - 44px), 520px)' : 'var(--np-art)',
          aspectRatio: video ? '16 / 9' : '1 / 1',
          zIndex: 41,
          borderRadius: 14,
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

  // The owner's chosen player icons (lib/playerIcons.ts, from the Player Icon Lab).
  const picon = (name: PlayerIconName, cls = '') => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`picon ${cls}`} dangerouslySetInnerHTML={{ __html: PLAYER_ICONS[name] }} />
  );

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
    plus: 'M12 5v14M5 12h14',
    radio: 'M4 12a8 8 0 0 1 16 0M7.5 12a4.5 4.5 0 0 1 9 0M12 12v8',
    shuffle: SPIRAL,
    repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    down: 'M6 9l6 6 6-6',
    queue: 'M3 6h13M3 12h13M3 18h9M17 15l5 3-5 3z',
    video: 'M3 5h18v14H3zM10 9l5 3-5 3z',
    close: 'M6 6l12 12M18 6L6 18',
  };

  return (
    <PlayerContext.Provider value={{ current, youtubeMode, setYoutubeMode, playList, playNext, addToQueue, startRadio }}>
      {children}

      {/* Space so the bar never covers the end of a list. */}
      {current && <div aria-hidden="true" style={{ height: BAR_HEIGHT + 24 + (video && ytActive ? 240 : 0) }} />}

      <div ref={hostRef} className={`yt-host${ytActive && sheetOpen && !queueOpen && !video ? ' square' : ''}`} style={hostStyle} />

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

      <SafeBoundary onReset={() => setSheetOpen(false)}>
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
            <div className="sheet-body np">
              {/* A soft wash of the cover's colors behind the top of the screen. */}
              {current.image_url && <div className="np-wash" aria-hidden="true" style={{ backgroundImage: `url("${current.image_url}")` }} />}
              <div className={`sheet-art np-art${ytActive && video ? ' wide' : ''}${ytActive ? ' yt' : ''}`}>
                {!ytActive && current.image_url && <img src={current.image_url} alt="" />}
              </div>

              <div className="np-title">
                <div className="np-text">
                  <div className="sheet-title">{current.title}</div>
                  <div className="sheet-artist">{current.artist}</div>
                </div>
                <button type="button" className={`np-icon keep${kept ? ' on' : ''}`} aria-pressed={kept} aria-label={kept ? 'Remove from Discoveries' : 'Keep in Discoveries'} onClick={toggleKeep}>
                  {picon(kept ? 'kept' : 'keep')}
                </button>
                <button type="button" className="np-icon" aria-label="More options" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
                  {picon('more')}
                </button>
                {moreOpen && (
                  <>
                    <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
                    <div className="row-menu np-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); pickPlaylist([current]); }}>Add to playlist…</button>
                      {current.yt_audio_id && (
                        <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); startRadio(current); }}>Start radio</button>
                      )}
                      {radioEdition && (
                        <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); saveEditionAsPlaylist(radioEdition); }}>Save this radio as a playlist</button>
                      )}
                      <label className="switch np-switch" role="menuitemcheckbox" aria-checked={youtubeMode}>
                        <span>YouTube mode</span>
                        <input type="checkbox" checked={youtubeMode} onChange={(e) => setYoutubeMode(e.target.checked)} />
                        <span className="track" aria-hidden="true" />
                      </label>
                      <button type="button" role="menuitem" className="danger-item" onClick={() => { setMoreOpen(false); closePlayer(); }}>Stop and close player</button>
                    </div>
                  </>
                )}
              </div>

              <div className="sheet-progress np-progress">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(duration))}
                  value={Math.floor(Math.min(progress, duration || progress))}
                  aria-label="Position in song"
                  style={{ ['--pct' as string]: `${pct}%` } as React.CSSProperties}
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

              <div className="sheet-controls np-controls">
                <button type="button" className={`np-side shuf${shuffle ? ' on' : ''}`} aria-label="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}>
                  {icon(ICON.shuffle)}
                </button>
                <button type="button" className="np-skip" aria-label="Previous" onClick={prev}>
                  {picon('prev')}
                </button>
                <button type="button" className="np-play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                  {playing ? icon(ICON.pause) : icon(ICON.play, true)}
                </button>
                <button type="button" className="np-skip" aria-label="Next" onClick={next}>
                  {picon('next')}
                </button>
                <button type="button" className={`np-side rep${repeat !== 'off' ? ' on' : ''}`} aria-label={`Repeat: ${repeat}`} onClick={cycleRepeat}>
                  {picon('repeat')}
                  {repeat === 'one' && <span className="repeat-one">1</span>}
                </button>
              </div>

              <div className="np-row">
                <button type="button" className="np-icon" aria-label="Add to playlist" title="Add to playlist" onClick={() => pickPlaylist([current])}>
                  {picon('plus', 'row-plus')}
                </button>
                <button type="button" className="np-icon" aria-label="Start radio" title="Start radio" disabled={!current.yt_audio_id} onClick={() => startRadio(current)}>
                  {picon('radio', 'row-radio')}
                </button>
                <button type="button" className={`np-icon${video ? ' on' : ''}`} aria-label={video ? 'Stop watching video' : 'Watch music video'} title="Music video" aria-pressed={video} disabled={!current.video_id} onClick={toggleVideo}>
                  {picon('video', 'row-video')}
                </button>
                <button type="button" className="np-icon" aria-label="Show queue" title="Queue" onClick={() => setQueueOpen(true)}>
                  {picon('queue', 'row-queue')}
                </button>
              </div>

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
              {toast && (
                <div className="np-toast" role="status">
                  {toast}
                </div>
              )}
              <p className="sheet-device np-device">
                {engine === 'spotify'
                  ? `Spotify${device ? ` · ${device}` : ''} · keeps going with the screen locked`
                  : 'YouTube · in the hub'}
              </p>
            </div>
          ) : (
            <div className="sheet-body queue">
              <div className="queue-label">Now playing</div>
              <div className="queue-row now">
                <span className="title">{current.title}</span>
                <span className="sub">{current.artist}</span>
              </div>
              <div className="queue-label">
                Up next{shuffle ? ' · shuffled' : ''} · {Math.max(0, queue.length - index - 1 + srcLeft).toLocaleString()} songs
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
              {queue.length - index - 1 + srcLeft > 150 && (
                <p className="muted small">…and {(queue.length - index - 151 + srcLeft).toLocaleString()} more</p>
              )}
            </div>
          )}
        </div>
      )}
      </SafeBoundary>
    </PlayerContext.Provider>
  );
}
