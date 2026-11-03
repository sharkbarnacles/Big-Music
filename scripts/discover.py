"""
Makes the Discover tab's lists, in GitHub's cloud, once a day.

Every list is made ONCE, gets a date, and is then never changed, so nothing
ever disappears from the page. Old lists stay in the archive forever.

  • Daily discover   every day       10 new-to-you songs, each with a reason
  • Monday Discovery once a week     30 new-to-you songs, a bit deeper
  • Friday New Releases  Fridays     new songs from artists in your library
  • Forgotten favorites  monthly     20 library songs you haven't played lately
  • Month mix            monthly     what you played and hearted most last month

How it finds new music: it picks artists from your library, looks up
"Fans also like" artists on YouTube Music (unofficial ytmusicapi library, no
login), and takes their top songs, skipping anything already in your library
or suggested before. Results already have YouTube IDs, so they play at once.

Run by .github/workflows/discover.yml (needs SUPABASE_URL and
SUPABASE_SECRET_KEY secrets). Locally: python scripts/discover.py [--force]
"""

from __future__ import annotations

import argparse
import math
import os
import random
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

try:
    from ytmusicapi import YTMusic
except ImportError:
    sys.exit("Missing library. Run: pip install -r scripts/requirements.txt")

TZ = ZoneInfo("America/New_York")  # the owner's time zone: "today" means their today
CACHE_DAYS = 21                    # re-read an artist's page after this long
PAUSE = 0.4                        # seconds between YouTube Music requests


# ── Settings ───────────────────────────────────────────────────────────

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
            sys.exit(f"Missing {key}.")
    return env


# ── Matching (same rules as lib/library.ts) ────────────────────────────

def simplify(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not ("̀" <= c <= "ͯ"))
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
    s = re.sub(r"\s(feat|ft|featuring)\.?\s.*$", " ", s)
    s = re.sub(r"\s-\s.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo)\b.*$", " ", s)
    s = re.sub(r"[\W_]+", " ", s)
    return s.strip()


def primary_artist(artist: str) -> str:
    return re.split(r",|&|\s+x\s+|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+", artist or "", flags=re.I)[0].strip()


def match_key(artist: str, title: str) -> str:
    return f"{simplify(primary_artist(artist))}|{simplify(title)}"


# ── Database (Supabase REST API) ───────────────────────────────────────

class Database:
    def __init__(self, env: dict):
        self.base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1"
        key = env["SUPABASE_SECRET_KEY"]
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):
            self.headers["Authorization"] = f"Bearer {key}"

    def get(self, table: str, params: dict) -> list:
        r = requests.get(f"{self.base}/{table}", headers=self.headers, params=params, timeout=60)
        if r.status_code >= 400:
            sys.exit(f"Database error {r.status_code} on {table}: {r.text[:300]}\n(Did you re-run supabase/schema.sql?)")
        return r.json()

    def get_all(self, table: str, params: dict, page: int = 1000) -> list:
        rows, offset = [], 0
        while True:
            batch = self.get(table, {**params, "limit": str(page), "offset": str(offset)})
            rows.extend(batch)
            if len(batch) < page:
                return rows
            offset += page

    def rpc(self, name: str, args: dict) -> list:
        r = requests.post(f"{self.base}/rpc/{name}", headers=self.headers, json=args, timeout=120)
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, rows, upsert_on: str | None = None, returning: bool = False):
        prefer = ["return=representation" if returning else "return=minimal"]
        params = {}
        if upsert_on:
            prefer.append("resolution=merge-duplicates")
            params["on_conflict"] = upsert_on
        r = requests.post(f"{self.base}/{table}", headers={**self.headers, "Prefer": ",".join(prefer)},
                          params=params, json=rows, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"Saving to {table} failed {r.status_code}: {r.text[:300]}")
        return r.json() if returning else None

    def patch(self, table: str, params: dict, body: dict):
        r = requests.patch(f"{self.base}/{table}", headers={**self.headers, "Prefer": "return=minimal"},
                           params=params, json=body, timeout=60)
        r.raise_for_status()


