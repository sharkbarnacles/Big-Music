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
- Playback: `components/Player.tsx` (big file; the hub owns the queue,
  shuffle, repeat, Now Playing sheet, queue view). Engines:
  - **YouTube** (default, "YouTube mode"): embedded YouTube IFrame player.
    Needs each song's `tracks.yt_audio_id`.
  - **Spotify** (switch YouTube mode off): Spotify Connect remote control via
    `app/api/play/spotify` and `app/api/player/spotify`; on computers the
    Spotify Web Playback SDK plays in the tab (`app/api/spotify/token`).
- `components/TrackList.tsx` / `TrackRow.tsx`: song lists with Play, Shuffle,
  the YouTube mode switch, row menu (Play next, Add to queue, video, links).
- `components/BottomNav.tsx`: Home, Search (= `/library?search=1`), Discover
  (placeholder), Library.
- Background finder: `scripts/find_videos.py` (ytmusicapi, unofficial) run by
  `.github/workflows/find-videos.yml` every 3 hours and on demand. Fills
  `tracks.yt_audio_id` (YouTube version for YouTube mode) and
  `tracks.video_id` (official music video). On-demand fallback in the app:
  `lib/videos.ts` → official YouTube search (100 quota units each, ~90/day).

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
  covers. Bottom bar order: Home, Search, Discover, Library.

## Related pages (claude.ai artifacts, owner's account)

- Project plan: https://claude.ai/artifact/H53DjcL69ExgnrmYNjnEee
- Phone setup guide: https://claude.ai/artifact/T2sSRLa1hH4cmqzvi2VDDj
- Look Lab (colors/fonts/bars/lists): https://claude.ai/artifact/QJDbm7KfJhkio31ZTdirrB
- Playlist Sort Lab (sort/group/switch/look for Home playlists): https://claude.ai/artifact/BHWY4jdLiPGqAH6QYXfnQM
- Older canvas lab (superseded): https://claude.ai/artifact/AJoM4su4hLjAoMkwHy5xS5

## Current state

- Library imported: ~22,900 songs, 305 playlists (Spotify + YouTube Music).
- Background finder is still filling YouTube versions (started 2026-11-03,
  expected to cover the library within about a day). Check progress:
  `select count(*) filter (where yt_audio_id is not null), count(*) filter (where yt_audio_status is null) from tracks;`
- Not yet tested by the owner on their phone: the newest player (queue,
  shuffle, Now Playing) and the new look. Ask how it went.

## Next steps (owner's plan)

1. Fix anything the owner reports about the new look / player on iPhone.
   Waiting on their pick from the Playlist Sort Lab (four codes like
   "S1 + G3 + K1 + P1") to build Home's playlist sorting/grouping. Real
   "recently updated" needs a stored date per playlist (e.g. newest item
   added_at from Spotify / publishedAt from YouTube) — not stored yet.
2. Organization (phase 3): tags, ratings, notes, smart playlists, manual fix
   for wrong song matches.
3. Discovery (phase 4): Last.fm "similar", ListenBrainz scrobbling and
   recommendations, a discovery inbox; the Discover tab is a placeholder.
4. Polish: installable home-screen app (PWA), Library paging beyond 200 rows
   (Play/Shuffle on the Library page currently use only the 200 shown).

## Session log

- 2026-11-02 → 11-03: Planned the app, built phase 1 (import, duplicate
  merging, music-only YouTube filter, music videos), set up Supabase, GitHub,
  Vercel, Spotify and Google from the owner's phone; built playback (hub
  queue, YouTube mode, Spotify Connect), made YouTube mode the default after
  Spotify's album issue; ran the design labs and applied the chosen look;
  added this file. Services box on Home now folds; status-bar strip for the
  home-screen app; built the Playlist Sort Lab.
