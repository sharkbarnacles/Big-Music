# Music Hub — Phase 1: Library import

Your Spotify and YouTube Music playlists, imported into one database you own.

**What works in this phase**
- Log in with your own password (only you can get in).
- Connect Spotify and YouTube Music.
- Import Liked Songs / Liked Music and all your playlists.
- The same song on both services is merged into one entry.
- Browse playlists, search your whole library, see which songs are on both services.
- **Music only from YouTube:** playlists of regular videos are left out automatically, and you can tick or untick any playlist yourself.
- **Music videos:** each song can be linked to its official YouTube music video, even songs you only have on Spotify. Filter and sort your library by "has music video".

**Coming next:** phase 2 adds playback inside the app.

Setup takes about 30–45 minutes the first time. You do it once.

---

## How the pieces fit

| Piece | What it is | Why you need it |
| --- | --- | --- |
| **Node.js** | Program that runs JavaScript on your computer | Runs the app |
| **Supabase** | Free online database | Stores your library |
| **Spotify Developer app** | Permission slip from Spotify | Lets your app read your Spotify playlists |
| **Google Cloud project** | Permission slip from Google | Lets your app read your YouTube playlists |
| **`.env.local` file** | A text file of secret keys | Tells your app how to reach all of the above |

---

## Step 1 — Install Node.js

1. Go to https://nodejs.org and download the **LTS** version (22 or newer). Install it.
2. Check it worked. Open **Terminal** (Mac) or **PowerShell** (Windows) and type:
   ```
   node -v
   ```
   You should see something like `v22.x.x`.

## Step 2 — Unzip the project

1. Unzip `music-hub.zip` somewhere easy, like your Documents folder.
2. In Terminal, move into the folder:
   ```
   cd ~/Documents/music-hub
   ```
3. Make your secrets file by copying the example:
   ```
   cp .env.example .env.local
   ```
   (Windows PowerShell: `copy .env.example .env.local`)

Open `.env.local` in any text editor. You'll fill it in over the next steps.

## Step 3 — Pick your app password and session secret

In `.env.local`:
- `APP_PASSWORD` → the password you'll use to log in to your app.
- `SESSION_SECRET` → a long random string. Generate one in Terminal:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Copy the output and paste it in.

## Step 4 — Create the database (Supabase)

1. Sign up at https://supabase.com and click **New project**. Any name, choose a region near you, set a database password (save it somewhere).
2. Wait about a minute for it to finish.
3. Open **SQL Editor** (left sidebar) → **New query**.
4. Open `supabase/schema.sql` from the project, copy everything, paste it in, click **Run**. You should see "Success".
5. Go to **Project Settings → API Keys** (sometimes called **API**):
   - Copy the **Project URL** → `SUPABASE_URL`
   - Copy the **secret** key (starts with `sb_secret_`), or the older **service_role** key → `SUPABASE_SECRET_KEY`

> ⚠️ The secret key can read and change your whole database. Never paste it into code, chats, or GitHub.

## Step 5 — Create the Spotify app

1. Go to https://developer.spotify.com/dashboard and log in with your Premium account.
2. Click **Create app**.
   - Name/description: anything (e.g. "Music Hub").
   - **Redirect URI**: `http://127.0.0.1:3000/api/auth/spotify/callback` → click **Add**.
   - Under "Which API/SDKs", tick **Web API** and **Web Playback SDK**.
   - Accept the terms → **Save**.
3. Open the app → **Settings**. Copy **Client ID** → `SPOTIFY_CLIENT_ID`. Click **View client secret**, copy → `SPOTIFY_CLIENT_SECRET`.
4. In **User Management**, add your own Spotify name and email (the email on your Spotify account). Apps in Development Mode only work for listed users.

## Step 6 — Create the Google / YouTube project

1. Go to https://console.cloud.google.com and sign in with the Google account you use for YouTube Music.
2. At the top, click the project picker → **New project** → name it "Music Hub" → **Create**. Make sure it's selected.
3. **Turn on the YouTube API:** search the top bar for **YouTube Data API v3** → open it → **Enable**.
4. **Set up the consent screen:** left menu **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**).
   - User type: **External**. App name: "Music Hub". Support and developer email: yours.
   - Under **Audience** (or **Test users**), add your own Gmail address as a test user.
   - Leave it in **Testing** mode.
5. **Create the login credentials:** **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** → add `http://127.0.0.1:3000/api/auth/google/callback`
   - **Create**. Copy **Client ID** → `GOOGLE_CLIENT_ID` and **Client secret** → `GOOGLE_CLIENT_SECRET`.

> In Testing mode, Google makes you reconnect YouTube about once a week. That's normal — just press **Reconnect** on the home page. (It goes away if you later "publish" the app in the consent screen; for one personal user that's optional.)

## Step 7 — Install and run

Back in Terminal, inside the `music-hub` folder:

```
npm install
npm run dev
```

The first command downloads the code libraries (takes a minute, only needed once). The second starts your app.

Open **http://127.0.0.1:3000** in your browser.

> Use `127.0.0.1`, not `localhost`. Spotify only accepts that address, and the login cookie is tied to it.

## Step 8 — Use it