# ── Your library ───────────────────────────────────────────────────────

SCRIPT_LANGUAGE = [
    ("thai", re.compile(r"[\u0E00-\u0E7F]")),
    ("korean", re.compile(r"[\uAC00-\uD7AF]")),
    ("japanese", re.compile(r"[\u3040-\u30FF]")),
    ("chinese", re.compile(r"[\u4E00-\u9FFF]")),
    ("russian", re.compile(r"[\u0400-\u04FF]")),
]
COUNTRY_LANGUAGE = {
    "KR": "korean", "JP": "japanese", "CN": "chinese", "TW": "chinese", "HK": "chinese", "TH": "thai",
    "PH": "filipino", "ES": "spanish", "MX": "spanish", "AR": "spanish", "CO": "spanish", "CL": "spanish", "PE": "spanish",
    "FR": "french", "BE": "french", "RU": "russian", "UA": "russian", "BY": "russian",
}


def script_language(text: str) -> str | None:
    for lang, rx in SCRIPT_LANGUAGE:
        if rx.search(text):
            return lang
    return None


class Library:
    def __init__(self, db: Database):
        rows = db.get_all("tracks", {"select": "artist,title", "order": "id"})
        self.keys = {match_key(r["artist"], r["title"]) for r in rows}
        counts: dict[str, int] = {}
        names: dict[str, str] = {}
        for r in rows:
            name = primary_artist(r["artist"])
            k = simplify(name)
            if not k:
                continue
            counts[k] = counts.get(k, 0) + 1
            names.setdefault(k, name)
        self.artist_counts = counts
        self.artist_names = names
        # Which language each artist sings in (from their titles' script, or
        # their country on MusicBrainz), and your language settings: Daily
        # discover leans on your main languages and only sometimes branches out.
        scripts: dict[str, dict[str, int]] = {}
        for r in rows:
            k = simplify(primary_artist(r["artist"]))
            lang = script_language(f"{r['title']} {r['artist']}")
            if k and lang:
                scripts.setdefault(k, {})[lang] = scripts.setdefault(k, {}).get(lang, 0) + 1
        try:
            prof = db.get_all("artist_profiles", {"select": "artist_key,country", "status": "eq.found", "country": "not.is.null"})
            countries = {p["artist_key"]: p["country"] for p in prof}
        except SystemExit:
            countries = {}
        self.artist_lang: dict[str, str] = {}
        for k, name in names.items():
            if k in scripts:
                self.artist_lang[k] = max(scripts[k], key=scripts[k].get)
            else:
                self.artist_lang[k] = COUNTRY_LANGUAGE.get(countries.get(name.lower().strip(), ""), "english")
        try:
            row = db.get("taste_settings", {"select": "value", "key": "eq.languages"})
            self.languages = row[0]["value"] if row else {}
        except SystemExit:
            self.languages = {}
        suggested = db.get_all("discover_items", {"select": "match_key", "match_key": "not.is.null"})
        self.suggested = {r["match_key"] for r in suggested}
        print(f"Library: {len(rows)} songs, {len(counts)} artists; {len(self.suggested)} songs suggested before.")

    def top_artists(self, n: int) -> list[str]:
        return sorted(self.artist_counts, key=lambda k: -self.artist_counts[k])[:n]

    def has_artist(self, name: str) -> bool:
        return simplify(name) in self.artist_counts

    def is_new(self, artist: str, title: str) -> bool:
        k = match_key(artist, title)
        return k not in self.keys and k not in self.suggested

    def weighted_seeds(self, n: int, pool: int = 400) -> list[str]:
        """Artists from your library, picked at random; artists you have more songs by come up more often."""
        top = self.top_artists(pool)
        main = set(self.languages.get("main", []))
        branch = set(self.languages.get("branch", []))

        def lean(k: str) -> float:
            lang = self.artist_lang.get(k, "english")
            if not main:
                return 1.0
            return 1.0 if lang in main else 0.35 if lang in branch else 0.5

        weights = [math.sqrt(self.artist_counts[k]) * lean(k) for k in top]
        picked: list[str] = []
        while top and len(picked) < n:
            i = random.choices(range(len(top)), weights=weights)[0]
            picked.append(top.pop(i))
            weights.pop(i)
        return picked


