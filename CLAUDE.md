# Music Hub — handoff notes

Read this first in every session. It replaces handoff zips: everything a new
session needs to continue lives here and in the code. **Update the "Current
state" and "Session log" sections before ending a session**, and commit with
the code.

## About the owner and how to work with them

- Personal project for one person (GitHub `sharkbarnacles`). They mostly work
  **from an iPhone**, not a computer, and are not a professional developer.
- Explain things plainly and step by step, **one small task at a time**,
  saying exactly which button to tap. Long multi-part instructions confused
  them early on; short steps with "tell me when you see X" worked well.
- Never ask them to paste secret keys into chat. Keys go straight into
  Vercel / GitHub settings.
- They like to choose designs from **"labs"**: interactive pages with coded
  options (C1–C10, B1–B7 …) that combine live, answered with a code like
  "C10a + F3 + B3 + L1". Same format as their earlier Glottozoid labs.
- They want everything free (free tiers only, no card on Google Cloud).
- They use the app as an **iPhone home-screen web app** (standalone, not
  Safari): mind the status bar (`env(safe-area-inset-*)`, the fixed strip
  `body::before` in globals.css) and test layouts with that in mind.

## What the app is

A private web app that holds the owner's Spotify and YouTube Music library in
one database, organizes it, and plays it inside the app.

- Live: https://big-music-six.vercel.app (password login, one user)
- Code: https://github.com/sharkbarnacles/Big-Music (branch `main`)
- Hosting: Vercel project `big-music` in the Vercel team/scope `wiltykelpy`
  (Hobby plan). **Every push to `main` deploys automatically.**
- Database: Supabase project `music-hub`, id `dvcjjcuqmhwdahhaafuy`,
  URL https://dvcjjcuqmhwdahhaafuy.supabase.co, organization "Glottozoid",
  region us-east-1, free plan (pauses after ~1 week unused; Restore in the
  dashboard).
- Spotify developer app "Music Hub" (Development Mode, owner added under User
  Management). Google Cloud project "Music Hub" (`music-hub-513518`) with
  YouTube Data API v3, OAuth consent screen in **Testing** (YouTube sign-in
  expires about weekly → "Reconnect" on Home).

