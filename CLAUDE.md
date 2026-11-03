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
    server-side for 45 s, then starts. Untested on the phone yet (Spotify
    time-out until 2026-11-04 08:31 UTC). Discoveries have no Spotify IDs, so
    they still need YouTube mode.
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
- Older canvas lab (superseded): https://claude.ai/artifact/AJoM4su4hLjAoMkwHy5xS5

## Current state

- Library imported: ~22,900 songs, 305 playlists (Spotify + YouTube Music),
  but **Spotify was incomplete** (243 of the owner's several thousand) and
  playlist dates were missing, so Home's "Recently updated" sort did nothing.
  Owner asked to re-run Import for Spotify (rounds) and YouTube (dates).
  2026-11-03: Spotify put the app on a ~21 h time-out (until 2026-11-04
  08:31 UTC); the hourly job resumes the Spotify import after that by itself.
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
   Now Playing: owner picked **A2 + G2 + T3 + B2 + C2 + O2** in the Now
   Playing Lab (square cover, color wash, title with heart + ⋯, thin progress
   line, lighter play circle, icon row with YouTube mode/Stop in ⋯) but wants
   sleeker icons first. Player Icon Lab pick (2026-11-03):
   **S13 + R11 + I5 + D16 + Q15 + V2 + K3 + L2** = soft outline triangle
   skips, woven tapering infinity snake for repeat (drawn ~1/3 bigger than
   the spiral so they look balanced), hairline row icons with a plain +,
   UFO with beam for radio, constellation for queue, eye for video, soft
   star replacing the heart (solid when kept), icons only. Owner asked for
   beam texture options (D21–D27, no outlines) and may swap D16 for one.
   The lab's drawing code (icon-lab artifact) has the exact SVG paths to
   copy into `lib/icons.ts`. Not built into the app yet.
4. Polish: installable home-screen app (PWA); reorder songs in hub playlists;
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