# ── YouTube Music (cached artist pages) ────────────────────────────────

class Music:
    def __init__(self, db: Database):
        self.db = db
        self.yt = YTMusic()
        self.calls = 0

    def _call(self, fn, *args, **kwargs):
        time.sleep(PAUSE)
        self.calls += 1
        return fn(*args, **kwargs)

    def artist(self, name: str, fresh_hours: float | None = None) -> dict | None:
        """The artist's page (related artists, top songs, singles, albums), cached in the database."""
        key = simplify(name)
        if not key:
            return None
        rows = self.db.get("discover_artists", {"name_key": f"eq.{key}", "select": "*"})
        row = rows[0] if rows else None
        max_age = timedelta(hours=fresh_hours) if fresh_hours is not None else timedelta(days=CACHE_DAYS)
        if row and row.get("data") and row.get("fetched_at"):
            age = datetime.now(timezone.utc) - datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
            if age < max_age:
                return row
        browse_id = row.get("browse_id") if row else None
        try:
            if not browse_id:
                found = self._call(self.yt.search, name, filter="artists", limit=1)
                found = [f for f in found if f.get("browseId")]
                if not found:
                    self.db.insert("discover_artists", [{"name_key": key, "name": name, "data": {"missing": True}, "fetched_at": now_iso()}], upsert_on="name_key")
                    return None
                browse_id = found[0]["browseId"]
            page = self._call(self.yt.get_artist, browse_id)
        except Exception as e:  # one bad artist shouldn't stop the run
            print(f"  ! {name}: {e}")
            return row
        data = {
            "related": [
                {"name": a.get("title"), "browseId": a.get("browseId")}
                for a in (page.get("related") or {}).get("results", []) if a.get("title")
            ][:12],
            "songs": [song_info(s) for s in (page.get("songs") or {}).get("results", []) if s.get("videoId")][:12],
            "releases": [
                {"browseId": r.get("browseId"), "title": r.get("title"), "year": str(r.get("year") or ""),
                 "kind": kind}
                for kind in ("singles", "albums")
                for r in (page.get(kind) or {}).get("results", []) if r.get("browseId")
            ][:20],
        }
        new_row = {"name_key": key, "name": page.get("name") or name, "browse_id": browse_id, "data": data, "fetched_at": now_iso()}
        self.db.insert("discover_artists", [new_row], upsert_on="name_key")
        return {**(row or {}), **new_row}

    def artist_by_id(self, name: str, browse_id: str | None) -> dict | None:
        """Same as artist(), but uses a known YouTube Music ID (from a related-artists list)."""
        key = simplify(name)
        if browse_id and key:
            rows = self.db.get("discover_artists", {"name_key": f"eq.{key}", "select": "browse_id"})
            if not rows or not rows[0].get("browse_id"):
                self.db.insert("discover_artists", [{"name_key": key, "name": name, "browse_id": browse_id}], upsert_on="name_key")
        return self.artist(name)

    def album_tracks(self, browse_id: str) -> list[dict]:
        try:
            album = self._call(self.yt.get_album, browse_id)
        except Exception as e:
            print(f"  ! album {browse_id}: {e}")
            return []
        cover = best_thumb(album.get("thumbnails"))
        out = []
        for t in album.get("tracks", []):
            if not t.get("videoId"):
                continue
            info = song_info(t)
            info["image"] = info["image"] or cover
            info["album"] = info["album"] or album.get("title")
            out.append(info)
        return out


def best_thumb(thumbs) -> str | None:
    if not thumbs:
        return None
    url = sorted(thumbs, key=lambda t: t.get("width", 0))[-1].get("url")
    # Ask YouTube for a square 400px cover instead of a tiny one.
    return re.sub(r"=w\d+-h\d+", "=w400-h400", url) if url else None