1. Log in with your `APP_PASSWORD`.
2. Click **Connect** on Spotify → approve. Then **Import playlists**.
3. Click **Connect** on YouTube Music → pick your account → approve (Google will warn the app is unverified: click **Continue** — it's your own app). Then **Import playlists**.
4. Open **Library** to search everything, or tap **Show only songs found on both services**.

Run **Import playlists** again any time to pick up changes. To stop the app, press `Ctrl + C` in Terminal.

## Step 9 — Pick which playlists to keep

After the first import, click **Choose which playlists →** under a service.

- **YouTube Music:** each playlist shows what share of it is music. Every YouTube video has a category, and "Music" is one of them. A playlist is ticked automatically when **at least 70%** of it is music, and the non-music videos inside it are dropped.
- If you tick a playlist yourself, **everything** in it is kept, music or not.
- **Spotify:** everything is ticked; untick playlists you follow but don't want.
- Click **Save choices**. Unticked playlists disappear from your library right away (they stay on Spotify/YouTube). Newly ticked ones arrive on the next **Import playlists**.

## Step 10 — Find music videos

Songs imported from YouTube that are already a music video get marked automatically. For the rest, there are two ways to look them up. Results show as a **▶ Video** badge, and the **Library** page can filter to "Has music video" or sort videos first.

**Option A — the script (recommended, fast).** Uses YouTube Music's own links between each song and its video. No daily limit and no Google login.

1. Install Python 3.10 or newer from https://python.org (Mac users may already have it: check with `python3 --version`).
2. In the `music-hub` folder, once:
   ```
   pip install -r scripts/requirements.txt
   ```
   (On Mac, use `pip3` and `python3` if `pip` isn't found.)
3. Run it:
   ```
   python scripts/find_videos.py
   ```
   It prints each song as it goes (✓ = video found, · = none). Run it again after future imports to check new songs. Add `--recheck` to retry songs where nothing was found.

> This uses `ytmusicapi`, an unofficial library. It only searches public YouTube Music data, but it can break when Google changes YouTube Music. If it starts failing, run `pip install -U ytmusicapi`.

**Option B — the button in the app (official, slow).** On the **Library** page, **Find videos for 40 songs** uses YouTube's official search. Each search costs 100 of your 10,000 daily quota units, so that's about 2 clicks (80–100 songs) per day.

**Spotify music videos:** Spotify doesn't make its videos available to outside apps, so all videos come from YouTube.

---

## Good to know

- **What gets imported from Spotify:** Liked Songs, playlists you made, and playlists you follow. Spotify blocks apps from reading some of its own playlists (like Discover Weekly); those are listed as "skipped".
- **What gets imported from YouTube Music:** playlists you created, plus liked songs (liked videos in YouTube's Music category). Albums and playlists you only *saved* from others aren't available through the official API.
- **How duplicates are merged:** songs are matched by simplified artist + title, so "Get Lucky (feat. Pharrell) – Radio Edit" and "Get Lucky" count as one. YouTube has no artist field, so the app guesses from the channel name or "Artist - Song" titles. A few mismatches are expected; phase 3 adds manual fixing.
- **Nothing is ever changed** on your Spotify or YouTube accounts. The app only reads.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Missing setting …` error | That line in `.env.local` is empty. Fill it and restart (`Ctrl + C`, then `npm run dev`). |
| Spotify: "INVALID_CLIENT: Invalid redirect URI" | The redirect URI in the Spotify dashboard must match exactly: `http://127.0.0.1:3000/api/auth/spotify/callback` |
| Spotify import error 403 | Add yourself under **User Management** in the Spotify dashboard (Step 5.4). |
| Google: "redirect_uri_mismatch" | Same idea: the URI in Google Credentials must match exactly. |
| Google: "Access blocked … has not completed verification" | Add your Gmail as a **test user** (Step 6.4). |
| "Database error … relation does not exist" | Run `supabase/schema.sql` in the Supabase SQL Editor (Step 4.4). |
| "state_mismatch" after connecting | You opened the app at `localhost`. Use `http://127.0.0.1:3000`. |
| YouTube "Reconnect" needed | Normal about weekly in Google's Testing mode. Click Reconnect. |
| "… did you re-run schema.sql?" | You set up the database before this update. Run `supabase/schema.sql` again in the SQL Editor; it's safe and keeps your data. |
| A music playlist was left out | Open **Choose which playlists →** and tick it. Some music is uploaded under other categories (like Entertainment). |
| Wrong video matched | Rare, since both title and artist must match. Phase 3 adds a way to fix or remove it. |

## Project map

```
app/                     Pages and server routes
  page.tsx               Home: connections, import buttons, playlists
  library/page.tsx       Search all songs
  playlists/[id]/        One playlist's songs
  choose/                Tick which playlists to import
  login/                 Password screen
  api/auth/…             Spotify & Google sign-in
  api/import/            Runs an import
  api/playlist-choices/  Saves your ticks
  api/videos/find/       Official YouTube search for videos
lib/
  importers/spotify.ts   Reads your Spotify library
  importers/youtube.ts   Reads your YouTube library, keeps only music
  library.ts             Merges duplicates, playlist choices, saving
  videos.ts              Matches songs to music videos (official search)
  connections.ts         Stores and refreshes sign-ins
  session.ts             Your password login
middleware.ts            Blocks anyone who isn't logged in
scripts/find_videos.py   Fast music-video finder (YouTube Music)
supabase/schema.sql      Database tables (safe to re-run after updates)
```
