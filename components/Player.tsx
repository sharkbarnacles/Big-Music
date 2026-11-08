'use client';

import { SPIRAL } from '@/lib/icons';
import { PLAYER_ICONS, type PlayerIconName } from '@/lib/playerIcons';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';
import QueueList from './QueueList';
import SafeBoundary from './SafeBoundary';
import { clientLog } from '@/lib/clientLog';
import { sourceId, sourceUrl, type TrackRowData } from '@/lib/tracks';
import { smallCover } from '@/lib/img';
import { splitTitle } from '@/lib/titles';

// A song name boiled down for matching: no "(feat. …)", "- Remastered", case or punctuation.
const simpleName = (t: string) =>
  splitTitle(t)
    .title.toLowerCase()
    .replace(/\s*[-–]\s*(remaster|live|single|radio|version|mono|stereo).*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

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
// from: where the music is playing from ("Daily discover", a playlist name…), shown as "PLAYING FROM".
type PlayOptions = { shuffle?: boolean; noShuffle?: boolean; video?: boolean; source?: QueueSource; radio?: RadioOpts; from?: string };

// "A, B & C feat. D" → ["A", "B", "C", "D"] (for tapping the artist name).
export function splitArtists(artist: string): string[] {
  return [...new Set(artist.split(/\s*(?:,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+with\s+)\s*/i).map((a) => a.trim()).filter(Boolean))];
}

// Default "playing from" label: the page's title (a playlist, an edition, an artist…).
function pageTitle(): string {
  try {
    const h = document.querySelector('main h1');
    const t = h?.textContent?.trim();
    if (t) return t;
  } catch {
    /* not in a browser */
  }
  return 'your library';
}
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
  startRadio: (track: TrackRowData, label?: string) => void;
  startPromptRadio: (words: string) => Promise<void>;
  startPlaylistRadio: (playlistId: string, name: string) => Promise<void>;
};

