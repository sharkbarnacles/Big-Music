#!/usr/bin/env python3
"""
Finds the official music video for every song in your library, using
YouTube Music through the unofficial `ytmusicapi` library.

Why this instead of the button in the app?
  - No daily quota: it can check thousands of songs in one go.
  - It reads YouTube Music's own song ↔ video links (the Song/Video switch
    in the YouTube Music app), which is more accurate than searching.
  - It doesn't need your Google login at all.

The catch: it's unofficial, so it can break if Google changes YouTube Music.
If that happens, update it with:  pip install -U ytmusicapi

Setup (once):
    pip install -r scripts/requirements.txt

Run from the music-hub folder:
    python scripts/find_videos.py               # check songs never checked
    python scripts/find_videos.py --limit 100   # stop after 100 songs
    python scripts/find_videos.py --recheck     # retry songs where nothing was found
"""

import argparse
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    from ytmusicapi import YTMusic
except ImportError:
    sys.exit("Missing libraries. Run:  pip install -r scripts/requirements.txt")


# ── Settings from .env.local ───────────────────────────────────────────

def load_env() -> dict:
    env = {}
    path = Path(__file__).resolve().parent.parent / ".env.local"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        if not env.get(key):
            sys.exit(f"Missing {key}. Fill it in .env.local first.")
    return env


# ── Matching (same rules as lib/library.ts) ────────────────────────────

def simplify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not ("̀" <= c <= "ͯ"))  # é → e
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
    s = re.sub(r"\s(feat|ft|featuring)\.?\s.*$", " ", s)
    s = re.sub(r"\s-\s.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo)\b.*$", " ", s)
    s = re.sub(r"[\W_]+", " ", s)  # punctuation → space, keeps every alphabet
    return s.strip()


def primary_artist(artist: str) -> str:
    return re.split(r",|&|\s+x\s+|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+", artist, flags=re.I)[0].strip()


# ── Database (Supabase REST API) ───────────────────────────────────────

class Database:
    def __init__(self, env: dict):
        self.base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1"
        key = env["SUPABASE_SECRET_KEY"]
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):  # legacy service_role JWT also needs this header
            self.headers["Authorization"] = f"Bearer {key}"

    def songs_to_check(self, recheck: bool, batch: int, started: str, skip_ids: list) -> list:
        # Songs saved during this run drop out of these filters on their own;
        # songs that hit an error are skipped by id so they aren't retried forever.
        params = {
            "select": "id,title,artist,track_sources(service,external_id)",
            "order": "created_at,id",
            "limit": str(batch),
        }
        if recheck:
            params["video_status"] = "eq.none"
            params["video_checked_at"] = f"lt.{started}"
        else:
            params["video_status"] = "is.null"
        if skip_ids:
            params["id"] = f"not.in.({','.join(skip_ids)})"
        r = requests.get(f"{self.base}/tracks", headers=self.headers, params=params, timeout=30)
        if r.status_code >= 400:
            sys.exit(f"Database error {r.status_code}: {r.text[:300]}\n(Did you re-run supabase/schema.sql?)")
        return r.json()

    def save(self, track_id: str, video_id: str | None):
        body = {
            "video_id": video_id,
            "video_status": "found" if video_id else "none",
            "video_source": "ytmusic",
            "video_checked_at": datetime.now(timezone.utc).isoformat(),
        }
        r = requests.patch(
            f"{self.base}/tracks",
            headers={**self.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{track_id}"},
            json=body,
            timeout=30,
        )
        r.raise_for_status()


# ── Finding videos ─────────────────────────────────────────────────────

OFFICIAL_VIDEO = "MUSIC_VIDEO_TYPE_OMV"


def from_counterpart(yt: YTMusic, video_id: str) -> str | None:
    """If we already have the song on YouTube, ask YouTube Music for its linked video."""
    playlist = yt.get_watch_playlist(videoId=video_id, limit=1)
    tracks = playlist.get("tracks") or []
    if not tracks:
        return None
    first = tracks[0]
    if first.get("videoType") == OFFICIAL_VIDEO:
        return first.get("videoId")  # this upload already is the music video
    counterpart = first.get("counterpart") or {}
    return counterpart.get("videoId")


def from_search(yt: YTMusic, artist: str, title: str) -> str | None:
    """Search YouTube Music's 'Videos' section and accept a close, official match."""
    want_artist, want_title = simplify(primary_artist(artist)), simplify(title)
    if not want_artist or not want_title:
        return None
    for result in yt.search(f"{primary_artist(artist)} {title}", filter="videos", limit=5):
        if result.get("videoType", OFFICIAL_VIDEO) != OFFICIAL_VIDEO:
            continue  # skip fan uploads, covers, live clips
        names = " ".join(a.get("name", "") for a in result.get("artists") or [])
        found_title = simplify(result.get("title", ""))
        if want_title in found_title and want_artist in f"{found_title} {simplify(names)}":
            return result.get("videoId")
    return None


def find_video(yt: YTMusic, song: dict) -> str | None:
    for source in song.get("track_sources") or []:
        if source.get("service") == "youtube":
            try:
                video = from_counterpart(yt, source["external_id"])
                if video:
                    return video
            except Exception:
                pass  # fall back to search
    return from_search(yt, song["artist"], song["title"])


def main():
    parser = argparse.ArgumentParser(description="Find music videos for your library.")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many songs (0 = all)")
    parser.add_argument("--recheck", action="store_true", help="retry songs where no video was found")
    args = parser.parse_args()

    db = Database(load_env())
    yt = YTMusic()  # no login needed

    started = datetime.now(timezone.utc).isoformat()
    failed_ids, checked, found, errors = [], 0, 0, 0
    while True:
        songs = db.songs_to_check(args.recheck, 100, started, failed_ids)
        if not songs:
            break
        for song in songs:
            label = f"{song['artist']} – {song['title']}"
            try:
                video = find_video(yt, song)
                db.save(song["id"], video)
                checked += 1
                if video:
                    found += 1
                print(f"{'✓' if video else '·'} {label}" + (f"  → youtu.be/{video}" if video else ""))
            except Exception as err:  # keep going; this song stays unchecked for next time
                errors += 1
                failed_ids.append(song["id"])
                print(f"! {label}: {err}")
                if errors >= 20 and errors > checked:
                    sys.exit("Too many errors — YouTube Music may have changed. Try: pip install -U ytmusicapi")
                if len(failed_ids) >= 150:
                    sys.exit(f"Stopping after {errors} errors. Run the script again later to continue.")
            time.sleep(0.3)  # be polite to YouTube
            if args.limit and checked >= args.limit:
                break
        if args.limit and checked >= args.limit:
            break

    print(f"\nDone. Checked {checked} songs, found {found} music videos, {errors} errors.")


if __name__ == "__main__":
    main()