def song_info(s: dict) -> dict:
    artists = ", ".join(a.get("name", "") for a in (s.get("artists") or []) if a.get("name"))
    album = s.get("album")
    seconds = s.get("duration_seconds")
    return {
        "videoId": s.get("videoId"),
        "title": s.get("title") or "",
        "artist": artists,
        "album": album.get("name") if isinstance(album, dict) else album,
        "image": best_thumb(s.get("thumbnails")),
        "duration_ms": int(seconds * 1000) if seconds else None,
    }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Making lists ───────────────────────────────────────────────────────

def edition_exists(db: Database, kind: str, day: date) -> bool:
    return bool(db.get("discover_editions", {"kind": f"eq.{kind}", "edition_date": f"eq.{day.isoformat()}", "select": "id"}))


def save_edition(db: Database, lib: Library, kind: str, day: date, title: str, subtitle: str, items: list[dict]):
    if not items:
        print(f"  {title}: nothing found, not saved.")
        return
    ed = db.insert("discover_editions", [{"kind": kind, "edition_date": day.isoformat(), "title": title, "subtitle": subtitle}], returning=True)[0]
    rows = []
    for i, it in enumerate(items):
        k = match_key(it["artist"], it["title"])
        rows.append({
            "edition_id": ed["id"], "position": i, "track_id": it.get("track_id"), "yt_video_id": it.get("videoId"),
            "title": it["title"], "artist": it["artist"], "album": it.get("album"), "image_url": it.get("image"),
            "duration_ms": it.get("duration_ms"), "reason": it.get("reason"), "match_key": k,
        })
        lib.suggested.add(k)
    db.insert("discover_items", rows)
    print(f"  Saved {title} ({day}): {len(rows)} songs.")


def find_new_songs(lib: Library, music: Music, want: int, seeds: int, ranks: range, used_artists: set) -> list[dict]:
    """New-to-you songs by artists that fans of your artists also like."""
    out: list[dict] = []
    for seed_key in lib.weighted_seeds(seeds):
        if len(out) >= want:
            break
        seed_name = lib.artist_names[seed_key]
        page = music.artist(seed_name)
        related = ((page or {}).get("data") or {}).get("related") or []
        random.shuffle(related)
        for rel in related:
            name = rel.get("name") or ""
            if not name or lib.has_artist(name) or simplify(name) in used_artists:
                continue
            rel_page = music.artist_by_id(name, rel.get("browseId"))
            songs = ((rel_page or {}).get("data") or {}).get("songs") or []
            choices = [s for i, s in enumerate(songs) if i in ranks and s.get("videoId") and lib.is_new(s["artist"] or name, s["title"])]
            if not choices:
                continue
            song = dict(random.choice(choices))
            song["artist"] = song["artist"] or name
            song["reason"] = f"Because you like {seed_name}"
            out.append(song)
            used_artists.add(simplify(name))
            lib.suggested.add(match_key(song["artist"], song["title"]))
            break  # one song per seed keeps the list varied
    return out


def make_daily(db, lib, music, today: date):
    if edition_exists(db, "daily", today):
        return
    used: set = set()
    songs = find_new_songs(lib, music, want=10, seeds=40, ranks=range(0, 4), used_artists=used)
    save_edition(db, lib, "daily", today, "Daily discover", today.strftime("%a %-d %b"), songs[:10])


def make_weekly(db, lib, music, today: date):
    monday = today - timedelta(days=today.weekday())
    if edition_exists(db, "weekly", monday):
        return
    used: set = set()
    songs = find_new_songs(lib, music, want=30, seeds=110, ranks=range(1, 9), used_artists=used)
    save_edition(db, lib, "weekly", monday, "Monday Discovery", f"Week of {monday.strftime('%-d %b')}", songs[:30])