Environment variables (set in Vercel; names only, never values):
`APP_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. GitHub Actions secrets:
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

## How to work on it from a Claude session

- The session's sandbox usually **cannot install npm packages** (registry
  blocked), so there's no local build. Instead: commit, push to `main`, then
  wait for Vercel's result on the commit:
  `gh api repos/sharkbarnacles/Big-Music/commits/<sha>/status --jq '.statuses[] | select(.context|test("Vercel";"i")) | .state'`
  (`success` / `failure`). A failed build leaves the previous version live.
  `vercel.json` skips the build when a commit only changes `CLAUDE.md`,
  `.github/`, `scripts/` or `supabase/` (no status, or "canceled"). **Every
  real deploy restarts the owner's open app on their next page change**
  (Next loads the new version with a full reload), so batch app changes
  into fewer pushes. The player survives it (`savePlayer`/`restorePlayer`,
  localStorage `mh-player`): the queue comes back paused, Play resumes.
- **Vercel Hobby limits deploys per day** (hit on 2026-11-03 after ~60
  deploys: "Deployment rate limited — retry in 24 hours"; the live site
  stays on the last good deploy). Batch changes. A commit pushed while
  limited is not retried: after the reset, push any real app change
  (notes-only commits are skipped by vercel.json).
- Database changes: the Supabase connector (apply_migration / execute_sql) on
  project `dvcjjcuqmhwdahhaafuy`, **and** append the same SQL to
  `supabase/schema.sql` (kept re-runnable with `if not exists`).
- The Vercel connector could not create/manage the project (it lacked access
  to the `wiltykelpy` scope); the owner does Vercel dashboard steps.
- Commit messages end with the attribution lines the session gives.

## Architecture (short)

- Next.js 15 App Router, TypeScript, no UI library. Styles in
  `app/globals.css` (tokens at the top).
- `middleware.ts` + `lib/session.ts`: password login, signed cookie.
- `lib/connections.ts`, `lib/oauth.ts`, `app/api/auth/*`: Spotify and Google
  sign-in; tokens stored in table `connections`, refreshed automatically.
- Import: `app/api/import` → `lib/importers/spotify.ts`,
  `lib/importers/youtube.ts` → `lib/library.ts` (merges duplicates by a
  simplified "artist|title" key; playlists and items; include/skip choices in
  `source_playlists`; YouTube playlists import only if ≥70% Music category).
  **Spotify import runs in rounds** (Vercel stops requests at 5 min; the
  first import silently stopped at 243 playlists): each POST does ~4 min,
  saves `import_progress`, returns `{done:false, processed, total}`, and
  `components/ImportButton.tsx` keeps calling until done; a new press within
  6 h resumes. Playlists whose Spotify `snapshot_id` matches
  `source_playlists.snapshot` are skipped (Liked Songs uses "count|newest").
  Requests are paced (~3/s). A long Spotify 429 is stored as
  `import_progress.blocked_until` and nothing calls Spotify before then.
  `.github/workflows/import-resume.yml` (hourly) carries on any unfinished
  import via `/api/jobs/import`, signed with an HMAC of the time using the
  existing SUPABASE_SECRET_KEY (middleware lets `/api/jobs/*` through).
- Playback: `components/Player.tsx` (big file; the hub owns the queue,
  shuffle, repeat, Now Playing sheet, queue view). Engines:
  - **YouTube** (default, "YouTube mode"): embedded YouTube IFrame player.
    Needs each song's `tracks.yt_audio_id`. The player is created when the
    app opens (`warmYouTube`) so a Play tap reaches it synchronously (iOS
    needs a tap for sound); `watchYouTubeStart` nudges playVideo() and then
    asks for one tap; `wantPlayRef` resumes on returning to the app.
  - **Spotify** (switch YouTube mode off): Spotify Connect remote control via
    `app/api/play/spotify` and `app/api/player/spotify`; on computers the
    Spotify Web Playback SDK plays in the tab (`app/api/spotify/token`).
    **Queue handoff (2026-11-03):** plays the first song alone, then adds up
    to 30 more to Spotify's own queue (Spotify follows its queue in order and
    keeps playing with the phone locked); leftovers from the last handoff
    (`spotify_queue_state`) are skipped with next. No device → the player
    opens `spotify:` and a keepalive POST with `wait:true` polls devices
    server-side for 45 s, then starts. Untested on the phone yet.
    **Seamless Spotify mode (2026-11-05):** songs without a Spotify ID
    (YouTube playlists, discoveries, radios) get looked up with Spotify search
    before each hand-off (`/api/spotify/match`, `lib/spotifyMatch.ts`, cached
    in `spotify_matches`, ≤12 searches per call; player `findSpotifyVersions`,
    `spotifyMatchRef`); songs Spotify lacks are skipped in the hand-off so
    the music never stops when locked. A Spotify 429 (app time-out) →
    `rate_limited` reply and the player plays that song via YouTube.
    **Imports yield to playback:** 1 request/s, any 429 longer than 10 s
    stops the import for ≥1 h, no import within 3 h of Spotify-mode playback
    (`spotify_queue_state.updated_at`), and the hourly job runs ≤3 rounds.
    (The fast import caused two ~24 h app time-outs, which also block
    Spotify playback: 2026-11-03 and 2026-11-04 → until 11-05 09:35 UTC.)
    **Gentler Spotify mode + diary (2026-11-05, owner: Spotify mode opened
    the Spotify app and never played):** hand-off lines up 10 songs, not 30
    (`QUEUE_SIZE`); the player tops up with `append: true` (next 10, no
    restart) when Spotify is 3 songs from the end of what it was given
    (`runRef.sent`); status polling every 5 s (was 2.5 s). Before playing,
    a phone app that isn't the active player gets playback handed to it
    (`PUT /me/player {device_ids, play:false}`, `makeActive`), and a refused
    play is retried once after that. Waking: the player remembers the wake
    (`wakeRef`); when you come back to the hub it checks once whether
    Spotify is already playing, else sends the start again without waiting.
    **Diary:** every step (devices seen, hand-over, play/queue refusals with
    status + Spotify's reply, started/topped up) is logged to
    `client_events` kind 'spotify' (`logSpotify`):
    `select at, message, detail from client_events where kind='spotify' order by at desc limit 40;`
    **No switching to Spotify (2026-11-05, owner's wish):** the diary showed
    both tries "started" (iPhone found after waking, hand-over 204, play OK,
    10 queued) yet no sound. Now the route checks `/me/player` 1.5 s after
    play; if not playing it nudges once with a plain play, logs
    'playing confirmed' / 'still silent', and returns `confirmed`. The hub
    no longer opens `spotify:` by itself (`wakeSpotify` is unused): when
    Spotify is asleep (`no_device`) or silent, that song plays via YouTube
    right away with a one-time note + optional "Wake Spotify" link; the next
    song tries Spotify again. An iPhone can't be woken without opening the
    Spotify app (no Web Playback SDK on iOS, Connect needs the app running).
    **Three ways to start a song (2026-11-05):** the diary showed that even
    with the iPhone awake and active, `play {uris:[track]}` returned OK and
    `/me/player` then had **no item at all** (not even a wrong song). The
    route now tries methods in turn, checking `/me/player` (playing + the
    wanted id or its linked_from) after each: 'uris'; 'album' (`GET
    /tracks/{id}` → `context_uri` album + `offset.uri` the track; the hub's
    queue plays before the album continues); 'next' (queue the track, then
    skip to it, then seek). The one that works is saved in `taste_settings`
    key 'spotify_method' and tried first next time. None works →
    `confirmed:false` → the hub plays that song via YouTube. The owner's
    tries at 10:18–10:19 UTC still ran the old client (wake/switch path)
    because the app hadn't reloaded after the deploy.
    **In-hub Spotify player on iPhone (2026-11-05 experiment, owner's
    idea):** the Web Playback SDK script now loads on phones too. On
    computers the player is made when the SDK is ready; on phones it's made
    inside the first play tap in Spotify mode (`gesture()` →
    `makeSdkPlayerRef`, `connect()` + `activateElement()` in the tap), and
    `startSpotify` waits up to 6 s (`sdkWaitRef`) for its device id, which
    the server then prefers ("Music Hub (this browser)"). SDK events
    (ready, *_error, autoplay_failed) go to the diary via `clientLog`
    kind 'spotify'. **Owner: it works and is what they wanted** (diary:
    'playing confirmed' via 'uris' on "Music Hub (this browser)").
    **Follow-ups (2026-11-05):** (1) loading glitch: `startSpotify` now
    holds the time at the start position (`startingRef`; the ticker used a
    stale `posRef` → thousands of seconds, full bar), shows a spinner in
    both play buttons while `busy` (`.play-spin`), and only sets playing
    after the start returns. (2) double top-up during the start fixed
    (`runRef.sent` is 0 until the start finishes). (3) screen off: one song
    played locked, then the next didn't start and the lock-screen player
    vanished (iPhone freezes the page when its sound stops). Now a silent
    looping sound (`public/silence.wav`, `keepAwake`, unlocked in the first
    tap) plays under the in-hub player to keep the hub awake; the SDK's
    `player_state_changed` drives the screen (`applySpotify`, shared with the
    poll; no Web API polling while `sdkLiveRef`), and a song that ended with
    nothing after it → `resume()` if Spotify moved on but paused, else the
    hub's next song (`playAt`); pause/resume go straight to the SDK
    (`userPausedRef`). Media Session metadata + lock-screen buttons
    (play/pause/next/previous/seek) for the current song. Not yet tested locked.
    **Lock-screen card (2026-11-05):** iOS showed a blank "Spotify Embedded
    Player" (the SDK's iframe owns the newest sound). `claimLockScreen` restarts
    the silent loop (now `public/silence.mp3`, 60 s; iOS may ignore very short
    sounds) 0.6 s after Spotify starts / changes song / resumes, then re-sets
    metadata + position (`setLockScreen`, `setLockPosition`). Lock-screen button
    presses in Spotify mode are logged as 'lock screen: <action>' in the diary.
    **Stall watchdog (2026-11-05, owner: locked, the song froze ~2 s before
    its end until they tapped play):** the end check used the position from the
    last SDK event (often the song's start), so it never fired; it now adds the
    time since. A 1 s watchdog (`getCurrentState`, `stallRef`) nudges a player
    stuck 2.5 s: resume → near the end `nextTrack()` → start the right song from
    the hub (`nudgeSpotify`); logged as 'stuck (…), nudge n'. `clientLog` now
    allows 80 'spotify' notes per page load (was 20 for everything).
    **Screen follows the song (2026-11-05, owner: mini player / Now Playing
    stayed on the old song):** the watchdog also feeds each `getCurrentState`
    into `applySpotify` (via `applyRef`), so a missed `player_state_changed`
    no longer leaves the screen behind; if Spotify's id isn't in the line-up
    (a relinked copy), it matches by name (`simpleName`), else logs 'playing
    song not in the line-up' once per song.
    **In-hub list mode (2026-11-05, owner's test: after song 1 Spotify played
    "Crush On You" (an old queue leftover), lock-screen skip/previous caused
    overlapping starts and silence):** for the SDK device the hub sends
    `inHub: true` and the route's `startInHub` plays the whole line-up (≤50)
    as one `uris` list (no queue adds), then reads `/me/player/queue` and, if
    old queued songs sit before ids[1], skips past them (≤20 `next`) and plays
    the list again ('cleared old queue'); returns `mode: 'list'` (client sets
    `run.sent = ids.length`, so no top-ups). Next in the hub = SDK
    `nextTrack()` when the next hub song is next in the list (instant); other
    jumps are full starts, one at a time (`startInFlightRef` /
    `pendingStartRef`: presses during a start only change which song starts
    next). List finished and Spotify carries on with its own picks → the hub
    plays its next song ('list finished, hub continues'). Lock-screen claim
    now pauses the silent loop and plays it again 150 ms later, also when the
    watchdog notices a new song (`claimedIdRef`).
    **Leftovers + lock card v2 (2026-11-05, owner: after song 1 BTS "Pied
    Piper" and wave to earth "peach eyes" played; card blank on each new song
    while locked):** the old queue had >20 songs (Spotify lists 20), so the
    route now clears in up to 4 rounds; and in list mode (`run.list`) any song
    not in the hub's list is skipped with SDK `nextTrack()` ('skipping a
    leftover'). Keep-awake is now two silent players (`keepPoolRef`), both
    unlocked in the first tap; a claim starts the spare one and then stops the
    other (a brand-new start, no pause gap). Claims log 'lock card claimed' /
    'lock card claim refused' (first 12 per load) with `hidden`.
    Test 11:54 UTC: the old queue held 54 leftovers (cleared once, ~30 s, then
    starts were quick with 0 leftovers). Claims while locked logged 'claimed'
    (play() allowed, hidden:true) yet the card still went blank, so iOS seems
    to pick Spotify's frame regardless; now claims run 0.6 s, 3 s and 8 s after
    each change. If still blank, it's likely an iOS limit (tell the owner).
    **Rolled back (owner 12:10 UTC: card still blank, glitchier, ±10 s buttons
    instead of skips, time out of sync):** claims now happen only once, 0.6 s
    after the hub itself starts or skips a song; no claims or position updates
    on Spotify's automatic song changes. Blank card on automatic changes =
    accepted iOS limit unless the owner wants more tries.
    **Quicker, steadier starts (owner 12:28 UTC: lag between taps, wrong song
    sometimes, play icon gone instead of a spinner):** `startInHub` no longer
    hands over first (only on a 404), runs shuffle/repeat/save in parallel,
    reads the queue once after 0.5 s (its `currently_playing` confirms) and
    checks `/me/player` once more only if needed (~1.5 s instead of ~4.5 s).
    Client: for 5 s after a start / instant skip, Spotify states that aren't
    the expected list position are ignored (`runStartedAtRef`,
    `expectPosRef`; Spotify briefly still reports the previous song, which
    moved the hub to the wrong song or triggered 'skipping a leftover');
    a stranger must persist 2.5 s before it's skipped (`strangerRef`);
    `playAt` keeps `busy` on through the Spotify version lookup.
    **Reconnect instead of "wake Spotify" (owner 12:55 UTC: the hub asked to
    wake Spotify in the app; diary: 'no device', device list empty, no
    'in-hub player ready' since the app reopened):** `startSpotify` now calls
    `ensureSdkDevice()` (waits for the SDK script, makes the player if
    missing, otherwise `connect()` again, waits up to 8 s for 'ready'; logs
    'reconnecting in-hub player'); `not_ready` logs 'in-hub player dropped
    off'. The route's `findDevice` waits up to 4 s for the named device to
    appear. On phones the YouTube fallback note no longer mentions the
    Spotify app or shows "Wake Spotify".
    **Deep check (2026-11-05, owner: "still sometimes buggy, make it clean and
    responsive"):** (1) **Direct start:** with the in-hub player connected,
    `startSpotify` now plays the list straight from the phone (`directPlay`:
    Spotify Web API with the token from `/api/spotify/token`, cached 40 min,
    retried once on 401; shuffle off / repeat set once per load) instead of
    via `/api/play/spotify` (~0.3 s vs ~1.5 s); logs 'started directly' (first
    5). A 4 s check (bails if the token/index moved or paused; accepts a
    same-name copy) falls back to the server path ('direct start didn’t
    take…', `forceServerRef`). Once per load, 1.2 s after a direct start, the
    phone reads `/me/player/queue`; leftovers before ids[1] → server restart
    ('old queue found…'). `touchServer()` POSTs `{touch:true}` (route saves
    `spotify_queue_state` so imports keep yielding), ≤ every 10 min.
    (2) Server `startInHub` skips only songs before ids[1] (never for a
    one-song list: a one-song start had "cleared" 40 autoplay songs, 26 s).
    (3) `playAt` sets `startingRef` at once in Spotify mode (cleared on the
    YouTube / lookup-failure paths; the start's `finally` clears it only for
    the newest token) and waits only for the current song's Spotify match
    plus ≤1.2 s for the next 40. (4) From an independent code review:
    `applySpotify` ignores time/play/song during the 5 s settle window when
    the reported song isn't the expected one; instant Next bumps `tokenRef`;
    stall nudges and the end-of-song restart skip the settle window / a start
    in progress; a start that lands after you switched to a YouTube song is
    paused (`stopIfLeftBehind`), and `startYouTube` pauses the SDK too.
    **Forgotten player (owner 13:25 UTC: radios kept falling back to YouTube,
    which stops when the app closes; diary: direct play 404 "Device not
    found", device list empty, though matches were found for 90% of songs):**
    Spotify forgets the SDK device while the app sleeps without the SDK
    firing `not_ready`. Now `directPlay` returns 'gone' on 404 →
    `ensureSdkDevice(true)` (disconnect + connect, wait ≤8 s) → retry
    ('player was forgotten, reconnected'). After a YouTube stand-in on a
    phone, `handBackToSpotify` reconnects in the background and, if the song
    is still in its first 45 s, restarts it on Spotify at the same spot
    ('player back, moving this song to Spotify'). On returning to the app the
    phone checks `/me/player/devices` (≤ every 20 s) and reconnects if the
    hub's player is missing ('player missing on return, reconnecting').
- `components/TrackList.tsx` / `TrackRow.tsx`: song lists, row menu (Play
  next, Add to queue, video, links). Round Shuffle (spiral icon) and Play sit
  in each page's title row (`components/PlayButtons.tsx`). The YouTube mode
  switch is only in the Now Playing sheet.
- Library page (`app/library/page.tsx`): views Songs / Artists / Music videos
  and sort/filter chosen from the drop-down `components/FilterMenu.tsx`
  (address settings in `lib/libraryParams.ts`). **Whole library, no caps:**
  SQL `library_page` (any filter/order; `seed` = stable shuffled order) and
  `artist_page` (main artist = first name before , & x feat. ft.), read via
  `lib/libraryQuery.ts` and `/api/library/tracks|artists`. Lists load 200 at
  a time as you scroll (`LibraryList`, `ArtistList`, `MoreLoader`). The player
  takes a `source` ({query, total}) and fetches more songs when <25 remain,
  so Play/Shuffle cover the whole list. `?artist=Name` shows one artist.
- **Hub playlists** (`playlists.service = 'hub'`, imports never touch them):
  `lib/hubPlaylists.ts`, `/api/hub-playlists` (+ `/[id]`, `/[id]/items`).
  "Add to playlist…" panel = `components/PlaylistPicker.tsx` (context in
  layout; opened from song ⋯ menus, Now Playing, a playlist's ⋯ "Add all",
  and Home's "New playlist"). Playlist ⋯ menu (`PlaylistMenu.tsx`): rename,
  delete; songs removable (`HubTrackList.tsx`). Home chip "Mine" shows them.
  Duplicates are skipped when adding. No reordering yet.
  **Playlist Tools Lab pick F2 + M3 + P3 + S2 (2026-11-03):** `playlists.set_aside`
  (any service): Home's dim "Set aside · n" chip (only when non-empty;
  those playlists leave the other chips), "Select" on Home ticks playlists →
  "Set aside" / "Bring back" (`/api/playlists/set-aside`). SQL
  `set_aside_track_ids()` = songs whose every playlist is set aside; they
  drop out of `taste_artists` (so taste page, word radios, tag queue),
  `forgotten_candidates`, and discover.py seeds (`set_aside_track_list`).
  Add to playlist window (`PlaylistPicker.tsx`) = sheet anchored near the
  top (keyboard-safe) with a name search, Recently used 3, then A–Z; no match
  → "New playlist “…”". Options `{verb: Copy|Move, exclude, onAdded}`.
  Playlist pages use `components/PlaylistSongs.tsx`: hold a song ~450 ms
  (TrackRow `onHold`) to select, sticky top bar: Select all, Copy to…, and
  for hub playlists Move to… / Remove (DELETE `{positions}`). Spotify/YouTube
  playlists are copy-only (imports would undo removals).
- `components/BottomNav.tsx`: Home, Discover, Search (= `/library?search=1`),
  Library (owner swapped Search and Discover on 2026-11-03).
- **Discover** (owner's Lab v2 pick **P3 + T5 + W2 + M3 + A1 + E3**):
  `scripts/discover.py` run daily ~6:38 am NY by `.github/workflows/discover.yml`
  makes dated editions in `discover_editions` / `discover_items` and never
  changes them: Daily discover (10, two-row carousel), Monday Discovery (30),
  Friday New Releases (from `discover_releases`; an artist's first scan only
  seeds what's already out, and 45 artists are scanned a day, so the first real
  Friday list needs about a week), Forgotten favorites (SQL
  `forgotten_candidates`), Month mix on the 1st (SQL `month_top_tracks` +
  hearts). New music = YouTube Music "Fans also like" of weighted-random
  library artists (cached in `discover_artists`), skipping library songs and
  anything suggested before (`match_key`). Page `app/discover/page.tsx`,
  edition page `app/discover/[id]`, `components/Discover.tsx` (TodayGrid,
  HeartButton, DiscoverList, ArchiveCalendar), `lib/discover.ts`. Heart =
  `saveTracks` + add to hub playlist "Discoveries". Discoveries play with id
  `disc:<item id>` until hearted. The player POSTs `/api/plays` after 30 s.
  **Radio (E3, 2026-11-03):** `lib/ytRadio.ts` sends YouTube Music's own
  "next" request (WEB_REMIX client, `RDAMVM<videoId>`, no login; probed OK
  from GitHub's servers, not yet confirmed from Vercel's). `/api/radio`
  returns library songs as themselves and new ones as `yt:<videoId>` (saved
  in `radio_songs`; `lib/keepDiscovery.ts` turns `disc:`/`yt:` IDs into real
  songs when added to a playlist or hearted). Player `startRadio` + radioRef
  fetches continuations when <10 songs are left. Dial Familiar/Mixed/New in
  localStorage `mh-radio-mode`. Entry points: song ⋯ menu, Now Playing chip,
  Discover → Radio quick starts. Mood chips not built yet.
  **Saved radios (owner's wish):** every radio started is a `discover_editions`
  row with kind 'radio' (several per day allowed via a partial unique index),
  created by `/api/radio` on start (seed song first) and appended on each
  continuation (`lib/radioEditions.ts`). They show in Past editions (purple
  underline). "Save as playlist" on every edition page and in the Now Playing
  ⋯ menu while a radio plays (`/api/discover/save-playlist`, stores
  `playlist_id`; saving again adds new songs).
- Background finder: `scripts/find_videos.py` (ytmusicapi, unofficial) run by
  `.github/workflows/find-videos.yml` every 3 hours and on demand. Fills
  `tracks.yt_audio_id` (YouTube version for YouTube mode) and
  `tracks.video_id` (official music video). On-demand fallback in the app:
  `lib/videos.ts` → official YouTube search (100 quota units each, ~90/day).

Unused old function: `artist_summary` (replaced by `artist_page`).
Main tables: `tracks`, `track_sources`, `playlists`, `playlist_items`,
`source_playlists`, `connections`; unused so far: `tags`, `track_tags`,
`ratings`, `plays`. See `supabase/schema.sql`.

## Decisions made (don't undo without asking)

- **YouTube-first playback.** Since ~Oct 2026 Spotify's apps ignore a list of
  track URIs from the Web API and play the song's album instead, so Spotify
  mode can't follow the hub's order. The owner **declined** the workaround of
  a "Music Hub queue" playlist in their Spotify account. Spotify mode stays as
  an optional switch.
- Spotify Web API limits (Feb 2026 Development Mode): Premium required, max 5
  users, search 10 results, recommendation/related-artist endpoints gone.
  Discovery will use Last.fm / ListenBrainz instead.
- Never download or store audio files (both services' terms).
- **Chosen look: C10a + F3 + B3 + L1** = Abyss Lagoon colors (bg `#04141A`,
  text pale aqua `#BFEFF2`, muted `#7FA9B3`, accent `#3DDBD9`), Space Grotesk,
  icons-only bottom bar with a dot under the current page, song rows with
  covers. Bottom bar order: Home, Discover, Search, Library.
- YouTube's color in the app is **purple `#B388FF`** (`--youtube`), not red;
  Spotify stays green. Shuffle icon = the long spiral in `lib/icons.ts`
  (about two turns, tail at bottom right; owner drew the shape they wanted).

## Related pages (claude.ai artifacts, owner's account)

- Project plan: https://claude.ai/artifact/H53DjcL69ExgnrmYNjnEee
- Phone setup guide: https://claude.ai/artifact/T2sSRLa1hH4cmqzvi2VDDj
- Look Lab (colors/fonts/bars/lists): https://claude.ai/artifact/QJDbm7KfJhkio31ZTdirrB
- Playlist Sort Lab (sort/group/switch/look for Home playlists): https://claude.ai/artifact/BHWY4jdLiPGqAH6QYXfnQM
- Home Top Lab (header/numbers/services/messages above Playlists): https://claude.ai/artifact/Db76mHuAcsarbFNo88ztzu
- Library Top Lab (numbers/search & filters/video finder/play row): https://claude.ai/artifact/UTVPcvWT74dmoa62gLescy
- Discovery Lab v2 (page/today/weekly/monthly/archive/extras, P·T·W·M·A·E; v1 L·S·W·A·K superseded): https://claude.ai/artifact/1heSnxpkV4WHijeGHv54FH
- Now Playing Lab (artwork/background/title/progress/controls/options, A·G·T·B·C·O): https://claude.ai/artifact/LcYeZ1AkMCLZtxeFBuCQ1x
- Player Icon Lab (skip S, ouroboros repeat R, row icons I, radio D, queue Q, keep K, row layout L): https://claude.ai/artifact/CeDBEAZJqHhY9bWZLxEGps
- Queue Lab (how it opens P, button H, list look L, editing E): https://claude.ai/artifact/XHkfVmvZdjt7F4jqqc73vr
- App Icon Lab (mark M, background B, name N): https://claude.ai/artifact/9NfsRk65axr1MmKkw21Gpu
- Playlist Tools Lab (Set aside folder F, moving M, add-to-playlist window P, multi-select S): https://claude.ai/artifact/LVa34wAaGVwoizVJzvuEf2
- Home Lab (layout L, Playlists/Songs switch T, pinned P, tag filter G, adding tags E): https://claude.ai/artifact/ViRmYrMA6gzqjTwr1C1wMB
- Speed Dial Lab (Home speed dial: look S, contents C, labels T, placement P, tap A, name N; picked S1+C3+T1+P1+A1+N1): https://claude.ai/artifact/6qwGLdZZVYwXLXwpE6aFNo
- Older canvas lab (superseded): https://claude.ai/artifact/AJoM4su4hLjAoMkwHy5xS5

## Current state

- Library imported: ~22,900 songs, 305 playlists (Spotify + YouTube Music),
  but **Spotify was incomplete** (243 of the owner's several thousand) and
  playlist dates were missing, so Home's "Recently updated" sort did nothing.
  Owner asked to re-run Import for Spotify (rounds) and YouTube (dates).
  Spotify time-outs from the import: until 2026-11-04 08:31 UTC, then again
  until 2026-11-05 09:35 UTC (332 of 3,357 playlists done). The import is
  now much slower and pauses while Spotify mode is in use.
  Check: `select * from import_progress;`
- Background finder is still filling YouTube versions (started 2026-11-03,
  expected to cover the library within about a day). Check progress:
  `select count(*) filter (where yt_audio_id is not null), count(*) filter (where yt_audio_status is null) from tracks;`
- Not yet tested by the owner on their phone: the newest player (queue,
  shuffle, Now Playing) and the new look. Ask how it went.

## Next steps (owner's plan)

1. Fix anything the owner reports about the new look / player on iPhone.
   Home playlists use their Playlist Sort Lab pick **S1 + G3 + K1 + P1**
   (`components/PlaylistBrowser.tsx`): Recently updated by default
   (`playlists.last_added_at`, filled on import from Spotify `added_at` /
   YouTube `publishedAt`; YouTube "Liked Music" has no date), Sort
   drop-down, All/Spotify/YouTube Music chips, rows with covers.
   Home top uses their Home Top Lab pick **H2 + T2 + V3 + N2**: small
   "MUSIC HUB" label with round Services (two status dots) and Account
   buttons opening bottom panels (`components/Header.tsx` → `HeaderBar.tsx`,
   used on every page), one line of numbers, pop-up messages that fade
   (`components/FlashToast.tsx`). The "Connected …" message comes from the
   `?connected=` URL parameter after sign-in.
   Library top uses their Library Top Lab pick **T2 + F2 + V4 + A3** with
   changes they asked for: filter button opens a drop-down (not a panel),
   Artists and Music videos views, Shuffle drawn as a spiral. Video finder
   button removed from the page (the background finder does the work).
2. Organization (phase 3): tags, ratings, notes, smart playlists, manual fix
   for wrong song matches.
3. Discovery (phase 4): Last.fm "similar", ListenBrainz scrobbling and
   recommendations, a discovery inbox; the Discover tab is a placeholder.
   Owner's wishes: something served for the day, **nothing disappearing or
   reshuffling** (refreshing lists stress them), weekly/monthly mixes are fun.
   Plan: every edition is dated, frozen and archived in Supabase; hearts copy
   songs to a "Discoveries" playlist. Sources: ListenBrainz (needs the hub to
   submit plays; LB weeklies can run late), ytmusicapi radio/related (gives
   YouTube IDs), own play history for monthly. Research report delivered in
   chat ("Music discovery formats"). Picked P3+T5+W2+M3+A1+E3; stage 1 built
   and first lists made 2026-11-03. Next: E3 radio tuner + mood chips (could
   precompute a candidate pool and YouTube mood playlists in discover.py),
   optional ListenBrainz scrobbling (needs owner's LB account token).
   **Now Playing is built (2026-11-03)**: Now Playing Lab pick
   A2 + G2 + T3 + B2 + C2 + O2 with Player Icon Lab icons
   S13 + R11 + I5 + D21 + Q15 + V2 + K3 + L2 (soft outline triangle skips,
   woven infinity snake repeat drawn bigger than the spiral, hairline +,
   UFO with ribbed fading beam for radio, constellation queue, V9 monolid eye video,
   soft star keep). Icons are exported from the lab into
   `lib/playerIcons.ts` (re-export from the lab when the owner tweaks
   them). Sheet markup in `components/Player.tsx` (.np-* classes in
   globals.css): square cover, YouTube iframe cropped to a square over it
   (`.yt-host.square`), cover-color wash (`.np-wash`, blurred cover), title
   row with star + ⋯ menu (Add to playlist, Start radio, YouTube mode,
   Stop), thin progress line, pale play circle, icon row. Star = `/api/keep`
   (Discoveries playlist, any song). Discover's hearts are now the same
   star. Owner is still tinkering in the lab. Bottom-row icons are sized by
   eye (`.np-row .picon.row-*`; the eye is the biggest).
   **Stability:** owner reported the player "crashing" on page changes and
   adding to playlists. No DB errors found. Added `app/error.tsx` (a failed
   page no longer takes down the layout/player), made the cover wash cheap
   (small element scaled up, no full-screen blur), and the picker only
   refreshes Home/playlist pages. Then found a definite cause: Library
   search was a plain `<form method=get>` (full reload → player lost); now
   `next/form`. Player bar + Now Playing are wrapped in
   `components/SafeBoundary.tsx`. No other full reloads in the code (all
   links are next/link). Remaining possible cause: iOS reloading the app
   under memory pressure (YouTube iframe + many cover images). Ask the
   owner whether it still happens and exactly what they see.
   **Queue (2026-11-03, Queue Lab pick P3 + H3 + L3 + E3):** no pop-up;
   `components/QueueList.tsx` sits under the Now Playing controls and the
   constellation scrolls to it. Header shows "PLAYING FROM <label>"
   (`PlayOptions.from`, default = the page's `main h1`; TodayGrid passes
   "Daily discover", radio "Radio · <song>"). Songs added with Play next /
   Add to queue are copies tracked in `addedRef` (WeakSet) and shown under
   "Next up · added by you"; Add to queue now inserts after the other added
   songs (Spotify-style), not at the very end. Row ⋯: Play next, Move to end,
   Keep in Discoveries, Add to playlist, Remove. Hold ~350 ms then drag to
   move (`moveInQueue`; a dragged song joins the group around it). The fixed
   YouTube iframe follows the cover as the sheet scrolls (`followArt`, CSS
   vars `--np-top` / `--np-clip`). Not yet tried on the phone.
   **Queue cleanup (2026-11-03, after owner said it looked messy and
   dragging wasn't smooth):** Now playing pinned above Up next; flat rows with
   thin dividers (no boxes); drag only by the ≡ grip (`.q-grip`,
   touch-action pan-y, 160 ms still press first so a right-thumb swipe on
   the grips still scrolls the sheet; mouse lifts at once); positions are measured
   once at drag start and other rows slide with transforms, cleared in the
   same render as the reorder; stable row keys (WeakMap). Not yet tried on the phone.
   **Mix pages (Discovery Page Lab pick H2 + A1 + R2 + E3, 2026-11-03):**
   `app/discover/[id]/page.tsx` + `Mosaic`, `MixActions`, `DiscoverList` in
   `components/Discover.tsx` (.mix-* styles): 2×2 cover mosaic, badge + one
   meta line, Play pill + round Shuffle / Radio (seed = playing song if in the
   mix, else random) / Save as playlist, rows with a teal "via" chip, no
   explainer. Keep buttons are the soft star everywhere (owner asked; no hearts). `lib/titles.ts` splits "(feat. …)" into the artist line and drops
   "(Official Audio)"-style noise. Lab: https://claude.ai/chat/e2cba1af-352e-483c-ab48-c8223eb4ad69
   **App icon (App Icon Lab pick M1 + B2 + N1):** spiral on a deep-water
   gradient, named "Music Hub". Source `public/icon.svg` (re-export PNGs with
   rsvg-convert): `app/apple-icon.png` (180), `app/icon.png`, `app/favicon.ico`,
   `public/icon-192/512.png`, `app/manifest.ts`; middleware lets these through
   before login. Owner must delete + re-add the home-screen app to see it.
   **Cover jitter fix:** while the Now Playing sheet is scrolled, the YouTube
   layer gets `data-tucked` (opacity 0, still playing) and the real cover
   `<img>` (now always inside `.np-art`) scrolls natively.
   **Video / studio switch (2026-11-03):** `lib/ytRadio.ts` reads each radio
   entry's counterpart (musicVideoType ATV = studio audio, OMV/UGC = video);
   radios play studio audio with `video_id` = the MV. `/api/youtube/versions`
   (player `findVersions`, once per song per session, in the background)
   fills the missing version, saves it for library songs, and for video-only
   uploads runs a YouTube Music songs search (`searchStudioSong`, title must
   match). An MV standing in for the song switches to studio audio in the
   first 8 s. Eye works for any YouTube song (same id → view change only).
   Not yet confirmed from Vercel or on the phone.
   **Queue history:** "Earlier" section above Now playing (last 3 / Show all);
   Back uses `historyRef` (songs you were on, newest last).
   **Crash work (2026-11-03, owner: player still "crashes" on page changes):**
   likely iOS killing the home-screen app for memory: every list loaded the
   640px Spotify cover. `lib/img.ts` `smallCover()` now swaps in 300px
   Spotify / sized Google / mqdefault YouTube images everywhere small (Now
   Playing keeps full size). Crash log: table `client_events` via
   `/api/client-log` (`lib/clientLog.ts`): window errors, page errors
   (`app/error.tsx`), SafeBoundary glitches, and `restart-while-playing`
   (localStorage `mh-alive` heartbeat every 5 s). Check with
   `select * from client_events order by at desc limit 50;`
   The wide music-video panel above the mini player is gone (owner didn't
   want it); with the sheet closed the YouTube player sits hidden (opacity 0,
   still playing) behind the bar, which shows the cover picture.
   Discover chips read "via “Playlist”" (shortReason drops "From ").
   **Search everywhere (2026-11-03):** Search has "Your library" /
   "Everywhere" (`/library?search=1&where=web`). `lib/ytBrowse.ts` (WEB_REMIX
   search with ytmusicapi filters: songs, artists, albums, community +
   featured playlists; browse VL…/MPRE…/UC…, playlist continuations up to
   500) → `components/WebResults.tsx` and `app/web/[kind]/[id]/page.tsx`.
   `lib/webTracks.ts` `toPlayable()` maps to library songs or `yt:` songs
   (upserted to `radio_songs`, so keep/add-to-playlist saves them). Parsers
   were written against real answers: run the manual workflow
   `probe-ytm.yml` (REST dispatch: `gh api -X POST
   repos/sharkbarnacles/Big-Music/actions/workflows/probe-ytm.yml/dispatches
   -f ref=main -f 'inputs[q]=…'`), then `git fetch origin probe-output`
   (artifact downloads are blocked from the sandbox). Spotify playlist
   search not added (Spotify time-out; Dev Mode search capped at 10).
   **Crash cause found (client_events):** both `restart-while-playing`
   entries were the first page change after a deploy (version skew → full
   reload), not memory. Fix: player state saved every 5 s / on hide and
   restored paused after a restart; notes-only commits no longer deploy.
   **Radio from words (2026-11-03):** Discover → Radio has a words box
   ("A genre, mood or artist…") + idea chips (`IDEAS` in Discover.tsx).
   `/api/radio/seed?q=` = YouTube Music songs search (`searchSongs`); the
   player starts a radio from one of the top 3 with `startRadio(track,
   label)`, named "Radio · <words>" and saved as "Radio: <words>". Discover's
   radio chips use `PlanetIcon` (ringed planet); Now Playing / mix pages
   still use the UFO. Search Everywhere sections are pinned to the screen
   width (`minmax(0,1fr)`), which fixed the zoomed-out page.
   **Radio from words v2 (owner: "niche underground chill thai" gave
   non-Thai, aggressive songs):** a one-song radio drifts, so word radios
   are now built from playlists (`lib/promptRadio.ts`): split origin
   (`ORIGINS`, with script + native names) / moods (`MOODS`, synonyms, weigh
   most) / scene words; several playlist searches; titles scored; for
   scripted languages each playlist must be ≥30% in that script (<60% →
   only in-script songs kept); artists spread out. `/api/radio/prompt` starts
   (`lib/promptRadioRoute.ts`, Familiar/Mixed/New applied, saved edition),
   continuations are `p:<base64 state>` through `/api/radio`. Player
   `startPromptRadio(words)`. Test prompts from GitHub with the manual
   workflow `try-prompt.yml` (results on branch `probe-output`).
   **Taste-aware word radios (2026-11-03):** SQL `taste_artists()` (songs
   saved, distinct playlists ×1.5, plays in 120 days, kept) → `lib/taste.ts`
   (`loadTaste` cached 30 min, similar artists from discover_artists.related
   at 0.6×; `affinity()`). promptRadio picks playlists by title score +
   taste overlap ×12, lifts songs by affinity ×5 (only in-script songs for
   scripted origins), and returns `liked` artists; Familiar/Mixed weave in
   your own songs by them (SQL `library_tracks_for_artists`). Real songs
   only (`isRealSong`: no >12 min / <1 min, no mix/compilation/lofi-beats
   titles or 🎧-style emoji; `curated()` drops one-channel playlists, i.e.
   AI catalogues; `release` song/video/upload ranks official first).
   **One scroller in Now Playing:** `.sheet` has overscroll-behavior:
   contain, and the page behind is pinned (`html.sheet-open`, `--page-y`).
   **Frozen time bar fix:** iOS often skips pointerup on the range input,
   which left `draggingRef` true for the rest of the song. Now `dragSeek` /
   `commitSeek` (pointer/touch/mouse up & cancel, blur, and a 0.6 s idle
   timer), and every new song clears the drag.
   **Zoomed-in Now Playing fix:** text boxes are 16px (iOS zooms the page
   on focusing smaller ones, and the zoom stayed), and `.np-wash` is a
   screen-sized clipping frame with the scaled cover in `::before` (the
   scaled wash was ~1% wider than the screen).
   **Deeper taste (2026-11-03):** `scripts/tag_artists.py` (hourly
   `tag-artists.yml`, ~50 min/run, MusicBrainz 1 req/s, ~8 artists/min)
   fills `artist_profiles` (kind, voice from gender / group members / tags,
   country, area, script of library titles, genres, tags), queue =
   `queue_taste_artists()` (favourites first, priority 100+weight) plus
   radio artists (`queueArtists`, priority 50). SQL `taste_tags()`,
   `taste_overview()`. `lib/taste.ts`: `tags`, `voice` prefs
   (`taste_settings` key 'voice', owner's: thai + chinese → male, a gentle
   lift, never a filter; English neutral), `tagFit`, `songLanguage`,
   `voiceFit`. promptRadio adds tagFit×4 + voiceFit×2.5. Page `/taste`
   (link "Your taste ›" by Discover → Radio): progress, vocal preferences
   (VoicePrefs, `/api/taste/settings`), top artists, genres, countries,
   voices per language. MusicBrainz tags have little mood info; Last.fm
   tags (free key in a GitHub secret) would add moods later if wanted.
   **Style words (owner: "experimental/existential/grungy mandarin" gave old
   ballads):** promptRadio now has `STYLES` (synonyms incl. native terms:
   实验音乐/前卫/后摇/垃圾摇滚/独立…; bare 实验 = "lab/school", see
   `FALSE_STYLE`) and `RELATED` styles (experimental → post-punk, shoegaze,
   alternative, 另類…), both required-ish in titles (missing −5; 2+ related
   count as a match); `OLD` titles (classic/经典/老歌/怀旧…) −7 unless asked;
   ktv/"播放列表"/test titles down; Chinese `notScript` excludes kana/hangul;
   lyric-video re-uploads (動態歌詞, cover, 8D…) aren't songs; artists
   tagged with the style +3; and a consensus check: with a style/mood, a
   playlist sharing no artists with the other candidates −8. `PROMPT_DEBUG=1`
   (set in try-prompt.yml) returns the queries and scored titles.
   **More styles (owner's taste, 2026-11-03):** goth/gothic rock/darkwave,
   post-punk, emo, screamo, metal (metalcore, death metal…), visual kei,
   industrial, cottagecore, plus moods dreamy / soft (dainty, feminine) /
   whimsical, each with native terms (KR/JP/CN/TH/ES/FR/RU) and RELATED
   neighbours. `parse()` now matches whole phrases ("visual kei",
   "melodic metalcore") before single words. With a style asked, a
   favourite is only lifted if tagged with it (untagged ×0.3). No language
   named → a mix is fine (country playlists −1, was −4). Owner's languages:
   main English + Korean; branches Japanese, Chinese, Thai, Filipino,
   Spanish, French, Russian (`taste_settings` 'languages'); Daily discover's
   `weighted_seeds` weights artists ×1 main, ×0.35 branch, ×0.5 other
   (language from title script or MusicBrainz country).
   **Taste everywhere + skips (2026-11-05, owner: "everything should be with
   my taste in mind … help me branch out"; skips yes, but tapping around the
   queue to peek must not count):** `lib/tasteRank.ts` `tasteOrder()` now
   ranks song radios (`/api/radio`, start keeps the seed first, and
   continuations) and playlist radios (`lib/playlistRadio.ts`): 1.1×tagFit +
   0.7×affinity + `languageFit` (main +0.35, branch +0.1, other −0.5) +
   0.35×voiceFit − 1.6×`skipPenalty` − filler (isRealSong) − 0.012×YouTube
   rank; drops filler and artists skipped often (≥0.8), the worst sixth on
   batches >12, no artist twice within 3; unknown artists → tagging queue.
   Word/similar radios subtract skipPenalty too. **Skips:** table `skips`
   (created 2026-11-05 via execute_sql, in schema.sql), `/api/skips`; player
   `reportSkip()` on Next (button or lock screen) only if the song wasn't
   picked by you (`startedByRef` 'tap' covers any tap incl. queue peeks;
   'next'/'auto' otherwise), played ≥8 s and ≤ min(half, 2 min).
   `loadTaste()` (cache now 10 min) adds `skips` (decayed, half-life 30 d,
   first skip free, loved artists judged gently) and `languages`.
   `discover.py` leaves out related artists with ≥3 decayed skips.
   **Word radios from your corner (2026-11-05, owner: word radios "often felt
   random and unfitting"; e.g. "dreamy rainy night" → 2000s R&B, "Rainy day"
   → nu metal, "beautifully my music taste" → generic classic hits):**
   `lib/tasteNeighbourhood.ts`: moods → genre tags (`MOOD_TAGS`), styles →
   their words + RELATED; your top 300 artists whose MusicBrainz tags contain
   a wanted tag (`tagHits`, one-way match) are picked weighted (hits² ×
   liking, × (1−skip)), 5 of their library songs (with yt_audio_id) seed
   YouTube Music radios, woven ("v:<id>" seeds go into `state.used`). In
   `promptRadio`: runs alongside the playlist search when there's a mood or
   style (with an origin only if it has a script; songs kept only in that
   script); `TASTE_ME` prompts ("my taste", "for me"…) use only this, with
   every artist you like. Playlists: dropped if <8% of their first 40 songs
   are near you (no origin asked), −10 if their known artists' genres miss
   the mood (≥5 known, <15%), +6×near. Playlist songs by far artists are
   dropped once your corner has ≥25 songs. Final order weaves about 3 songs
   from your corner to 2 from playlists. Tested with try-prompt.yml on
   dreamy rainy night / Rainy day / dark goth / happy summer / experimental
   mandarin / chill thai / sad korean indie / my music taste.
   **Similar-artist radios:** "similar to / like / sounds like / artists
   like / fans of <artist> [but <words>]" (`lib/similarRadio.ts`): YouTube
   Music artist search (`searchArtists`), its "Fans might also like" →
   top 4 songs of ~10 related artists per batch (+2 of the named artist
   early), continuation walks outwards (state `todo`/`seed` in the `p:`
   token); taste + tagFit lift, extra words favour artists tagged with them.
   **Home Lab pick L3 + T3 + P2 + G2 + E3 (2026-11-05):** `components/PlaylistBrowser.tsx`
   + `app/page.tsx`. T3: two-icon switch at the start of the controls line,
   Playlists ↔ Songs (`/?view=songs`, last choice in cookie `mh-home-view`;
   Songs = `library_page` with `?ssort=` recent/artist/title). P2: pinned
   playlists (`playlists.pinned_at`, oldest pin first) as 2-column quick
   tiles above the controls; Pin/Unpin in Home's Select bar and the playlist
   ⋯ menu (`/api/playlists/pin`, `lib/playlistTags.ts`). L3: "Recently
   updated" shelf (12 covers) then "All playlists". G2: "Tags" button →
   tick-box menu; several = playlists with all of them; in Songs view the
   songs from those playlists (`library_page(tag_ids uuid[])`, `?tags=id,id`).
   E3: tags = existing `tags` table (color = palette name teal/purple/amber/
   rose/blue/green, `--tag-*` in globals.css) + new `playlist_tags`;
   `components/TagSheet.tsx` (Select → "Tag…", and "+ Tag" on playlist
   pages via `PlaylistTags.tsx`, pills tap to remove); `/api/playlists/tags`.
   Home now reads all playlists page by page (`fetchAllRows`, >1,000 safe).
   The SQL was run by the owner in Supabase's SQL Editor (the connector's
   confirmation auto-cancels on the phone; setup page
   https://claude.ai/artifact/QWYqPLMeZdxnmZyWHtVkY6), checked 2026-11-05.
   If a migration is needed again, try the connector first, else a page like that.
   **Playlist radios + 50-song radios (2026-11-05):** UFO button left of
   Shuffle on every playlist page (`PlayButtons` `radio` prop → player
   `startPlaylistRadio`). `lib/playlistRadio.ts`: YouTube Music radios from 5
   random songs of the playlist at once, woven one-from-each, the playlist's
   own songs left out; top-ups are `pl:<state>` tokens (seeds used so far)
   through `/api/radio`; start route `/api/radio/playlist?id=` saves an
   edition "Radio: <playlist>" / "from your playlist". The dial logic moved
   to `lib/radioTracks.ts` (`toRadioTracks`). **Every new radio starts with
   50 songs** (`RADIO_SIZE`; owner chose "start with 50, keep going"): song
   radios fetch continuations until 50 (seed + 49), word radios run up to
   2 extra batches, playlist radios up to 3 rounds; they still top up as you
   listen (~25 more for playlist radios).
   **Smoother scrolling (2026-11-05, owner: queue scrolling from mid-screen
   still sticky):** the non-passive window `touchmove` listeners (queue and
   playlist drag) now exist only while a song is lifted, so normal scrolls
   never wait on JS; queue rows were never draggable except by the grip.
   The YouTube layer (`.yt-host`) ignores touches so a swipe starting on the
   cover/video scrolls the sheet, except while the "one tap to start the
   sound" notice shows (`data-needs-tap`).
   **Playlist edit mode + reorder (2026-11-05):** holding a song (400 ms)
   on a playlist page opens edit mode (`components/PlaylistSongs.tsx`): the
   song is ticked and, in hub playlists, picked up so the same finger drags
   it; every row also gets a ≡ grip (`TrackRow` `grip`, `.edit-grip`,
   touch-action none). Drag engine moves DOM nodes directly (no re-render per
   move): row centers measured at start, others slide by the lifted row's
   height, window touchmove is non-passive so the page doesn't scroll, and
   it auto-scrolls near the top (160 px) / above the player. Order saves
   700 ms after a drop via PATCH `/api/hub-playlists/[id]/items {order}`
   (`reorderHubPlaylist`: writes the new order at fresh positions after the
   old ones, then deletes the old rows, so nothing can be lost; returns the
   new positions, which the page maps in). Move/Remove/Done flush the save
   first; leaving the page sends it with keepalive. Spotify/YouTube
   playlists: hold opens edit mode for selecting/copying only. Tag pills
   show their × only in edit mode (window event `mh-playlist-edit`).
   **Library switch + artist pages (2026-11-05):** Library's search line
   starts with the same two-icon switch (`LibrarySwitch` links);
   `/library?view=playlists` renders `PlaylistBrowser` with `base="/library"`
   (its switch goes back to `/library`; tags in `?tags=`). Playlist cards come
   from `lib/playlistCards.ts` (shared with Home). Now Playing's artist name
   is a button (`splitArtists`; several artists → small menu) → `/artist?name=`
   (`app/artist/page.tsx`: YouTube Music artist search, best name match →
   redirect to `/web/artist/<UC…>?name=`). The artist page now shows Top
   songs, then Albums / Singles & EPs first (with "See all ›" when YouTube
   Music has a discography page: header browseEndpoint pageType
   MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY, `MPAD<channel>` + params →
   `/web/discography/<id>?p=&t=&a=`, `browseDiscography` walks every
   musicTwoRowItemRenderer; probed on The Cure: 29 albums), the rest, and
   "In your library" (your songs by that name, `library_page` main_artist).
   `probe_ytm.mjs` now also saves artist discography pages.
   **Radios chip (2026-11-05, owner's wish):** in the playlist chips line
   (Home + Library playlists, `PlaylistBrowser`) a "Radios" chip with the UFO
   icon sits right after "Mine" (`show === 'radios'`, remembered like the
   others): it replaces the shelf/list with every saved radio
   (`components/RadioList.tsx`, data from `/api/radios` → `lib/radioList.ts`
   `loadRadios`: 2×2 cover mosaic, song count, date, subtitle; "Find a radio"
   box when >8; tap = `/discover/<id>`, round button = play via
   `/api/speed-dial/play?radio=`). `/library?view=radios` shows the same list.
   (A first version put a pill by Library's numbers line; owner wanted it here.)
   **Jump back in (Speed Dial pick S1 + C3 + T1 + P1 + A1 + N1, 2026-11-05):**
   `components/SpeedDial.tsx` at the top of Home's playlist view only
   (`PlaylistBrowser` `dial` prop; not in Library, not while selecting):
   chips Radios / Albums / Artists / Songs (last one in localStorage
   `mh-dial-kind`), 3×2 grid, badge under each name. Owner's change: the
   round play button on the cover plays at once; anywhere else opens the
   radio (`/discover/<id>`), album (`/album?name=&artist=` →
   `lib/findAlbum.ts` YouTube Music album search → `/web/album/MPRE…`) or
   artist (`/artist?name=`); songs have no page, so a tap plays them (then
   your other recent songs). Data `lib/speedDial.ts`: radios = newest 6
   radio editions; songs/albums/artists from `plays` (60 days; album needs
   2 songs or 3 plays, artist 2 plays). Play: `/api/speed-dial/play`
   (?radio= edition songs, ?album= whole YouTube album else your songs,
   ?artist= your songs by them shuffled through the player's `source`).
4. Polish: (done: reorder songs in hub playlists)
   save the current queue as a playlist.

## Session log

- 2026-11-02 → 11-03: Planned the app, built phase 1 (import, duplicate
  merging, music-only YouTube filter, music videos), set up Supabase, GitHub,
  Vercel, Spotify and Google from the owner's phone; built playback (hub
  queue, YouTube mode, Spotify Connect), made YouTube mode the default after
  Spotify's album issue; ran the design labs and applied the chosen look;
  added this file. Services box on Home now folds; status-bar strip for the
  home-screen app; built the Playlist Sort Lab. Applied the Playlist Sort,
  Home Top and Library Top picks; added Artists / Music videos views and the
  spiral Shuffle. Removed the 200-song caps (scroll loads all; player
  continues through the whole list) and added hub playlists.
- 2026-11-03: Longer spiral Shuffle icon (`lib/icons.ts`), YouTube color
  red → purple, built the Discovery Lab.
  Spotify import now resumable in rounds with unchanged-playlist skipping.
  Bigger spiral; Home Sort + chips on one line, 'YouTube' label, muted
  source dots. Discovery research + Lab v2.
  Spotify pause handling + hourly resume job. Discover stage 1 (daily job,
  dated editions, hearts, archive calendar, play counting).
  Self-hosting research (declined). Spotify queue handoff + auto-wake.
  Fixed adding Discover songs to playlists. Radio from any song.
  YouTube start without tapping the video; Now Playing Lab.
  Now Playing pick A2+G2+T3+B2+C2+O2; Player Icon Lab (ouroboros repeat).
  Icon Lab rounds 2–4: triangles, infinity snakes (woven/striped), space
  radio, queue and keep icons; Discover reasons shortened; nav reordered.
  Icon Lab: queue/constellation, eye video, UFO radio + beam textures,
  balanced spiral vs snake. Pick S13+R11+I5+D16+Q15+V2+K3+L2.
  Built the Now Playing redesign + chosen icons; keep star everywhere.
  Stability fixes (error.tsx, lighter wash, fewer refreshes); V9 eye.
  Radios saved to Past editions + Save as playlist; Queue Lab.
  Player crash fix: in-app search form (was reloading), SafeBoundary.
  Queue Lab pick built: Up next under controls, playing-from header,
  grouped list, per-song ⋯ menu, hold-and-drag reorder.
  Mix page redesign (H2+A1+R2+E3) and queue cleanup (grip drag, flat list).
  App Icon Lab.
  Cover jitter fix (video hides while scrolling); app icon M1+B2+N1.
  MV ↔ studio audio switch, Earlier songs in the queue, Back = real history.
  Queue grips no longer block scrolling (short press before a song lifts).
  Smaller covers in lists (crash suspect), crash log, no video panel over the bar.
  'via' chips without 'From'; mini player shows the cover, not the tiny YouTube player.
  Search Everywhere: YouTube Music songs/artists/albums/playlists + pages.
  Crash = deploy restarts: player now comes back after a restart; notes-only commits skip deploys.
  Radio from words + idea chips, planet icon on Discover, Search Everywhere layout fix.
  Word radios rebuilt from matching playlists (origin/language + mood aware), tested on 9 prompts.
  Taste profile + real-artists-only word radios; Now Playing scroll no longer leaks to the page.
  Time bar no longer freezes after touching it on iPhone.
  Zoomed-in pages fixed (16px text boxes, clipped colour wash).
  Deeper taste: MusicBrainz artist tagging job, vocal preference per language, Your taste page.
  Style-aware word radios (experimental/grunge/indie… in English and natively), consensus check, no oldies unless asked.
  Goth/emo/metal/visual kei/cottagecore… styles; Daily discover leans English + Korean.
  Similar-artist radios ("similar to Silica Gel").
  Playlist Tools F2+M3+P3+S2 built: Set aside folder (out of taste), searchable add window, hold-to-select move/copy/remove
- 2026-11-05: Seamless Spotify mode (Spotify versions of YouTube-only songs, skip what Spotify lacks, YouTube fallback during time-outs); import slowed and yields to playback.
- 2026-11-05: Home Lab; built pick L3+T3+P2+G2+E3 (Songs switch, pinned tiles, shelf, playlist tags).
- 2026-11-05: Home shelf edge room; radios from whole playlists (UFO by Shuffle); every radio starts with 50 songs.
- 2026-11-05: Hold a song = edit mode; drag to reorder hub playlists (grip or hold-and-drag), order saves itself.
- 2026-11-05: Smoother scrolling in Now Playing/queue (no always-on touch listeners; swipes pass through the video).
- 2026-11-05: Library playlists/music switch; tap artist in Now Playing → artist page with discography (See all) + your songs; Speed Dial Lab.
- 2026-11-05: Jump back in speed dial on Home (radios/albums/artists/songs, play button plays, tap opens).
- 2026-11-05: Gentler Spotify mode (10-song hand-off + top-ups, 5 s polling), hand playback to the phone before playing, retry after waking, Spotify diary.
- 2026-11-05: Spotify mode never switches apps (asleep/silent → YouTube for that song), play is confirmed and nudged once.
- 2026-11-05: Spotify start tries uris → album+offset → queue+next, remembers what works.
- 2026-11-05: Experiment: Spotify's in-hub player (Web Playback SDK) on iPhone, started from the first Play tap.
- 2026-11-05: In-hub Spotify: loading spinner + steady time while starting, no double top-up, keep-awake sound + end-of-song handling for screen-off, lock-screen controls.
- 2026-11-05: Lock screen shows the hub's song card (title, artist, cover) in in-hub Spotify mode; its buttons drive the hub queue.
- 2026-11-05: In-hub Spotify: fixed end-of-song check, watchdog nudges a stuck player (resume → skip → restart from the hub).
- 2026-11-05: In-hub Spotify: mini player / Now Playing follow the song every second (watchdog state + name match).
- 2026-11-05: In-hub Spotify plays the hub's line-up as one list (old Spotify queue skipped), instant skip, one start at a time, lock card re-claimed on each song.
- 2026-11-05: In-hub Spotify: clears long old queues, skips leftovers itself, lock card claimed by switching between two silent players.
- 2026-11-05: Lock card claimed three times after each song change (old 54-song queue cleared once).
- 2026-11-05: Lock card: back to one claim when the hub starts/skips (repeated claims made it flip and lose skip buttons).
- 2026-11-05: In-hub Spotify: faster starts, no wrong-song jumps right after a tap, spinner stays during loading.
- 2026-11-05: Library: Radios pill → list of every radio you've made (play button, opens its page).
- 2026-11-05: In-hub Spotify reconnects by itself when it dropped off (no more "wake Spotify" on the phone).
- 2026-11-05: Radios moved to a chip after "Mine" in the playlist chips (Home and Library).
- 2026-11-05: Playback deep check: direct Spotify start from the phone, no autoplay "clearing", lookup no longer blocks taps, review fixes (settle window, stale timers, double sound).
- 2026-11-05: In-hub Spotify: reconnects when Spotify forgot the player (no more YouTube stand-ins), moves a stand-in song back to Spotify.
- 2026-11-05: Taste in every radio (song + playlist radios ranked by your tags, artists, languages, voices), skips learned (Next on songs you didn't pick), Discover avoids often-skipped artists.
- 2026-11-05: Word radios built from your own corner of music in that mood (your artists' genres → seed radios), playlists must be near your taste and sound like the mood; "my taste" prompts use only your music.
