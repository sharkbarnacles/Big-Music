#!/usr/bin/env python3
"""
Finds, for every song in your library, its official music video and its
YouTube audio version (used by YouTube mode in the player), using YouTube
Music through the unofficial `ytmusicapi` library.

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
        # A song needs work if its music video OR its YouTube audio version
        # hasn't been looked for. Songs saved during this run drop out of these
        # filters on their own; songs that hit an error are skipped by id.
        params = {
            "select": "id,title,artist,video_status,yt_audio_id,yt_audio_status,track_sources(service,external_id)",
            "order": "created_at,id",
            "limit": str(batch),
        }
        if recheck:
            params["or"] = (
                f'(and(video_status.eq.none,video_checked_at.lt."{started}"),'
                f'and(yt_audio_status.eq.none,yt_audio_checked_at.lt."{started}"))'
            )
        else:
            params["or"] = "(video_status.is.null,yt_audio_status.is.null)"
        if skip_ids:
            params["id"] = f"not.in.({','.join(skip_ids)})"
        r = requests.get(f"{self.base}/tracks", headers=self.headers, params=params, timeout=30)
        if r.status_code >= 400:
            sys.exit(f"Database error {r.status_code}: {r.text[:300]}\n(Did you re-run supabase/schema.sql?)")
        return r.json()

    def save(self, track_id: str, body: dict):
        if not body:
            return
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


def from_song_search(yt: YTMusic, artist: str, title: str) -> str | None:
    """Search YouTube Music's 'Songs' section for the audio version of a song."""
    want_artist, want_title = simplify(primary_artist(artist)), simplify(title)
    if not want_artist or not want_title:
        return None
    for result in yt.search(f"{primary_artist(artist)} {title}", filter="songs", limit=5):
        names = " ".join(a.get("name", "") for a in result.get("artists") or [])
        found_title = simplify(result.get("title", ""))
        if want_title in found_title and want_artist in f"{found_title} {simplify(names)}":
            return result.get("videoId")
    return None


def process(yt: YTMusic, song: dict, recheck: bool) -> dict:
    """Finds what's missing for one song and returns the fields to save."""
    now = datetime.now(timezone.utc).isoformat()
    want = "none" if recheck else None
    need_audio = song.get("yt_audio_status") == want
    need_video = song.get("video_status") == want
    yt_ids = [s["external_id"] for s in song.get("track_sources") or [] if s.get("service") == "youtube"]
    fields: dict = {}

    # The YouTube audio version, for playing inside the hub ("YouTube mode").
    audio = song.get("yt_audio_id") or (yt_ids[0] if yt_ids else None)
    if need_audio:
        if not audio:
            audio = from_song_search(yt, song["artist"], song["title"])
        fields.update(
            yt_audio_id=audio,
            yt_audio_status="found" if audio else "none",
            yt_audio_source="ytmusic",
            yt_audio_checked_at=now,
        )

    # The official music video: YouTube Music links each song to its video,
    # so ask about the uploads we know first, then search.
    if need_video:
        video = None
        for base in [*yt_ids, audio]:
            if base and not video:
                try:
                    video = from_counterpart(yt, base)
                except Exception:
                    pass  # fall back to search
        if not video:
            video = from_search(yt, song["artist"], song["title"])
        fields.update(
            video_id=video,
            video_status="found" if video else "none",
            video_source="ytmusic",
            video_checked_at=now,
        )
    return fields


def main():
    parser = argparse.ArgumentParser(description="Find music videos for your library.")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many songs (0 = all)")
    parser.add_argument("--recheck", action="store_true", help="retry songs where no video was found")
    args = parser.parse_args()

    db = Database(load_env())
    yt = YTMusic()  # no login needed

    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    failed_ids, checked, found, audios, errors = [], 0, 0, 0, 0
    while True:
        songs = db.songs_to_check(args.recheck, 100, started, failed_ids)
        if not songs:
            break
        for song in songs:
            label = f"{song['artist']} – {song['title']}"
            try:
                fields = process(yt, song, args.recheck)
                db.save(song["id"], fields)
                checked += 1
                video, audio = fields.get("video_id"), fields.get("yt_audio_id")
                found += 1 if video else 0
                audios += 1 if audio else 0
                marks = ("▶" if video else "·") + ("♪" if audio else "·")
                print(f"{marks} {label}" + (f"  → video youtu.be/{video}" if video else ""))
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

    print(f"\nDone. Checked {checked} songs: {found} music videos, {audios} YouTube audio versions, {errors} errors.")


if __name__ == "__main__":
    main()