def scan_releases(db, lib, music, today: date):
    """Looks at ~45 of your artists' pages a day (all top 300 in about a week) and notes new releases."""
    top = lib.top_artists(300)
    if not top:
        return
    start = (today.toordinal() * 45) % len(top)
    batch = (top + top)[start:start + 45]
    known = {r["browse_id"] for r in db.get_all("discover_releases", {"select": "browse_id"})}
    year = str(today.year)
    found = 0
    for key in batch:
        name = lib.artist_names[key]
        page = music.artist(name, fresh_hours=20)
        if not page:
            continue
        first_scan = not page.get("releases_scanned_at")
        new_rows = []
        for r in ((page.get("data") or {}).get("releases") or []):
            bid = r.get("browseId")
            if not bid or bid in known:
                continue
            known.add(bid)
            # The first time we look at an artist, everything already out counts as "old".
            fresh = not first_scan and r.get("year") in ("", year)
            new_rows.append({"browse_id": bid, "artist": page.get("name") or name, "title": r.get("title") or "",
                             "kind": r.get("kind"), "year": r.get("year"), "first_seen": today.isoformat(),
                             "published": not fresh})
            found += fresh
        if new_rows:
            db.insert("discover_releases", new_rows, upsert_on="browse_id")
        db.patch("discover_artists", {"name_key": f"eq.{key}"}, {"releases_scanned_at": now_iso()})
    print(f"  Release scan: {len(batch)} artists, {found} new releases noted.")


def make_releases(db, lib, music, today: date):
    if today.weekday() != 4 or edition_exists(db, "releases", today):  # Fridays only
        return
    since = (today - timedelta(days=8)).isoformat()
    pending = db.get("discover_releases", {"published": "eq.false", "first_seen": f"gte.{since}", "select": "*", "order": "first_seen.desc", "limit": "25"})
    songs: list[dict] = []
    for rel in pending:
        tracks = [t for t in music.album_tracks(rel["browse_id"]) if lib.is_new(t["artist"] or rel["artist"], t["title"])]
        for t in tracks[:2]:
            t = dict(t)
            t["artist"] = t["artist"] or rel["artist"]
            t["reason"] = f"New {'single' if rel.get('kind') == 'singles' else 'album'} from {rel['artist']}"
            songs.append(t)
            lib.suggested.add(match_key(t["artist"], t["title"]))
    save_edition(db, lib, "releases", today, "Friday New Releases", today.strftime("%a %-d %b"), songs[:30])
    for rel in pending:
        db.patch("discover_releases", {"browse_id": f"eq.{rel['browse_id']}"}, {"published": True})


def make_forgotten(db, lib, today: date):
    first = today.replace(day=1)
    if edition_exists(db, "forgotten", first):
        return
    rows = db.rpc("forgotten_candidates", {"lim": 400})
    # Prefer songs from playlists you haven't added to for over a year.
    year_ago = datetime.now(timezone.utc) - timedelta(days=365)
    def old(r):
        d = r.get("last_added_at")
        return d and datetime.fromisoformat(d.replace("Z", "+00:00")) < year_ago
    rows.sort(key=lambda r: (not old(r), random.random()))
    picked, artists = [], set()
    for r in rows:
        a = simplify(primary_artist(r["artist"]))
        if a in artists:
            continue
        artists.add(a)
        if r.get("last_played"):
            reason = f"Last played {months_ago(r['last_played'])}"
        elif old(r) and r.get("playlist"):
            reason = f"From “{r['playlist']}”, untouched since {r['last_added_at'][:4]}"
        elif r.get("playlist"):
            reason = f"From “{r['playlist']}”"
        else:
            reason = "From your library"
        picked.append({"track_id": r["track_id"], "videoId": r["yt_audio_id"], "title": r["title"], "artist": r["artist"],
                       "album": r.get("album"), "image": r.get("image_url"), "duration_ms": r.get("duration_ms"), "reason": reason})
        if len(picked) >= 20:
            break
    # Library songs don't count as "suggested" (they may come back in a later month).
    if not picked:
        return
    ed = db.insert("discover_editions", [{"kind": "forgotten", "edition_date": first.isoformat(), "title": "Forgotten favorites", "subtitle": first.strftime("%B")}], returning=True)[0]
    db.insert("discover_items", [{
        "edition_id": ed["id"], "position": i, "track_id": p["track_id"], "yt_video_id": p["videoId"], "title": p["title"],
        "artist": p["artist"], "album": p["album"], "image_url": p["image"], "duration_ms": p["duration_ms"], "reason": p["reason"],
    } for i, p in enumerate(picked)])
    print(f"  Saved Forgotten favorites ({first}): {len(picked)} songs.")