const PlayerContext = createContext<PlayerApi>({
  current: null,
  youtubeMode: false,
  setYoutubeMode: () => {},
  playList: () => {},
  playNext: () => {},
  startRadio: () => {},
  startPromptRadio: async () => {},
  startPlaylistRadio: async () => {},
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
  const [, setVersionTick] = useState(0); // redraw when a song's other version turns up
  const historyRef = useRef<TrackRowData[]>([]); // songs you were on before, newest last (for Back)
  const ytIdRef = useRef<string | null>(null); // the YouTube video loaded right now
  const versionsAskedRef = useRef(new Set<string>()); // songs already asked about
  // Spotify versions found for songs that came from YouTube (song id → Spotify id, null = not on Spotify).
  const spotifyMatchRef = useRef(new Map<string, string | null>());

  // Crash log. Errors anywhere in the app are noted, and so is a restart that
  // happens while music was playing: iOS shutting the home-screen app down
  // (usually for memory) looks exactly like that.
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem('mh-alive') || 'null');
      if (last?.playing && Date.now() - last.at < 90_000) {
        const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
        clientLog('restart-while-playing', `was on ${last.page}`, { secondsAgo: Math.round((Date.now() - last.at) / 1000), nav, song: last.song, sheet: last.sheet, images: last.images });
      }
    } catch {
      /* private browsing */
    }
    const onError = (e: ErrorEvent) => clientLog('error', `${e.message} @ ${e.filename}:${e.lineno}`, { stack: String(e.error?.stack ?? '').slice(0, 1500) });
    const onRejection = (e: PromiseRejectionEvent) => clientLog('rejection', String(e.reason?.stack ?? e.reason).slice(0, 1500));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const onHide = () => document.visibilityState === 'hidden' && savePlayer();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', savePlayer);
    restorePlayer();
    // Every few seconds: am I playing, and where? (read on the next start)
    const beat = window.setInterval(() => {
      try {
        const t = queueRef.current[indexRef.current];
        localStorage.setItem(
          'mh-alive',
          JSON.stringify({
            at: Date.now(),
            playing: playingRef.current,
            page: location.pathname + location.search,
            song: t ? `${t.title} — ${t.artist}` : null,
            sheet: Boolean(document.querySelector('.sheet')),
            images: document.images.length,
          }),
        );
        savePlayer();
      } catch {
        /* private browsing */
      }
    }, 5000);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', savePlayer);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(0);
  durationRef.current = duration;
  const [device, setDevice] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const router = useRouter();
  const [artistMenu, setArtistMenu] = useState<string[] | null>(null);
  const [fromLabel, setFromLabel] = useState('');
  // Songs you added with Play next / Add to queue ("Next up · added by you" in the queue).
  const addedRef = useRef(new WeakSet<TrackRowData>());
  const sheetRef = useRef<HTMLDivElement>(null);
  const upnextRef = useRef<HTMLDivElement>(null);
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
  // The Spotify line-up: `ids` the songs it should play in order, `sent` how many
  // of them Spotify has been given so far (10 at a time; more get added while the hub is open).
  const runRef = useRef<{ ids: string[]; idx: number[]; sent: number; topping?: boolean; list?: boolean; ctx?: number } | null>(null);
  // Songs the hub added to Spotify's queue (to keep a list going) that may not
  // have played yet. Spotify keeps its queue across new starts, so the next
  // start clears them first (server way) or they'd play after its first song.
  const extrasPendingRef = useRef(false);
  const extendingRef = useRef(false); // adding songs to Spotify's queue right now
  const matchingAheadRef = useRef(false); // looking up Spotify versions in the background
  const skipToldRef = useRef(false); // "songs not on Spotify are skipped" said once
  const skipLeftoverAtRef = useRef(0);
  // When the current line-up started, and a stranger song seen since when:
  // right after a start Spotify still reports the old song for a moment.
  const runStartedAtRef = useRef(0);
  const expectPosRef = useRef(0);
  const strangerRef = useRef<{ key: string; since: number } | null>(null);
  const startingRef = useRef(false); // a Spotify start is on its way (screen shows loading)
  const sdkLiveRef = useRef(false); // the hub's own Spotify player is the one playing
  const userPausedRef = useRef(false); // you pressed pause (so a stop isn't "the song ended")
  const sdkLastRef = useRef<{ playing: boolean; pos: number; dur: number; id: string | null; at: number }>({ playing: false, pos: 0, dur: 0, id: null, at: 0 });
  // Watchdog for the in-hub Spotify player: where it was and since when.
  const startInFlightRef = useRef(false);
  const startedByRef = useRef<'tap' | 'next' | 'auto'>('tap');
  const spotifyTokenRef = useRef<{ token: string; at: number } | null>(null);
  const forceServerRef = useRef(false);
  const queueCheckedRef = useRef(false);
  const getSpotifyTokenRef = useRef<(fresh?: boolean) => Promise<string | null>>(async () => null);
  const ensureSdkRef = useRef<(hard?: boolean) => Promise<string | null>>(async () => null);
  const directSettingsRef = useRef(false);
  const directLogRef = useRef(0);
  const touchedAtRef = useRef(0);
  const pendingStartRef = useRef<{ i: number; token: number; positionMs: number } | null>(null);
  const claimedIdRef = useRef<string | null>(null);
  const stallRef = useRef<{ pos: number; id: string | null; since: number; tries: number } | null>(null);
  const sdkStateRef = useRef<(st: any) => void>(() => {});
  const keepAwakeRef = useRef<(on: boolean) => void>(() => {});
  const keepAliveUnlockedRef = useRef(false);
  const lockButtonsRef = useRef<() => void>(() => {});
  const keepPoolRef = useRef<HTMLAudioElement[]>([]);
  const keepActiveRef = useRef(0);
  const unlockKeepRef = useRef<() => void>(() => {});
  const claimLogRef = useRef(0);
  const asleepToldRef = useRef(false); // told you once that Spotify is asleep
  const wakeRef = useRef<{ token: number; body: Record<string, unknown>; retried: boolean } | null>(null); // a wake-up still waiting
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
  const sdkReadyRef = useRef(false); // Spotify's player script has loaded
  const sdkWaitRef = useRef<Promise<string | null> | null>(null); // resolves when the in-hub player is ready
  const makeSdkPlayerRef = useRef<() => void>(() => {});

  const current = index >= 0 ? queue[index] ?? null : null;
  // Mirrors for the background saver (it runs outside renders).
  const progressNowRef = useRef(0);
  progressNowRef.current = engine === 'spotify' && playing ? posRef.current.ms + (Date.now() - posRef.current.at) : progress;
  const fromNowRef = useRef('');
  fromNowRef.current = fromLabel;
  const restoredRef = useRef(false); // the queue came back after the app restarted; Play resumes it

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

  // Pin the page behind Now Playing while it's open, so only one thing
  // scrolls (iPhones otherwise hand a swipe to the page underneath).
  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    const y = window.scrollY;
    root.style.setProperty('--page-y', `${-y}px`);
    root.classList.add('sheet-open');
    return () => {
      root.classList.remove('sheet-open');
      root.style.removeProperty('--page-y');
      window.scrollTo(0, y);
    };
  }, [sheetOpen]);

  // ── Surviving a restart ──────────────────────────────────────────────
  // The app can restart on its own: after an update is published, the first
  // page change loads the new version, and iOS sometimes shuts home-screen
  // apps down. The queue, the song and the spot in it are saved every few
  // seconds, and come back after a restart, paused; one tap on Play carries on.
  const PLAYER_KEY = 'mh-player';
  const savePlayer = () => {
    try {
      const q = queueRef.current;
      const i = indexRef.current;
      if (!q.length || i < 0) return;
      const start = Math.max(0, i - 50);
      localStorage.setItem(
        PLAYER_KEY,
        JSON.stringify({
          at: Date.now(),
          queue: q.slice(start, i + 250),
          index: i - start,
          positionMs: Math.max(0, Math.floor(progressNowRef.current)),
          from: fromNowRef.current,
          video: videoRef.current,
        }),
      );
    } catch {
      /* storage full or private browsing */
    }
  };
  const restorePlayer = () => {
    if (indexRef.current >= 0) return; // something is already playing
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
      if (!saved?.queue?.length || Date.now() - saved.at > 12 * 3600_000) return;
      const i = Math.min(Math.max(0, saved.index ?? 0), saved.queue.length - 1);
      baseRef.current = saved.queue.slice();
      setQ(saved.queue, i);
      setProgress(saved.positionMs ?? 0);
      setDuration(saved.queue[i]?.duration_ms ?? 0);
      setFromLabel(saved.from || '');
      videoRef.current = Boolean(saved.video);
      setVideo(videoRef.current);
      restoredRef.current = true;
    } catch {
      /* nothing saved */
    }
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
  // Every tap on a play control. On iPhones (Nov 2026 experiment, owner's
  // wish: Spotify without the Spotify app) the in-hub Spotify player is made
  // here, inside the tap, because iPhones only let it make sound after one.
  const gesture = () => {
    if (!sdkPlayerRef.current && sdkReadyRef.current && !ytModeRef.current) makeSdkPlayerRef.current();
    sdkPlayerRef.current?.activateElement?.();
    // Unlock the silent keep-awake sound now (iPhones only allow it from a tap).
    // Both modes: YouTube mode uses it too, so the hub stays awake to start
    // the next song with the screen off.
    if (isPhone() && !keepAliveUnlockedRef.current) {
      keepAliveUnlockedRef.current = true;
      unlockKeepRef.current();
    }
  };

  const currentProgress = () =>
    engineRef.current === 'spotify' && playingRef.current
      ? posRef.current.ms + (Date.now() - posRef.current.at)
      : progress;

  // ── Choosing how to play a song ──────────────────────────────────────

  const decide = (track: TrackRowData, wantVideo: boolean): Choice => {
    if (wantVideo && track.video_id) return { engine: 'youtube', id: track.video_id };
    const spotify = sourceId(track, 'spotify') ?? spotifyMatchRef.current.get(track.id) ?? null;
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

  // Spotify mode: find Spotify versions of the coming songs that only came
  // from YouTube (YouTube playlists, discoveries, radios), so Spotify gets the
  // whole line-up and keeps playing with the phone locked. Each song is looked
  // up once (the server remembers); this waits at most a few seconds.
  const findSpotifyVersions = async (from: number, count = 40) => {
    const want = queueRef.current
      .slice(from, from + count)
      .filter((t) => !sourceId(t, 'spotify') && !spotifyMatchRef.current.has(t.id));
    if (!want.length) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('/api/spotify/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs: want.map((t) => ({ key: t.id, title: t.title, artist: t.artist })) }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      for (const [k, v] of Object.entries((data.matches ?? {}) as Record<string, string | null>)) spotifyMatchRef.current.set(k, v);
    } catch {
      /* play what we can; the rest plays through YouTube while the hub is open */
    }
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

  const playAt = async (i: number, opts: { positionMs?: number; skips?: number; back?: boolean; reason?: 'tap' | 'next' | 'auto' } = {}) => {
    const track = queueRef.current[i];
    if (!track) return;
    restoredRef.current = false;
    draggingRef.current = false; // a new song never starts with a frozen time bar
    // Remember the song you're leaving, so Back returns to it even after jumping ahead.
    const leaving = queueRef.current[indexRef.current];
    if (!opts.back && leaving && leaving !== track && !opts.skips) {
      historyRef.current.push(leaving);
      if (historyRef.current.length > 200) historyRef.current.shift();
    }
    // How this song came on: picked by you ('tap', which includes peeking at
    // songs in the queue), Next pressed, or the music moving on by itself.
    // Only Next on a song you didn't pick counts as a skip (reportSkip).
    if (opts.reason) startedByRef.current = opts.reason;
    else if (i !== indexRef.current) startedByRef.current = 'tap';
    const token = ++tokenRef.current;
    // Spotify mode: from this moment the old song's reports must not pull the
    // screen back or start anything (the version lookup below can take ~1 s).
    if (!ytModeRef.current && !videoRef.current) startingRef.current = true;
    setI(i);
    setNotice(null);
    setProgress(opts.positionMs ?? 0);
    setDuration(track.duration_ms ?? 0);

    if (!ytModeRef.current && !videoRef.current) {
      // Spotify versions of YouTube-only songs: wait for this song's (one
      // quick search), give the following ones 1.2 s, and let the rest
      // finish in the background (owner: taps felt slow on radios).
      setBusy(true);
      if (!sourceId(track, 'spotify') && !spotifyMatchRef.current.has(track.id)) await findSpotifyVersions(i, 1);
      // A short wait for the next songs' versions (usually remembered by the
      // server); anything still unknown is added to Spotify's line-up later,
      // in order, while the music plays (extendSpotify).
      await Promise.race([findSpotifyVersions(i + 1), new Promise((r) => setTimeout(r, 700))]);
      if (token !== tokenRef.current) return;
      // Spotify mode, the music moving on by itself: a song Spotify doesn't
      // have is skipped. Switching to YouTube without a tap is what paused the
      // music (iPhones only let a new player start after a tap).
      if (opts.reason === 'auto' && decide(track, false).engine !== 'spotify') {
        startingRef.current = false;
        setBusy(false);
        const skips = (opts.skips ?? 0) + 1;
        const n = nextIndex(i);
        clientLog('spotify', 'not on Spotify, skipped', { song: track.title });
        if (n !== null && skips < 40) playAt(n, { reason: 'auto', skips });
        else setPlay(false);
        return;
      }
      // busy stays on: the Spotify start right after keeps the spinner going.
    }
    let choice = decide(track, videoRef.current);
    if (choice.engine === 'lookup') {
      setBusy(true);
      const id = await lookup(track);
      if (token !== tokenRef.current) return;
      setBusy(false);
      if (!id) {
        startingRef.current = false;
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
    else {
      setBusy(false);
      startingRef.current = false;
      startYouTube(choice.id, opts.positionMs ?? 0);
      findVersions(track, token);
    }
  };

  // YouTube Music pairs most songs' studio audio with their music video. If a
  // song only knows one of the two, ask once (in the background, so the song
  // starts straight away). The eye button then shows the video, and when a
  // music video was standing in for the song, the studio audio takes over
  // within the first few seconds.
  const findVersions = async (track: TrackRowData, token: number) => {
    if (track.video_id && track.yt_audio_id && track.video_id !== track.yt_audio_id) return;
    const key = track.id;
    if (versionsAskedRef.current.has(key)) return;
    versionsAskedRef.current.add(key);
    const playing = ytIdRef.current;
    if (!playing) return;
    try {
      const res = await fetch('/api/youtube/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: playing,
          trackId: /^[0-9a-f-]{36}$/i.test(track.id) ? track.id : undefined,
          title: track.title,
          artist: track.artist,
          // Titles like "… MV「…」", "(Official Video)" or "【PV】" are videos even when YouTube doesn't say so.
          looksLikeVideo: /\b(mv|m\/v|pv|official (music )?video|music video)\b|【[^】]*(mv|pv)[^】]*】/i.test(track.title),
        }),
      });
      const v = await res.json().catch(() => ({}));
      if (!v.audioId && !v.mvId) return;
      const wasVideo = v.mvId === playing;
      if (v.mvId && !track.video_id) track.video_id = v.mvId;
      if (v.audioId && (!track.yt_audio_id || track.yt_audio_id === v.mvId)) track.yt_audio_id = v.audioId;
      setVersionTick((n) => n + 1);
      if (token !== tokenRef.current || videoRef.current) return;
      if (wasVideo && v.audioId && v.audioId !== playing && currentProgress() < 8000) startYouTube(v.audioId, 0);
    } catch {
      /* keep playing what's playing */
    }
  };

  // Make sure the hub's own Spotify player is connected (owner 2026-11-05:
  // after a while away the hub said "wake Spotify" because the in-hub player
  // had dropped off Spotify's device list). Waits up to 8 s.
  const ensureSdkDevice = async (hard = false): Promise<string | null> => {
    if (hard) sdkDeviceRef.current = null;
    if (sdkDeviceRef.current) return sdkDeviceRef.current;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = Date.now() + 8000;
    while (!sdkReadyRef.current && Date.now() < until) await pause(200);
    let fresh = false;
    if (!sdkPlayerRef.current && sdkReadyRef.current) {
      makeSdkPlayerRef.current();
      fresh = true;
    }
    const p = sdkPlayerRef.current;
    if (!p) return null;
    if (!fresh) {
      // Spotify can forget the player while the app sleeps without the
      // player noticing, so a plain connect() may do nothing: hang up first.
      clientLog('spotify', 'reconnecting in-hub player', { hard });
      try {
        p.disconnect();
      } catch {
        /* ignore */
      }
      await pause(300);
      try {
        p.connect();
      } catch {
        /* ignore */
      }
    }
    while (!sdkDeviceRef.current && Date.now() < until) await pause(200);
    return sdkDeviceRef.current;
  };

  // Spotify access token for the phone's direct requests (from the hub's
  // server, which keeps it fresh); reused for 40 minutes.
  const getSpotifyToken = async (fresh = false): Promise<string | null> => {
    const c = spotifyTokenRef.current;
    if (!fresh && c && Date.now() - c.at < 40 * 60_000) return c.token;
    try {
      const d = await fetch('/api/spotify/token', { cache: 'no-store' }).then((r) => r.json());
      if (!d.token) return null;
      spotifyTokenRef.current = { token: d.token, at: Date.now() };
      return d.token;
    } catch {
      return null;
    }
  };
  // Plays the line-up on the hub's own player straight from the phone.
  const directPlay = async (ids: string[], positionMs: number, device: string): Promise<'ok' | 'gone' | 'fail'> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getSpotifyToken(attempt > 0);
      if (!t) return 'fail';
      const api = (path: string, init: RequestInit) =>
        fetch(`https://api.spotify.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
      const res = await api(`/me/player/play?device_id=${encodeURIComponent(device)}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: ids.map((id) => `spotify:track:${id}`), offset: { position: 0 }, position_ms: positionMs }),
      }).catch(() => null);
      if (!res) return 'fail';
      if (res.ok) {
        // Shuffle off (the hub orders the songs) and repeat as set, once.
        if (!directSettingsRef.current) {
          directSettingsRef.current = true;
          api(`/me/player/shuffle?state=false&device_id=${encodeURIComponent(device)}`, { method: 'PUT' }).catch(() => null);
          api(`/me/player/repeat?state=${repeatRef.current === 'one' ? 'track' : 'off'}&device_id=${encodeURIComponent(device)}`, { method: 'PUT' }).catch(() => null);
        }
        return 'ok';
      }
      // Spotify forgot the hub's player (the app slept): reconnect and retry.
      if (res.status === 404) return 'gone';
      if (res.status === 401 && attempt === 0) continue; // old token: get a fresh one and try again
      const reply = await res.text().catch(() => '');
      clientLog('spotify', 'direct play refused', { status: res.status, reply: reply.slice(0, 200) });
      return 'fail';
    }
    return 'fail';
  };
  getSpotifyTokenRef.current = getSpotifyToken;
  ensureSdkRef.current = ensureSdkDevice;

  // Lets the server know Spotify mode is playing (the library import waits
  // while you listen), at most every 10 minutes.
  const touchServer = () => {
    if (Date.now() - touchedAtRef.current < 10 * 60_000) return;
    touchedAtRef.current = Date.now();
    fetch('/api/play/spotify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touch: true }) }).catch(() => {});
  };

  // After a YouTube stand-in: reconnect the hub's Spotify player and, if the
  // song is still in its first 45 s, carry on with Spotify from that spot.
  const handBackToSpotify = async (i: number, token: number) => {
    const fresh = await ensureSdkDevice(true);
    if (!fresh || token !== tokenRef.current || indexRef.current !== i || ytModeRef.current) return;
    if (engineRef.current !== 'youtube' || !wantPlayRef.current) return;
    const at = currentProgress();
    if (at > 45_000) return;
    clientLog('spotify', 'player back, moving this song to Spotify', { atMs: Math.round(at) });
    playAt(i, { positionMs: at, back: true });
  };

  // A start that landed after you'd already moved to a YouTube song: silence
  // it, or two songs would play at once.
  const stopIfLeftBehind = () => {
    if (engineRef.current !== 'spotify') sdkPlayerRef.current?.pause?.().catch?.(() => {});
  };

  const startSpotify = async (i: number, token: number, positionMs: number): Promise<void> => {
    // One start at a time: quick skips while one is on its way just change
    // which song starts next (overlapping starts left Spotify confused).
    if (startInFlightRef.current) {
      pendingStartRef.current = { i, token, positionMs };
      startingRef.current = true;
      setBusy(true);
      return;
    }
    startInFlightRef.current = true;
    if (engineRef.current === 'youtube') ytPlayerRef.current?.pauseVideo?.();
    setEng('spotify');

    // Hand Spotify this song plus the following Spotify songs (up to 50),
    // so it keeps playing even while the phone is locked.
    const list = queueRef.current;
    const ids: string[] = [];
    const idx: number[] = [];
    // Songs Spotify doesn't have are skipped, so the music never stops
    // with the phone locked (the hub would need to be open to play them).
    // Stops at the first song not looked up yet: it's added later, in order
    // (extendSpotify), so Spotify never plays songs out of the hub's order.
    let skippedSome = false;
    for (let j = i; j < list.length && j < i + 150 && ids.length < 50; j++) {
      const t = list[j];
      if (j > i && !sourceId(t, 'spotify') && !spotifyMatchRef.current.has(t.id)) break;
      const c = decide(t, videoRef.current);
      if (c.engine !== 'spotify') {
        skippedSome = true;
        continue;
      }
      ids.push(c.id);
      idx.push(j);
    }
    if (skippedSome && !skipToldRef.current) {
      skipToldRef.current = true;
      showToast('Songs Spotify doesn’t have are skipped in Spotify mode. Tap one to hear it through YouTube.');
    }
    // Songs the hub queued in Spotify last time and that haven't played would
    // come before this list: the server way clears them first.
    if (extrasPendingRef.current && ids.length > 1) forceServerRef.current = true;
    extrasPendingRef.current = false;
    runRef.current = { ids, idx, sent: 0, ctx: ids.length }; // sent 0 = still starting (no top-ups yet)
    lastPlayedEndRef.current = false;
    // While it starts: the time stays where the song starts (it used to run
    // on from the previous song and show thousands of seconds), and the play
    // button shows a small spinner.
    startingRef.current = true;
    userPausedRef.current = false;
    posRef.current = { ms: positionMs, at: Date.now() };
    setProgress(positionMs);
    setDuration(list[i]?.duration_ms ?? 0);
    setPlay(false);
    setBusy(true);
    // The in-hub player was just made (first tap), or it dropped its link to
    // Spotify while the app was in the background: (re)connect and wait.
    if (!sdkDeviceRef.current) await ensureSdkDevice();
    try {
      // Fast path: the hub's own player is connected, so the phone asks
      // Spotify directly (one request, ~0.3 s) instead of going through the
      // hub's server (~1.5 s). The player's own updates confirm it; if the
      // song hasn't started 4 s later, the server way is used instead.
      const device = sdkDeviceRef.current;
      if (device && !forceServerRef.current) {
        const t0 = Date.now();
        let result = await directPlay(ids, positionMs, device);
        if (token !== tokenRef.current) return stopIfLeftBehind();
        if (result === 'gone') {
          const fresh = await ensureSdkDevice(true);
          if (token !== tokenRef.current) return stopIfLeftBehind();
          clientLog('spotify', fresh ? 'player was forgotten, reconnected' : 'player was forgotten, reconnect failed');
          if (fresh) result = await directPlay(ids, positionMs, fresh);
          if (token !== tokenRef.current) return stopIfLeftBehind();
        }
        if (result === 'ok') {
          if (runRef.current) {
            runRef.current.sent = ids.length;
            runRef.current.list = true;
          }
          setDevice('Music Hub (this browser)');
          sdkLiveRef.current = true;
          posRef.current = { ms: positionMs, at: Date.now() };
          runStartedAtRef.current = Date.now();
          expectPosRef.current = 0;
          setPlay(true);
          startingRef.current = false;
          keepAwake(true);
          claimLockScreen();
          touchServer();
          if (directLogRef.current++ < 5) clientLog('spotify', 'started directly', { songs: ids.length, ms: Date.now() - t0 });
          // Once per app opening: songs left in Spotify's own queue (from
          // older hand-offs or the Spotify app) would play before the list.
          // If there are any, the server clears them with one restart.
          if (!queueCheckedRef.current && ids.length > 1) {
            queueCheckedRef.current = true;
            setTimeout(async () => {
              if (token !== tokenRef.current || indexRef.current !== i) return;
              const t = await getSpotifyToken();
              if (!t) return;
              const q = await fetch('https://api.spotify.com/v1/me/player/queue', { headers: { Authorization: `Bearer ${t}` } })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
              if (!q || token !== tokenRef.current || indexRef.current !== i) return;
              const at = ((q.queue ?? []) as { id?: string }[]).findIndex((it) => it?.id === ids[1]);
              if (at > 0) {
                clientLog('spotify', 'old queue found, clearing via the server', { leftovers: at });
                forceServerRef.current = true;
                playAt(i, { positionMs: currentProgress(), back: true });
              }
            }, 1200);
          }
          const want = ids[0];
          setTimeout(async () => {
            if (token !== tokenRef.current || engineRef.current !== 'spotify' || indexRef.current !== i || userPausedRef.current) return;
            const st = await sdkPlayerRef.current?.getCurrentState?.().catch?.(() => null);
            if (token !== tokenRef.current || indexRef.current !== i) return;
            const cur = st?.track_window?.current_track;
            if (cur && (cur.id === want || cur.linked_from?.id === want)) return;
            const title = queueRef.current[i]?.title;
            if (cur?.name && title && simpleName(cur.name) === simpleName(title)) return;
            clientLog('spotify', 'direct start didn’t take, asking the server', { now: cur?.name ?? null });
            forceServerRef.current = true;
            playAt(i, { positionMs, back: true });
          }, 4000);
          return;
        }
      }
      forceServerRef.current = false;
      const res = await fetch('/api/play/spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          positionMs,
          deviceId: sdkDeviceRef.current,
          inHub: Boolean(sdkDeviceRef.current),
          repeatOne: repeatRef.current === 'one',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (token !== tokenRef.current) return stopIfLeftBehind();
      // Spotify asleep on this phone, or it said yes but stayed silent: the hub
      // never switches you to the Spotify app (owner's wish, 2026-11-05).
      // This song plays through YouTube instead, right here; the next song
      // tries Spotify again, so once Spotify is awake (playing in the
      // background, or opened once) it takes over by itself.
      const asleep = !res.ok && data.error === 'no_device';
      const silent = res.ok && data.confirmed === false;
      if (asleep || silent) {
        clientLog('spotify', asleep ? 'asleep, playing via YouTube' : 'silent, playing via YouTube', { song: list[i]?.title });
        const yt = list[i].yt_audio_id ?? sourceId(list[i], 'youtube') ?? list[i].video_id;
        if (silent) spotifyAction('action=pause').catch(() => null);
        if (yt) {
          // Say it once per visit, not on every song.
          if (!asleepToldRef.current) setNotice(
            isPhone()
              ? {
                  text: asleep
                    ? 'Spotify’s player in the hub didn’t connect in time, so this song plays through YouTube. The next song tries Spotify again.'
                    : 'Spotify didn’t start the song, so it plays through YouTube.',
                }
              : {
                  text: asleep
                    ? 'Spotify is asleep, so this plays through YouTube. Spotify takes over by itself once it’s awake.'
                    : 'Spotify didn’t start the song, so it plays through YouTube.',
                  link: { href: 'spotify:', label: 'Wake Spotify' },
                },
          );
          asleepToldRef.current = true;
          startYouTube(yt, positionMs);
          // Keep trying to bring the hub's Spotify player back in the
          // background; if it returns early in the song, Spotify takes over
          // where YouTube is (so the music carries on with the screen off).
          if (isPhone()) handBackToSpotify(i, token);
          return;
        }
        setPlay(false);
        setNotice({
          text: 'Spotify is asleep on this phone and this song has no YouTube version yet.',
          link: { href: 'spotify:', label: 'Wake Spotify' },
          action: { label: 'Use YouTube mode', run: () => setYoutubeMode(true) },
        });
        return;
      }
      if (!res.ok && data.error === 'rate_limited') {
        // Spotify has the app on a time-out: play this song through YouTube instead.
        const yt = list[i].yt_audio_id ?? sourceId(list[i], 'youtube') ?? list[i].video_id;
        showToast(data.message);
        if (yt) {
          startYouTube(yt, positionMs);
          return;
        }
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
      // In the hub's own player Spotify was given the whole line-up at once.
      if (runRef.current) {
        runRef.current.sent = data.mode === 'list' ? runRef.current.ids.length : 1 + (Number(data.queued) || 0);
        runRef.current.list = data.mode === 'list';
      }
      sdkLiveRef.current = Boolean(sdkDeviceRef.current && data.deviceId === sdkDeviceRef.current);
      posRef.current = { ms: positionMs, at: Date.now() };
      runStartedAtRef.current = Date.now();
      expectPosRef.current = 0;
      setPlay(true);
      startingRef.current = false;
      if (sdkLiveRef.current) {
        keepAwake(true);
        claimLockScreen();
      }
      setTimeout(() => pollSpotify(), 1500);
    } catch {
      if (token === tokenRef.current) {
        setPlay(false);
        setNotice({ text: 'Couldn’t reach your app. Check your connection.' });
      }
    } finally {
      if (token === tokenRef.current) startingRef.current = false;
      startInFlightRef.current = false;
      const pending = pendingStartRef.current;
      pendingStartRef.current = null;
      if (pending && pending.token === tokenRef.current) startSpotify(pending.i, pending.token, pending.positionMs);
      else if (token === tokenRef.current) setBusy(false);
    }
  };

  // Opens the Spotify app (that's what wakes it up on a phone) and asks the
  // server to start the music as soon as Spotify appears. The request is sent
  // with keepalive, so it finishes even if the hub goes into the background,
  // and the songs keep playing in Spotify with the phone locked.
  const wakeSpotify = (token: number, body: Record<string, unknown>) => {
    wakeRef.current = { token, body, retried: false };
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
        if (wakeRef.current?.token === token) wakeRef.current = null;
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
        if (runRef.current) runRef.current.sent = 1 + (Number(d.queued) || 0);
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

  // ── The hub's own Spotify player with the screen off ──
  // iPhones freeze a web app once its sound stops, so when one song ended the
  // next never started. A silent sound loops underneath while Spotify plays
  // in the hub, which keeps the hub awake to start the next song, and the
  // lock screen shows the song (Media Session) with working buttons.
  // The file is a minute long: iPhones only give the lock screen to sounds
  // that look like real music, not a 2-second blip.
  const SILENCE = '/silence.mp3'; // 60 s of silence (public/silence.mp3), looped
  // Two silent players take turns. fresh = start the other one and then
  // stop this one: a brand-new start makes the hub the newest sound on the
  // page, so the lock screen shows the hub's song card instead of Spotify's
  // blank "Spotify Embedded Player". Both are unlocked in the first tap
  // (iPhones only let a sound start after a tap).
  const keepPool = () => {
    if (!keepPoolRef.current.length) {
      for (let k = 0; k < 2; k++) {
        const a = new Audio(SILENCE);
        a.loop = true;
        a.preload = 'auto';
        a.setAttribute('playsinline', '');
        // Each time this silent sound starts, it becomes the lock screen's
        // "now playing" and iOS forgets the buttons: set them again right away.
        a.addEventListener('playing', () => {
          lockButtonsRef.current();
          setLockScreen(queueRef.current[indexRef.current] ?? null);
        });
        keepPoolRef.current.push(a);
      }
    }
    return keepPoolRef.current;
  };
  const keepAwake = (on: boolean, fresh = false) => {
    try {
      const pool = keepPool();
      const cur = pool[keepActiveRef.current];
      if (!on) {
        pool.forEach((a) => a.pause());
        return;
      }
      if (fresh && !cur.paused) {
        const other = pool[1 - keepActiveRef.current];
        other.currentTime = 0;
        other
          .play()
          .then(() => {
            cur.pause();
            keepActiveRef.current = 1 - keepActiveRef.current;
            if (claimLogRef.current++ < 12) clientLog(engineRef.current === 'youtube' ? 'youtube' : 'spotify', 'lock card claimed', { hidden: document.hidden });
          })
          .catch((e: Error) => {
            if (claimLogRef.current++ < 12) clientLog(engineRef.current === 'youtube' ? 'youtube' : 'spotify', 'lock card claim refused', { hidden: document.hidden, error: e?.name ?? String(e) });
          });
        return;
      }
      cur.play().catch(() => {});
    } catch {
      /* not allowed yet; the next tap starts it */
    }
  };
  // In the first tap: start both silent players (that unlocks them), then
  // stop the spare one (and both if the in-hub player isn't playing).
  const unlockKeepAwake = () => {
    try {
      const pool = keepPool();
      pool.forEach((a) => a.play().catch(() => {}));
      setTimeout(() => {
        pool[1 - keepActiveRef.current].pause();
        const ytWants = engineRef.current === 'youtube' && wantPlayRef.current;
        if (!sdkLiveRef.current && !ytWants) pool[keepActiveRef.current].pause();
      }, 300);
    } catch {
      /* ignore */
    }
  };

  keepAwakeRef.current = keepAwake;
  unlockKeepRef.current = unlockKeepAwake;

  // Lock screen / Control Center card: the hub's song, cover and buttons.
  const setLockScreen = (track: TrackRowData | null) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !track) return;
    try {
      const art = track.image_url;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: splitTitle(track.title).title || track.title,
        artist: track.artist,
        album: track.album ?? '',
        artwork: art
          ? [
              { src: art, sizes: '300x300', type: 'image/jpeg' },
              { src: art, sizes: '640x640', type: 'image/jpeg' },
            ]
          : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch {
      /* older iPhones */
    }
  };
  const setLockPosition = (posMs: number, durMs: number, playing: boolean) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      if (durMs > 0) navigator.mediaSession.setPositionState?.({ duration: durMs / 1000, position: Math.min(posMs, durMs) / 1000, playbackRate: 1 });
    } catch {
      /* ignore */
    }
  };
  // While the hub's own Spotify player plays: restart the silent sound just
  // after Spotify's so ours is the newest, then put our song card back.
  const claimRef = useRef<() => void>(() => {});
  const seekRef = useRef<(ms: number) => void>(() => {});
  // Once, 0.6 s after the hub itself starts a song or skips (not on Spotify's
  // own automatic song changes: claiming then made iOS flip between cards).
  const claimTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const claimLockScreen = () => {
    claimTimersRef.current.forEach(clearTimeout);
    claimTimersRef.current = [600].map((ms) =>
      setTimeout(() => {
        if (engineRef.current !== 'spotify' || !sdkLiveRef.current) return;
        keepAwake(true, true);
        setLockScreen(queueRef.current[indexRef.current] ?? null);
        setLockPosition(currentProgress(), durationRef.current, true);
      }, ms),
    );
  };

  // Every change in the hub's own Spotify player (play, pause, next song,
  // position). Also notices when a song ended and nothing followed, and
  // starts the next one itself.
  sdkStateRef.current = (st: any) => {
    if (!st || engineRef.current !== 'spotify' || !sdkLiveRef.current) return;
    const cur = st.track_window?.current_track;
    const ids = [cur?.id, cur?.linked_from?.id].filter(Boolean) as string[];
    const last = sdkLastRef.current;
    // The player only reports at changes (start, pause, new song), so work
    // out where the song had got to by now from the last report.
    const lastPos = last.pos + (last.playing ? Date.now() - last.at : 0);
    const ended =
      st.paused &&
      !userPausedRef.current &&
      last.playing &&
      last.dur > 0 &&
      lastPos > last.dur - 8000 &&
      (st.position === 0 || ids[0] !== last.id);
    sdkLastRef.current = { playing: !st.paused, pos: st.position ?? 0, dur: st.duration ?? 0, id: ids[0] ?? null, at: Date.now() };
    if (ended && (startingRef.current || Date.now() - runStartedAtRef.current < 5000)) return; // a new start is under way
    if (ended) {
      clientLog('spotify', 'song ended in the hub player, starting the next', { nextQueued: st.track_window?.next_tracks?.length ?? 0 });
      // Spotify moved on to the next song but stayed paused: just carry on.
      if (ids[0] && ids[0] !== last.id) {
        sdkPlayerRef.current?.resume?.().catch?.(() => {});
      } else {
        const n = nextIndex(indexRef.current);
        if (n !== null) {
          playAt(n, { reason: 'auto' });
          return;
        }
      }
    }
    applySpotify({ active: true, isPlaying: !st.paused || Boolean(ended), progressMs: st.position ?? 0, durationMs: st.duration ?? 0, trackIds: ids, trackName: cur?.name ?? null, deviceId: sdkDeviceRef.current });
    keepAwake(!st.paused || Boolean(ended));
    // A new song or playing again after a pause: Spotify's frame just took the
    // lock screen, so take it back for the hub's card.
    // The lock-screen card is claimed only when the hub itself starts or
    // skips (see claimLockScreen); claiming on every automatic song change
    // made iOS flip between two cards (owner, 2026-11-05).
  };

  // The in-hub player sometimes stops by itself (seen: it froze ~2 s before a
  // song's end and waited for a tap). Nudge it, a bit harder each time:
  // 1) resume, 2) near the end: skip to Spotify's next song, 3) start the
  // right song again from the hub (the next one if it was near the end).
  const nudgeSpotify = (st: any, why: string) => {
    const id = st.track_window?.current_track?.id ?? null;
    const pos = st.position ?? 0;
    const dur = st.duration ?? 0;
    const nearEnd = dur > 0 && pos > dur - 6000;
    const s = stallRef.current ?? { pos, id, since: Date.now(), tries: 0 };
    s.tries++;
    s.since = Date.now();
    stallRef.current = s;
    clientLog('spotify', `stuck (${why}), nudge ${s.tries}`, { pos, dur, paused: Boolean(st.paused), nearEnd, nextQueued: st.track_window?.next_tracks?.length ?? 0 });
    const p = sdkPlayerRef.current;
    keepAwake(true);
    if (s.tries === 1 && p) {
      p.resume?.().catch?.(() => {});
      return;
    }
    if (s.tries === 2 && p && nearEnd) {
      p.nextTrack?.().catch?.(() => {});
      return;
    }
    if (s.tries < 3 && !nearEnd) return; // give a plain resume one more go
    stallRef.current = null;
    // Stuck paused at the very start: the iPhone refused to start the sound
    // without a tap. Restarting the song (what this did before) was refused
    // too and replayed the same song over and over; now it waits for a tap.
    if (!nearEnd && st.paused && pos <= 1500) {
      clientLog('spotify', 'start refused by the phone, waiting for a tap', { hidden: document.hidden });
      userPausedRef.current = true; // the watchdog stops nudging; Play clears it
      setPlay(false);
      setNotice({ text: 'Your iPhone held back the start. Tap Play once to carry on.' });
      return;
    }
    const n = nearEnd ? nextIndex(indexRef.current) : indexRef.current;
    if (n !== null) playAt(n, nearEnd ? { reason: 'auto' } : { positionMs: pos });
  };
  claimRef.current = claimLockScreen;
  const nudgeRef = useRef(nudgeSpotify);
  nudgeRef.current = nudgeSpotify;

  // Watchdog: once a second, while the in-hub player should be playing, check
  // that the song is really moving. Stuck for 2.5 s → nudge (above).
  useEffect(() => {
    let checking = false;
    const iv = setInterval(async () => {
      if (checking) return;
      if (engineRef.current !== 'spotify' || !sdkLiveRef.current || startingRef.current) {
        stallRef.current = null;
        return;
      }
      const p = sdkPlayerRef.current;
      if (!p?.getCurrentState) return;
      checking = true;
      try {
        const st = await p.getCurrentState().catch(() => null);
        if (!st || engineRef.current !== 'spotify' || !sdkLiveRef.current || startingRef.current) return;
        // Keep the mini player and Now Playing on the song really playing,
        // even if the player's own change reports went missing (screen off).
        const cur = st.track_window?.current_track;
        applyRef.current({
          active: true,
          isPlaying: !st.paused,
          progressMs: st.position ?? 0,
          durationMs: st.duration ?? 0,
          trackIds: [cur?.id, cur?.linked_from?.id].filter(Boolean) as string[],
          trackName: cur?.name ?? null,
          deviceId: sdkDeviceRef.current,
        });
        if (userPausedRef.current || Date.now() - runStartedAtRef.current < 5000) {
          stallRef.current = null;
          return;
        }
        const id = cur?.id ?? null;
        const pos = st.position ?? 0;
        const dur = st.duration ?? 0;
        const nearEnd = dur > 0 && pos > dur - 6000;
        // Paused in the middle of a song by something else: leave it.
        if (st.paused && !nearEnd && pos > 1500) {
          stallRef.current = null;
          return;
        }
        const s = stallRef.current;
        if (!s || s.id !== id || Math.abs(pos - s.pos) > 400) {
          stallRef.current = { pos, id, since: Date.now(), tries: 0 };
          return;
        }
        if (Date.now() - s.since < 2500) return;
        nudgeRef.current(st, st.paused ? 'paused' : 'not moving');
      } finally {
        checking = false;
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Lock screen / Control Center: the current song and its buttons. The
  // buttons drive the hub (its queue, its next / previous), for both engines.
  // iPhones throw these buttons away whenever a sound becomes the one "now
  // playing" (first play, each new song, each lock-card claim) and then show
  // their default ±10 s buttons, even on the hub's own card (owner's
  // screenshot, 2026-11-08). So they're set again every time one of the hub's
  // silent sounds starts playing, on each song, and on coming back to the
  // app; and the ±10 s actions are switched off explicitly.
  const lockButtons = () => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const on = (action: string, fn: ((d: any) => void) | null) => {
      try {
        ms.setActionHandler(
          action as MediaSessionAction,
          fn &&
            ((d: any) => {
              clientLog(engineRef.current === 'spotify' ? 'spotify' : 'youtube', `lock screen: ${action}`, { song: queueRef.current[indexRef.current]?.title ?? null });
              fn(d);
            }),
        );
      } catch {
        /* this iPhone doesn't offer that button */
      }
    };
    on('seekbackward', null);
    on('seekforward', null);
    on('play', () => {
      if (!playingRef.current) togglePlayRef.current();
    });
    on('pause', () => {
      if (playingRef.current) togglePlayRef.current();
    });
    on('nexttrack', () => nextRef.current());
    on('previoustrack', () => prevRef.current());
    on('seekto', (d) => {
      if (typeof d?.seekTime === 'number') seekRef.current(d.seekTime * 1000);
    });
  };
  lockButtonsRef.current = lockButtons;
  useEffect(() => {
    if (!current) return;
    setLockScreen(current);
    lockButtons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  useEffect(() => {
    // Tell iPhones this is music playback (Safari 17+), and re-set the buttons
    // when you come back to the app.
    try {
      const as = (navigator as any).audioSession;
      if (as && as.type !== 'playback') as.type = 'playback';
    } catch {
      /* older iPhones */
    }
    const again = () => lockButtonsRef.current();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pageshow', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('pageshow', again);
    };
  }, []);

  const startYouTube = (id: string, startMs: number) => {
    if (engineRef.current === 'spotify' && playingRef.current) spotifyAction('action=pause');
    // The hub's own Spotify player may be mid-start: stop it locally too.
    sdkPlayerRef.current?.pause?.().catch?.(() => {});
    runRef.current = null;
    sdkLiveRef.current = false;
    // Phones: the silent loop keeps playing under the YouTube player, so the
    // hub isn't frozen when a song ends with the screen off and can start
    // the next one (iPhones freeze a page the moment its sound stops).
    keepAwake(isPhone());
    setEng('youtube');
    setDevice(null);
    setPlay(true);
    wantPlayRef.current = true;
    ytIdRef.current = id;
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
      claimForYouTube();
    }
    if (state === 2) setPlay(false);
    if (state === 0) ytEnded('event');
  };

  // Lock screen in YouTube mode: the iPhone gives the lock-screen card to the
  // newest sound on the page. Each new YouTube song starts after the silent
  // keep-awake sound, so YouTube's own card took over (±10 s buttons, no
  // skips). Once per song (and after you resume), 0.6 s after it really
  // plays, restart the silent sound so the hub's card comes back with
  // previous / next. Only once: repeated claims made the card flip.
  const ytClaimedRef = useRef(-1); // tokenRef of the song already claimed for
  const claimForYouTube = () => {
    if (!isPhone() || ytClaimedRef.current === tokenRef.current) return;
    ytClaimedRef.current = tokenRef.current;
    const token = tokenRef.current;
    setTimeout(() => {
      if (token !== tokenRef.current || engineRef.current !== 'youtube' || !wantPlayRef.current || ytState() !== 1) return;
      keepAwake(true, true);
      setLockScreen(queueRef.current[indexRef.current] ?? null);
      try {
        setLockPosition((ytPlayerRef.current?.getCurrentTime?.() ?? 0) * 1000, (ytPlayerRef.current?.getDuration?.() ?? 0) * 1000, true);
      } catch {
        /* ignore */
      }
    }, 600);
  };

  // A YouTube song finished: next song (or the same one on repeat-one). Three
  // things can notice the end (YouTube's own report, the 1 s watchdog, and
  // coming back to the app), so each song moves on only once.
  const endedForRef = useRef(-1); // tokenRef of the song already moved on from
  const ytEnded = (why: string) => {
    if (engineRef.current !== 'youtube' || endedForRef.current === tokenRef.current) return;
    if (repeatRef.current === 'one') {
      ytPlayerRef.current?.seekTo(0, true);
      ytPlayerRef.current?.playVideo();
      return;
    }
    endedForRef.current = tokenRef.current;
    if (why !== 'event' || document.hidden) clientLog('youtube', `song ended (${why}), next`, { hidden: document.hidden });
    const n = nextIndex(indexRef.current);
    if (n !== null) playAt(n, { reason: 'auto' });
    else {
      setPlay(false);
      wantPlayRef.current = false;
      keepAwake(false);
    }
  };

  const onYouTubeError = () => {
    if (engineRef.current !== 'youtube') return;
    const track = queueRef.current[indexRef.current];
    ytErrorsRef.current += 1;
    showToast(`Skipped “${track?.title ?? 'song'}”: YouTube won’t play it here`);
    const n = nextIndex(indexRef.current);
    if (n !== null && ytErrorsRef.current < 5) playAt(n, { reason: 'auto' });
    else setPlay(false);
  };

  // ── Keeping in step with Spotify ────────────────────────────────────

  const pollSpotify = async () => {
    if (engineRef.current !== 'spotify' || pollingRef.current) return;
    // Playing in the hub's own Spotify player: it reports every change itself
    // (player_state_changed), so there's no need to ask Spotify's servers.
    if (sdkLiveRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch('/api/player/spotify', { cache: 'no-store' });
      if (!res.ok || engineRef.current !== 'spotify') return;
      applySpotify(await res.json());
    } catch {
      /* try again on the next check */
    } finally {
      pollingRef.current = false;
    }
  };

  // What Spotify is playing → the hub's screen, queue position, top-ups and
  // "last song given has finished". Fed by the poll, or by the in-hub player.
  type SpotifyState = { active: boolean; isPlaying: boolean; progressMs: number; durationMs: number; trackIds: string[]; trackName?: string | null; deviceId: string | null; deviceName?: string | null };
  const applySpotify = (d: SpotifyState) => {
    if (engineRef.current !== 'spotify' || startingRef.current) return;
    {
      if (!d.active) {
        setPlay(false);
        return;
      }
      const run = runRef.current;
      let pos = -1;
      if (run) {
        // Look from the current song onwards first, so a song that's in the
        // list twice doesn't pull the hub back to the earlier copy.
        const from = Math.max(0, run.idx.indexOf(indexRef.current));
        pos = run.ids.findIndex((id, k) => k >= from && d.trackIds.includes(id));
        if (pos < 0) pos = run.ids.findIndex((id) => d.trackIds.includes(id));
        // Spotify sometimes swaps in another copy of a song (a different id);
        // then match by name among the songs it was given.
        if (pos < 0 && d.trackName) {
          const want = simpleName(d.trackName);
          pos = run.ids.findIndex((_, k) => {
            const t = queueRef.current[run.idx[k]];
            return Boolean(t) && simpleName(t.title) === want;
          });
        }
        // Just started: Spotify may still report the song from before (or a
        // song further down the new list); ignore it completely (time, play
        // icon and song) until it settles.
        if (Date.now() - runStartedAtRef.current < 5000 && pos !== expectPosRef.current) return;
      }
      if (!draggingRef.current) {
        posRef.current = { ms: d.progressMs, at: Date.now() };
        setProgress(d.progressMs);
      }
      if (d.durationMs) setDuration(d.durationMs);
      if (d.deviceName !== undefined) setDevice(d.deviceName ?? null);
      setPlay(d.isPlaying);
      if (!run) return;
      if (pos >= 0) strangerRef.current = null;
      if (pos < 0 && lastPlayedEndRef.current && run.sent >= run.ids.length) {
        // The whole list played and Spotify carried on with its own picks:
        // the hub takes over with the song after the list.
        lastPlayedEndRef.current = false;
        const n = nextIndex(run.idx[run.idx.length - 1]);
        clientLog('spotify', 'list finished, hub continues', { next: n });
        if (n !== null) playAt(n, { reason: 'auto' });
        return;
      }
      // In the hub's own player Spotify was given exactly the hub's list, so a
      // stranger is an old leftover from Spotify's queue: skip past it.
      const strangerKey = d.trackIds[0] ?? d.trackName ?? '';
      if (pos < 0 && strangerRef.current?.key !== strangerKey) strangerRef.current = { key: strangerKey, since: Date.now() };
      if (
        pos < 0 &&
        run.list &&
        sdkLiveRef.current &&
        sdkPlayerRef.current?.nextTrack &&
        Date.now() - (strangerRef.current?.since ?? Date.now()) > 2500 &&
        Date.now() - skipLeftoverAtRef.current > 2500
      ) {
        skipLeftoverAtRef.current = Date.now();
        clientLog('spotify', 'skipping a leftover', { name: d.trackName ?? null });
        sdkPlayerRef.current.nextTrack().catch(() => {});
        return;
      }
      if (pos < 0) {
        // Something else is playing in Spotify; note it once per song.
        const key = d.trackIds[0] ?? d.trackName ?? '';
        if (key && unmatchedRef.current !== key) {
          unmatchedRef.current = key;
          clientLog('spotify', 'playing song not in the line-up', { ids: d.trackIds, name: d.trackName ?? null, lineUp: run.ids.slice(0, 12) });
        }
        return;
      }
      const qi = run.idx[pos];
      if (qi !== indexRef.current) {
        const auto = Date.now() - runStartedAtRef.current >= 5000;
        if (auto) startedByRef.current = 'auto'; // Spotify moved on by itself
        setI(qi);
        // Spotify's frame takes the lock screen on each new song (±10 s
        // buttons): with the screen off, take it back once for the hub's card.
        if (auto && document.hidden) claimLockScreen();
      }
      if (run.list) {
        if (pos === run.ids.length - 1) extrasPendingRef.current = false;
        extendSpotify(pos);
      }

      // The last song Spotify was given has finished: the hub plays what's next
      // (for example a YouTube-only song). Only works while the hub is open.
      // Gentle top-up: when Spotify is 3 songs from the end of what it was
      // given, add the next 10 (no restart, the song keeps playing).
      if (run.sent > 0 && pos >= run.sent - 3 && run.sent < run.ids.length && !run.topping) {
        run.topping = true;
        fetch('/api/play/spotify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: run.ids.slice(run.sent, run.sent + 10), append: true, deviceId: d.deviceId ?? null }),
        })
          .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
          .then(({ ok, b }) => {
            if (ok && runRef.current === run) run.sent += Number(b.queued) || 0;
          })
          .catch(() => {})
          .finally(() => {
            run.topping = false;
          });
      }
      const isLast = pos === Math.min(run.sent, run.ids.length) - 1;
      if (d.isPlaying) {
        lastPlayedEndRef.current = isLast;
        return;
      }
      const atEdge = d.progressMs < 3000 || d.durationMs - d.progressMs < 6000;
      if (isLast && lastPlayedEndRef.current && atEdge && repeatRef.current !== 'one') {
        lastPlayedEndRef.current = false;
        const n = nextIndex(qi);
        if (n !== null) playAt(n, { reason: 'auto' });
      }
    }
  };

  // ── Keeping Spotify's line-up ahead of the music ────────────────────
  // iPhones let the hub's Spotify player go from song to song inside the list
  // it was given (even locked), but a brand-new start without a tap is
  // refused: that's what paused the music when a short list ran out. So
  // the list never runs out: when Spotify is on the last song of the list
  // or within 2 of the end, the next songs (in the hub's order, skipping ones
  // Spotify doesn't have) are added to Spotify's queue.
  const extendSpotify = async (pos: number) => {
    const run = runRef.current;
    if (!run?.list || engineRef.current !== 'spotify' || !sdkLiveRef.current || startingRef.current || extendingRef.current) return;
    if (repeatRef.current === 'one' || pos < 0) return;
    // Queue songs play before the rest of the list, so only once the list's
    // own songs are done, and only when 2 or fewer are left.
    if (pos < (run.ctx ?? run.ids.length) - 1 || run.ids.length - 1 - pos > 2) return;
    const q = queueRef.current;
    const add: { id: string; j: number }[] = [];
    let unknownAt = -1;
    let j = run.idx[run.idx.length - 1] + 1;
    for (; j < q.length && add.length < 4; j++) {
      const t = q[j];
      if (!sourceId(t, 'spotify') && !spotifyMatchRef.current.has(t.id)) {
        unknownAt = j;
        break;
      }
      const c = decide(t, videoRef.current);
      if (c.engine === 'spotify') add.push({ id: c.id, j });
    }
    if (unknownAt >= 0) matchAhead(unknownAt);
    if (!add.length) {
      if (unknownAt < 0 && j >= q.length) loadMore(); // a big list: fetch its next songs
      return;
    }
    const device = sdkDeviceRef.current;
    if (!device) return;
    extendingRef.current = true;
    let added = 0;
    try {
      for (const a of add) {
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          const t = await getSpotifyToken(attempt > 0);
          if (!t) break;
          const r = await fetch(
            `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(`spotify:track:${a.id}`)}&device_id=${encodeURIComponent(device)}`,
            { method: 'POST', headers: { Authorization: `Bearer ${t}` } },
          ).catch(() => null);
          if (r?.ok) ok = true;
          else if (r?.status !== 401) {
            clientLog('spotify', 'adding to the line-up refused', { status: r?.status ?? 0 });
            break;
          }
        }
        if (!ok || runRef.current !== run) break;
        run.ids.push(a.id);
        run.idx.push(a.j);
        run.sent = run.ids.length;
        extrasPendingRef.current = true;
        added++;
      }
    } finally {
      extendingRef.current = false;
    }
    if (added) clientLog('spotify', 'line-up extended', { added, songsAhead: run.ids.length - 1 - pos });
  };

  // Looks up Spotify versions of the coming songs in the background, a batch
  // at a time (the server searches at most 12 per call), so extendSpotify
  // always has the next songs ready.
  const matchAhead = async (from: number) => {
    if (matchingAheadRef.current) return;
    matchingAheadRef.current = true;
    try {
      for (let round = 0; round < 8; round++) {
        const before = spotifyMatchRef.current.size;
        await findSpotifyVersions(from, 40);
        if (engineRef.current !== 'spotify' || !runRef.current) break;
        if (spotifyMatchRef.current.size === before) break; // nothing new (Spotify busy): try again later
        const more = queueRef.current
          .slice(from, from + 40)
          .some((t) => !sourceId(t, 'spotify') && !spotifyMatchRef.current.has(t.id));
        if (!more) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      matchingAheadRef.current = false;
    }
  };

  const applyRef = useRef(applySpotify);
  applyRef.current = applySpotify;
  const unmatchedRef = useRef('');

  // If the songs after the current one changed (shuffle, play next…),
  // give Spotify the new line-up, continuing the current song where it is.
  const resyncSpotify = () => {
    if (engineRef.current !== 'spotify' || !runRef.current) return;
    // New songs from YouTube get their Spotify versions looked up first.
    findSpotifyVersions(indexRef.current).then(resyncNow);
  };
  const resyncNow = () => {
    if (engineRef.current !== 'spotify' || !runRef.current) return;
    const list = queueRef.current;
    const ids: string[] = [];
    for (let j = indexRef.current; j < list.length && j < indexRef.current + 150 && ids.length < 50; j++) {
      const c = decide(list[j], videoRef.current);
      if (c.engine !== 'spotify') continue;
      ids.push(c.id);
    }
    const run = runRef.current;
    const start = run.idx.indexOf(indexRef.current);
    const remaining = start >= 0 ? run.ids.slice(start) : [];
    // Compare only the songs both cover (Spotify may already have more queued,
    // or the hub may know more): a real change is a different song in there.
    const k = Math.min(ids.length, remaining.length);
    if (k === 0 || ids.slice(0, k).join() !== remaining.slice(0, k).join()) {
      const wasPlaying = playingRef.current;
      playAt(indexRef.current, { positionMs: currentProgress() }).then(() => {
        if (!wasPlaying) {
          clientLog('spotify', 'paused after re-sync (was paused before)');
          spotifyAction('action=pause').then(() => setPlay(false));
        }
      });
    }
  };

  // ── Controls ────────────────────────────────────────────────────────

  const togglePlay = async () => {
    gesture();
    if (!current || busy) return;
    if (restoredRef.current) {
      restoredRef.current = false;
      playAt(indexRef.current, { positionMs: progress, back: true });
      return;
    }
    if (engineRef.current === 'youtube') {
      if (playingRef.current) {
        wantPlayRef.current = false;
        ytPlayerRef.current?.pauseVideo?.();
        keepAwake(false);
        ytClaimedRef.current = -1; // claim the card again when you resume
      } else {
        wantPlayRef.current = true;
        setNotice(null);
        keepAwake(isPhone());
        // Back on a song that had already finished (e.g. it ended while the
        // hub was frozen): go on to the next one instead of replaying it.
        if (ytState() === 0 && endedForRef.current !== tokenRef.current) ytEnded('play on ended');
        else {
          ytPlayerRef.current?.playVideo?.();
          watchYouTubeStart();
        }
      }
      return;
    }
    if (playingRef.current) {
      userPausedRef.current = true;
      if (sdkLiveRef.current && sdkPlayerRef.current) {
        await sdkPlayerRef.current.pause().catch(() => {});
        posRef.current = { ms: currentProgress(), at: Date.now() };
        setPlay(false);
        keepAwake(false);
        return;
      }
      const r = await spotifyAction('action=pause');
      if (r.ok) {
        posRef.current = { ms: currentProgress(), at: Date.now() };
        setPlay(false);
      } else setNotice({ text: r.message ?? 'Spotify didn’t pause.' });
    } else {
      userPausedRef.current = false;
      if (sdkLiveRef.current && sdkPlayerRef.current) {
        keepAwake(true);
        setNotice(null);
        await sdkPlayerRef.current.resume().catch(() => {});
        posRef.current = { ms: progress, at: Date.now() };
        setPlay(true);
        return;
      }
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
    if (n === null) return;
    reportSkip();
    // In the hub's own Spotify player the next song is already lined up in
    // Spotify's list: just skip (instant, no new start).
    const run = runRef.current;
    const p = sdkPlayerRef.current;
    if (engineRef.current === 'spotify' && sdkLiveRef.current && p?.nextTrack && run?.list && !startingRef.current && run.sent >= run.ids.length) {
      const pos = run.idx.indexOf(indexRef.current);
      if (pos >= 0 && pos + 1 < run.ids.length) {
        const n = run.idx[pos + 1]; // the next song Spotify has (songs it lacks are skipped)
        const leaving = queueRef.current[indexRef.current];
        if (leaving) historyRef.current.push(leaving);
        userPausedRef.current = false;
        ++tokenRef.current; // any check still waiting from the last start is now out of date
        runStartedAtRef.current = Date.now();
        expectPosRef.current = pos + 1;
        setI(n);
        setProgress(0);
        posRef.current = { ms: 0, at: Date.now() };
        setDuration(queueRef.current[n]?.duration_ms ?? 0);
        startedByRef.current = 'next';
        p.nextTrack().catch(() => playAt(n, { reason: 'next' }));
        claimLockScreen();
        return;
      }
    }
    playAt(n, { reason: 'next' });
  };

  // Next pressed early on a song you didn't pick yourself → a skip, which
  // teaches your taste (artists you keep skipping come up less). Not counted:
  // songs you tapped (peeking around the queue), under 8 s (flicking through),
  // or past half the song / 2 minutes (you listened).
  const reportSkip = () => {
    const t = queueRef.current[indexRef.current];
    if (!t || startedByRef.current === 'tap' || !playingRef.current) return;
    const played = currentProgress();
    const dur = durationRef.current || t.duration_ms || 0;
    if (played < 8000) return;
    if (played > Math.min(dur ? dur * 0.5 : 120_000, 120_000)) return;
    fetch('/api/skips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: t.id, title: t.title, artist: t.artist, playedMs: Math.round(played), durationMs: dur }),
      keepalive: true,
    }).catch(() => {});
  };

  const prev = () => {
    gesture();
    if (currentProgress() > 3000) return seek(0);
    // The song you were on before (it may be further down if you jumped back).
    while (historyRef.current.length) {
      const t = historyRef.current.pop()!;
      const j = queueRef.current.indexOf(t);
      if (j >= 0 && j !== indexRef.current) return playAt(j, { back: true });
    }
    if (indexRef.current <= 0) seek(0);
    else playAt(indexRef.current - 1, { back: true });
  };
  // The lock screen's buttons call the latest versions of these.
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;

  const seek = (ms: number) => {
    setProgress(ms);
    if (engineRef.current === 'youtube') ytPlayerRef.current?.seekTo?.(ms / 1000, true);
    if (engineRef.current === 'spotify') {
      posRef.current = { ms, at: Date.now() };
      if (sdkLiveRef.current && sdkPlayerRef.current?.seek) sdkPlayerRef.current.seek(Math.floor(ms)).catch(() => {});
      else spotifyAction(`action=seek&positionMs=${Math.floor(ms)}`);
    }
  };
  seekRef.current = seek;

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

  // The eye: watch the music video, or go back to the cover and studio audio.
  // If both are the same YouTube video (only a video exists), just the view changes.
  const toggleVideo = () => {
    gesture();
    videoRef.current = !videoRef.current;
    setVideo(videoRef.current);
    const track = queueRef.current[indexRef.current];
    if (!track) return;
    const next = decide(track, videoRef.current);
    if (next.engine === 'youtube' && next.id === ytIdRef.current) return;
    playAt(indexRef.current, { positionMs: currentProgress() });
  };

  const playList = (list: TrackRowData[], start: number, opts: PlayOptions = {}) => {
    gesture();
    if (list.length === 0) return;
    baseRef.current = list.slice();
    addedRef.current = new WeakSet();
    historyRef.current = [];
    setFromLabel(opts.from || pageTitle());
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
    playAt(i, { back: true }); // a new list starts with no history
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
  // `label`: a radio started from words ("rainy day lo-fi") is named after them.
  const startRadio = async (track: TrackRowData, label?: string) => {
    const videoId = track.yt_audio_id;
    if (!videoId) {
      showToast('This song has no YouTube version yet, so a radio can’t start from it.');
      return;
    }
    const mode = readRadioMode();
    showToast(label ? `Starting a “${label}” radio…` : `Starting a radio from “${track.title}”…`);
    try {
      const seed = new URLSearchParams({
        videoId,
        mode,
        seedTitle: track.title,
        seedArtist: track.artist,
        seedImage: track.image_url ?? '',
        seedId: /^[0-9a-f-]{36}$/i.test(track.id) ? track.id : '',
        ...(label ? { seedLabel: label } : {}),
      });
      const res = await fetch(`/api/radio?${seed.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Radio failed');
      const rest: TrackRowData[] = (body.tracks ?? []).filter((t: TrackRowData) => t.yt_audio_id !== videoId && t.id !== track.id);
      playList([track, ...rest], 0, { noShuffle: true, radio: { continuation: body.continuation ?? null, mode, editionId: body.editionId ?? null }, from: `Radio · ${label ?? track.title}` });
      setRadioEdition(body.editionId ?? null);
    } catch (err) {
      showToast((err as Error).message || 'The radio couldn’t start. Try again in a moment.');
    }
  };

  // A radio from words: built from playlists people made for them (lib/promptRadio.ts).
  const startPromptRadio = async (words: string) => {
    const mode = readRadioMode();
    showToast(`Building a “${words}” radio…`);
    const res = await fetch(`/api/radio/prompt?${new URLSearchParams({ q: words, mode })}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.tracks?.length) throw new Error(body.error || 'The radio couldn’t start. Try again in a moment.');
    playList(body.tracks, 0, { noShuffle: true, radio: { continuation: body.continuation ?? null, mode, editionId: body.editionId ?? null }, from: `Radio · ${words}` });
    setRadioEdition(body.editionId ?? null);
  };

  // Opens an artist's page in the hub (app/artist/page.tsx finds them on YouTube Music).
  const openArtist = (name: string) => {
    setArtistMenu(null);
    setMoreOpen(false);
    setSheetOpen(false);
    router.push(`/artist?name=${encodeURIComponent(name)}`);
  };

  // A radio from a whole playlist: songs like the ones in it, none of its own (lib/playlistRadio.ts).
  const startPlaylistRadio = async (playlistId: string, name: string) => {
    const mode = readRadioMode();
    showToast(`Starting a radio from “${name}”…`);
    try {
      const res = await fetch(`/api/radio/playlist?${new URLSearchParams({ id: playlistId, mode })}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.tracks?.length) throw new Error(body.error || 'The radio couldn’t start. Try again in a moment.');
      playList(body.tracks, 0, { noShuffle: true, radio: { continuation: body.continuation ?? null, mode, editionId: body.editionId ?? null }, from: `Radio · ${name}` });
      setRadioEdition(body.editionId ?? null);
    } catch (err) {
      showToast((err as Error).message || 'The radio couldn’t start. Try again in a moment.');
    }
  };

  // Play next: straight after the current song. Add to queue: after the other
  // songs you added, before the rest of the list (like Spotify's queue).
  // Each added song is a copy, so it can be told apart from the same song in the list.
  const playNext = (track: TrackRowData) => {
    if (indexRef.current < 0) return playList([track], 0);
    const t = { ...track };
    addedRef.current.add(t);
    const q = queueRef.current.slice();
    q.splice(indexRef.current + 1, 0, t);
    const cur = queueRef.current[indexRef.current];
    const base = baseRef.current.slice();
    base.splice(Math.max(0, base.indexOf(cur)) + 1, 0, t);
    baseRef.current = base;
    setQ(q, indexRef.current);
    showToast(`Playing next: ${track.title}`);
    resyncSpotify();
  };

  const addToQueue = (track: TrackRowData) => {
    if (indexRef.current < 0) return playList([track], 0);
    const t = { ...track };
    addedRef.current.add(t);
    const q = queueRef.current.slice();
    let at = indexRef.current + 1;
    while (at < q.length && addedRef.current.has(q[at])) at++;
    q.splice(at, 0, t);
    baseRef.current = [...baseRef.current, t];
    setQ(q, indexRef.current);
    showToast(`Added to queue: ${track.title}`);
    resyncSpotify();
  };

  // Moves an upcoming song (drag in Up next, or its ⋯ menu). added: which group it
  // joins; when not given (a drag), it joins the group of the songs around it.
  const moveInQueue = (from: number, to: number, added?: boolean) => {
    const cur = indexRef.current;
    const q = queueRef.current.slice();
    if (from <= cur || to <= cur || from >= q.length || from === to) return;
    const [t] = q.splice(from, 1);
    q.splice(Math.min(to, q.length), 0, t);
    const at = q.indexOf(t);
    const before = at - 1 > cur ? q[at - 1] : null;
    const after = q[at + 1];
    const join = added ?? (before ? addedRef.current.has(before) : Boolean(after && addedRef.current.has(after)));
    if (join) addedRef.current.add(t);
    else addedRef.current.delete(t);
    setQ(q, cur);
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

  // The star from a queue row's ⋯ menu (any song, not just the one playing).
  const keepTrack = async (t: TrackRowData) => {
    try {
      const res = await fetch('/api/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: t.id, on: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save');
      if (current && t.id === current.id) setKept(true);
      showToast(`Kept in Discoveries: ${t.title}`);
    } catch (err) {
      showToast((err as Error).message || 'Could not save');
    }
  };

  // P3: the constellation scrolls down to "Up next" (no pop-up).
  const showUpNext = () => {
    const sheet = sheetRef.current;
    const el = upnextRef.current;
    if (!sheet || !el) return;
    const top = sheet.scrollTop + el.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 12;
    sheet.scrollTo({ top, behavior: 'smooth' });
  };

  // The YouTube player floats over the cover (it can't live inside the sheet
  // without reloading), so when the sheet scrolls it follows the cover.
  const followArt = () => {
    const sheet = sheetRef.current;
    const host = hostRef.current;
    const art = sheet?.querySelector<HTMLElement>('.np-art');
    if (!sheet || !host || !art) return;
    // iPhones report scroll positions late during a flick, so a fixed video moved
    // by script lags the cover and jitters. Instead, once the sheet scrolls, the
    // video fades out (it keeps playing) and the real cover image scrolls natively.
    const tucked = sheet.scrollTop > 4;
    host.toggleAttribute('data-tucked', tucked);
    if (tucked) return;
    const top = art.getBoundingClientRect().top;
    const safe = parseFloat(getComputedStyle(sheet).paddingTop) || 0;
    host.style.setProperty('--np-top', `${top}px`);
    host.style.setProperty('--np-clip', `${Math.max(0, safe - top)}px`);
  };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.style.removeProperty('--np-top');
    host.style.removeProperty('--np-clip');
    host.removeAttribute('data-tucked');
    if (sheetOpen) requestAnimationFrame(followArt);
  }, [sheetOpen, video]);

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
  const endedRef = useRef(ytEnded);
  endedRef.current = ytEnded;

  // YouTube watchdog: once a second while a YouTube song should be playing.
  // With the screen off YouTube's "ended" report can go missing, so this
  // checks for itself: finished, or stuck at the very end → next song;
  // paused by the phone (not by you) while the screen is off → play again.
  // It also keeps the lock screen's time bar right.
  const ytWatchRef = useRef<{ t: number; since: number; token: number; tries: number } | null>(null);
  useEffect(() => {
    let beat = 0;
    const iv = setInterval(() => {
      if (engineRef.current !== 'youtube' || !wantPlayRef.current || !ytPlayerRef.current) {
        ytWatchRef.current = null;
        return;
      }
      let t = 0;
      let d = 0;
      try {
        t = ytPlayerRef.current.getCurrentTime?.() ?? 0;
        d = ytPlayerRef.current.getDuration?.() ?? 0;
      } catch {
        return;
      }
      const st = ytState();
      const token = tokenRef.current;
      if (++beat % 5 === 0) setLockPosition(t * 1000, d * 1000, st === 1);
      if (st === 0) {
        endedRef.current('watchdog');
        return;
      }
      const w = ytWatchRef.current;
      if (!w || w.token !== token || Math.abs(t - w.t) > 0.3) {
        ytWatchRef.current = { t, since: Date.now(), token, tries: w?.token === token ? w.tries : 0 };
        return;
      }
      const stillFor = Date.now() - w.since;
      if (d > 0 && t >= d - 1.5 && stillFor > 3000) {
        endedRef.current('stuck at the end');
        return;
      }
      if (st === 2 && document.hidden && d > 0 && t < d - 1.5 && stillFor > 2000 && w.tries < 6) {
        w.tries++;
        w.since = Date.now();
        clientLog('youtube', `paused by the phone, play again ${w.tries}`, { t: Math.round(t), d: Math.round(d) });
        keepAwake(true);
        ytPlayerRef.current?.playVideo?.();
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // Coming back to the app in Spotify mode: check Spotify still knows the
  // hub's player (it forgets it after a while asleep) and reconnect now, so
  // the next tap plays through Spotify straight away.
  useEffect(() => {
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible' || ytModeRef.current || !sdkPlayerRef.current) return;
      if (Date.now() - last < 20_000 || startingRef.current) return;
      last = Date.now();
      const t = await getSpotifyTokenRef.current();
      if (!t) return;
      const d = await fetch('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!d) return;
      const known = ((d.devices ?? []) as { id?: string }[]).some((x) => x.id && x.id === sdkDeviceRef.current);
      if (!known && !startingRef.current) {
        clientLog('spotify', 'player missing on return, reconnecting');
        ensureSdkRef.current(true);
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
    };
  }, []);

  // Coming back to the app: if iPhone paused your music while you were away, carry on.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (engineRef.current === 'youtube' && wantPlayRef.current && ![1, 3].includes(ytState())) {
        // The song finished while you were away (the hub was frozen and
        // missed it): move on. Before, this replayed the finished song.
        if (ytState() === 0) {
          endedRef.current('back in the app');
          return;
        }
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

  // Spotify's player inside the hub ("Music Hub (this browser)"): music plays
  // from this page with your Premium account, no Spotify app needed. On
  // computers it starts when the app opens; on iPhones on your first Play
  // tap in Spotify mode (see gesture). Its problems go to the Spotify diary.
  useEffect(() => {
    if (window.location.pathname === '/login') return;
    const make = () => {
      if (sdkPlayerRef.current || !window.Spotify) return;
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
      let done: (id: string | null) => void = () => {};
      sdkWaitRef.current = new Promise((res) => {
        done = res;
        setTimeout(() => res(null), 6000);
      });
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        sdkDeviceRef.current = device_id;
        clientLog('spotify', 'in-hub player ready', { phone: isPhone() });
        done(device_id);
      });
      player.addListener('not_ready', () => {
        sdkDeviceRef.current = null;
        sdkLiveRef.current = false;
        clientLog('spotify', 'in-hub player dropped off');
      });
      player.addListener('player_state_changed', (st: any) => sdkStateRef.current(st));
      for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error', 'autoplay_failed']) {
        player.addListener(ev, (e: { message?: string }) => clientLog('spotify', `in-hub player: ${ev}`, { message: e?.message ?? '' }));
      }
      player.connect();
      if (isPhone()) player.activateElement?.();
      sdkPlayerRef.current = player;
    };
    makeSdkPlayerRef.current = make;
    window.onSpotifyWebPlaybackSDKReady = () => {
      sdkReadyRef.current = true;
      if (!isPhone()) make();
    };
    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(script);
    } else if (window.Spotify) {
      sdkReadyRef.current = true;
    }
  }, []);

  // While Spotify is the engine, check what it's playing every few seconds
  // (only while the hub is on screen), and right away when you come back.
  useEffect(() => {
    if (engine !== 'spotify') return;
    const tick = () => document.visibilityState === 'visible' && pollRef.current();
    const timer = setInterval(tick, 5000); // gentle: every 5 s (was 2.5 s)
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [engine]);

  // Back from the Spotify app after a wake-up: if the music hasn't started yet
  // (iPhones sometimes cut off the waiting request when the hub goes to the
  // background), ask once more, now that Spotify is surely awake.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      const w = wakeRef.current;
      if (!w || w.retried) return;
      w.retried = true;
      setTimeout(async () => {
        if (wakeRef.current !== w || w.token !== tokenRef.current) return;
        try {
          // Already playing (the first request got through after all)? Then just catch up.
          const now = await fetch('/api/player/spotify', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
          const first = Array.isArray(w.body.ids) ? (w.body.ids as string[])[0] : null;
          if (now?.isPlaying && first && now.trackIds?.includes(first)) {
            if (wakeRef.current === w) wakeRef.current = null;
            setBusy(false);
            setNotice(null);
            setPlay(true);
            pollRef.current();
            return;
          }
          const r = await fetch('/api/play/spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...w.body, wait: false }),
          });
          const d = await r.json().catch(() => ({}));
          if (wakeRef.current !== w || w.token !== tokenRef.current) return;
          wakeRef.current = null;
          setBusy(false);
          if (!r.ok) {
            setPlay(false);
            setNotice({
              text: d.message ?? 'Spotify didn’t start. Press Play again, or switch on YouTube mode.',
              action: { label: 'Use YouTube mode', run: () => setYoutubeMode(true) },
            });
            return;
          }
          setNotice(null);
          setDevice(d.device ?? null);
          setPlay(true);
          if (runRef.current) runRef.current.sent = 1 + (Number(d.queued) || 0);
          posRef.current = { ms: Number(w.body.positionMs) || 0, at: Date.now() };
          setTimeout(() => pollRef.current(), 1500);
        } catch {
          /* still offline; Play again will retry */
        }
      }, 2500);
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pageshow', back);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Move the progress bar smoothly.
  useEffect(() => {
    if (!engine) return;
    const timer = setInterval(() => {
      if (draggingRef.current) return;
      if (engineRef.current === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
        try {
          const t = ytPlayerRef.current.getCurrentTime();
          if (Number.isFinite(t)) setProgress(t * 1000);
          const d = ytPlayerRef.current.getDuration?.();
          if (d) setDuration(d * 1000);
        } catch {
          /* the player is between songs; try again next tick */
        }
      } else if (engineRef.current === 'spotify' && playingRef.current && !startingRef.current) {
        setProgress(Math.min(posRef.current.ms + (Date.now() - posRef.current.at), durationRef.current || Infinity));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [engine]);

  // ── Layout ──────────────────────────────────────────────────────────

  const ytActive = engine === 'youtube';
  // Where YouTube's player sits: over the artwork in Now Playing, a wide
  // panel above the bar for music videos, a small square in the bar, or hidden.
  const hostStyle: React.CSSProperties =
    ytActive && sheetOpen
      ? {
          top: 'var(--np-top, calc(env(safe-area-inset-top) + 64px))',
          clipPath: 'inset(var(--np-clip, 0px) 0 0 0)',
          left: '50%',
          transform: 'translateX(-50%)',
          // Same box as .sheet-art: a big square cover (a wide box for music videos).
          width: video ? 'min(calc(100vw - 44px), 520px)' : 'var(--np-art)',
          aspectRatio: video ? '16 / 9' : '1 / 1',
          zIndex: 41,
          borderRadius: 14,
        }
      // The music video only shows big inside Now Playing (owner's wish); with
      // the sheet closed it stays the small square in the bar.
      : ytActive && !sheetOpen
          ? {
              // over the artwork square in the floating player card
              left: 'calc(max(10px, env(safe-area-inset-left)) + 9px)',
              bottom: `calc(var(--nav-h) + ${8 + (BAR_HEIGHT - 48) / 2}px + env(safe-area-inset-bottom))`,
              width: 48,
              height: 48,
              borderRadius: 6,
              // Still playing, but hidden: at this size YouTube shows its own
              // spinner and buttons, so the bar shows the cover picture instead.
              opacity: 0,
              pointerEvents: 'none',
            }
          : { left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' };

  const pct = duration ? Math.min(100, (progress / duration) * 100) : 0;
  const status = busy
    ? 'Starting…'
    : engine === 'spotify'
      ? `Spotify${device ? ` · ${device}` : ''}`
      : video
        ? 'Music video · in the hub'
        : 'YouTube · in the hub';

  // Moving the time bar. iPhones often don't report letting go of a slider,
  // which used to leave the bar frozen for the rest of the song. Now letting
  // go is caught several ways, and if the bar hasn't moved for 0.6 s the new
  // spot is used anyway, so the bar always comes back to life.
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const commitSeek = (ms?: number) => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
    const target = ms ?? pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (target != null && Number.isFinite(target)) seek(target);
  };
  const dragSeek = (ms: number) => {
    draggingRef.current = true;
    pendingSeekRef.current = ms;
    setProgress(ms);
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => commitSeek(), 600);
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
    <PlayerContext.Provider value={{ current, youtubeMode, setYoutubeMode, playList, playNext, addToQueue, startRadio, startPromptRadio, startPlaylistRadio }}>
      {children}

      {/* Space so the bar never covers the end of a list. */}
      {current && <div aria-hidden="true" style={{ height: BAR_HEIGHT + 24 + 0 }} />}

      {/* The video ignores touches (so a swipe that starts on it scrolls Now Playing),
          except while the iPhone is asking for one tap to start the sound. */}
      <div
        ref={hostRef}
        className={`yt-host${ytActive && (!sheetOpen || !video) ? ' square' : ''}`}
        data-needs-tap={notice?.text.startsWith('Your iPhone wants one tap') ? '' : undefined}
        style={hostStyle}
      />

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
          {current.image_url ? (
            <img className="player-art" src={smallCover(current.image_url)} alt="" />
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
            <button type="button" className="ctrl primary" aria-label={busy ? 'Loading' : playing ? 'Pause' : 'Play'} aria-busy={busy} onClick={togglePlay}>
              {busy ? <span className="play-spin" aria-hidden="true" /> : playing ? icon(ICON.pause) : icon(ICON.play, true)}
            </button>
            <button type="button" className="ctrl" aria-label="Next song" onClick={next}>
              {icon(ICON.next)}
            </button>
          </div>
        </div>
      )}

      {current && sheetOpen && (
        <div className="sheet" role="dialog" aria-label="Now playing" ref={sheetRef} onScroll={followArt}>
          <div className="sheet-head">
            <button type="button" className="ctrl" aria-label="Close Now Playing" onClick={() => setSheetOpen(false)}>
              {icon(ICON.down)}
            </button>
            {/* H3: where the music is playing from. */}
            <span className="np-from">
              <small>Playing from</small>
              <span>{fromLabel || 'Music Hub'}</span>
            </span>
            <span className="np-head-space" aria-hidden="true" />
          </div>

            <div className="sheet-body np">
              {/* A soft wash of the cover's colors behind the top of the screen. */}
              {current.image_url && <div className="np-wash" aria-hidden="true" style={{ backgroundImage: `url("${current.image_url}")` }} />}
              <div className={`sheet-art np-art${ytActive && video ? ' wide' : ''}${ytActive ? ' yt' : ''}`}>
                {current.image_url && <img src={current.image_url} alt="" />}
              </div>

              <div className="np-title">
                <div className="np-text">
                  <div className="sheet-title">{current.title}</div>
                  {/* Tap the artist: their page in the hub (discography, top songs, yours).
                      Several artists on one song: pick which one. */}
                  <button
                    type="button"
                    className="sheet-artist np-artist-link"
                    onClick={() => {
                      const names = splitArtists(current.artist);
                      if (names.length > 1) return setArtistMenu(names);
                      if (names[0]) openArtist(names[0]);
                    }}
                  >
                    {current.artist}
                  </button>
                  {artistMenu && (
                    <>
                      <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setArtistMenu(null)} />
                      <div className="row-menu np-menu np-artist-menu" role="menu">
                        {artistMenu.map((n) => (
                          <button key={n} type="button" role="menuitem" onClick={() => openArtist(n)}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
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
                  onChange={(e) => dragSeek(Number(e.target.value))}
                  onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                  onPointerCancel={() => commitSeek()}
                  onTouchEnd={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                  onTouchCancel={() => commitSeek()}
                  onMouseUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                  onKeyUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                  onBlur={() => commitSeek()}
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
                <button type="button" className="np-play" aria-label={busy ? 'Loading' : playing ? 'Pause' : 'Play'} aria-busy={busy} onClick={togglePlay}>
                  {busy ? <span className="play-spin" aria-hidden="true" /> : playing ? icon(ICON.pause) : icon(ICON.play, true)}
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
                <button type="button" className={`np-icon${video ? ' on' : ''}`} aria-label={video ? 'Back to the cover and studio audio' : 'Watch music video'} title="Music video" aria-pressed={video} disabled={!ytActive || !(current.video_id || current.yt_audio_id)} onClick={toggleVideo}>
                  {picon('video', 'row-video')}
                </button>
                <button type="button" className="np-icon" aria-label="Show up next" title="Up next" onClick={showUpNext}>
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

              <div ref={upnextRef} className="np-upnext">
                <QueueList
                  queue={queue}
                  index={index}
                  more={srcLeft}
                  from={fromLabel || 'Music Hub'}
                  shuffle={shuffle}
                  isAdded={(t) => addedRef.current.has(t)}
                  scroller={() => sheetRef.current}
                  onPlay={(j) => playAt(j)}
                  onMove={moveInQueue}
                  onRemove={removeAt}
                  onKeep={keepTrack}
                  onAddToPlaylist={(t) => pickPlaylist([t])}
                />
              </div>
            </div>
        </div>
      )}
      </SafeBoundary>
    </PlayerContext.Provider>
  );
}