def make_month_mix(db, lib, today: date):
    """On the 1st (or the first run after it): last month's most-played and hearted songs."""
    this_month = today.replace(day=1)
    last_month = (this_month - timedelta(days=1)).replace(day=1)
    if edition_exists(db, "month", last_month):
        return
    top = db.rpc("month_top_tracks", {"month_start": last_month.isoformat(), "lim": 40})
    ids = [r["track_id"] for r in top]
    hearted = db.get("discover_items", {"hearted": "eq.true", "track_id": "not.is.null", "select": "track_id,discover_editions!inner(edition_date)",
                                        "discover_editions.edition_date": f"gte.{last_month.isoformat()}"})
    for h in hearted:
        if h["track_id"] not in ids:
            ids.append(h["track_id"])
    if len(ids) < 8:
        print(f"  Month mix for {last_month:%B}: only {len(ids)} songs played or hearted, skipped.")
        return
    rows = db.get("tracks", {"id": f"in.({','.join(ids[:40])})", "select": "id,title,artist,album,image_url,duration_ms,yt_audio_id"})
    by_id = {r["id"]: r for r in rows}
    plays = {r["track_id"]: r["plays"] for r in top}
    items = []
    for tid in ids[:30]:
        r = by_id.get(tid)
        if not r or not r.get("yt_audio_id"):
            continue
        n = plays.get(tid)
        items.append({"track_id": tid, "videoId": r["yt_audio_id"], "title": r["title"], "artist": r["artist"], "album": r.get("album"),
                      "image": r.get("image_url"), "duration_ms": r.get("duration_ms"),
                      "reason": f"Played {n} times" if n and n > 1 else "You kept this one"})
    ed = db.insert("discover_editions", [{"kind": "month", "edition_date": last_month.isoformat(), "title": f"{last_month:%B} mix", "subtitle": f"Made {this_month:%-d %b}"}], returning=True)[0]
    db.insert("discover_items", [{
        "edition_id": ed["id"], "position": i, "track_id": p["track_id"], "yt_video_id": p["videoId"], "title": p["title"],
        "artist": p["artist"], "album": p["album"], "image_url": p["image"], "duration_ms": p["duration_ms"], "reason": p["reason"],
    } for i, p in enumerate(items)])
    print(f"  Saved {last_month:%B} mix: {len(items)} songs.")


def months_ago(iso: str) -> str:
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    months = max(1, round((datetime.now(timezone.utc) - d).days / 30))
    return "a month ago" if months == 1 else f"{months} months ago"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["daily", "weekly", "releases", "forgotten", "month", "scan"], help="make just one kind")
    args = parser.parse_args()

    env = load_env()
    db = Database(env)
    lib = Library(db)
    if not lib.artist_counts:
        sys.exit("Your library is empty; import playlists first.")
    music = Music(db)
    today = datetime.now(TZ).date()
    print(f"Today is {today:%A %-d %B %Y} (New York time).")

    steps = [
        ("daily", lambda: make_daily(db, lib, music, today)),
        ("weekly", lambda: make_weekly(db, lib, music, today)),
        ("scan", lambda: scan_releases(db, lib, music, today)),
        ("releases", lambda: make_releases(db, lib, music, today)),
        ("forgotten", lambda: make_forgotten(db, lib, today)),
        ("month", lambda: make_month_mix(db, lib, today)),
    ]
    failed = False
    for name, step in steps:
        if args.only and args.only != name:
            continue
        print(f"→ {name}")
        try:
            step()
        except Exception as e:  # keep going: one broken list shouldn't block the others
            failed = True
            print(f"  ! {name} failed: {e}")
    print(f"Done. {music.calls} YouTube Music requests.")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
