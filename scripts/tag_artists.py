"""Tags your artists from MusicBrainz (free, no key), for a deeper taste profile.

For each artist waiting in `artist_profiles` (favourites first, then artists
that came up in your radios) it finds the artist on MusicBrainz and saves:
solo or group, vocal gender (for groups, from up to four members), country,
area, genres and tags. It also notes which script the artist's titles in your
library are written in (thai, han, hangul, kana, latin…).

MusicBrainz asks for at most one request a second, so this runs for about 50
minutes at a time (.github/workflows/tag-artists.yml, every hour) until the
queue is empty, then just picks up new artists.

Locally: python scripts/tag_artists.py [--minutes 5]
"""
from __future__ import annotations

import argparse
import re
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from discover import Database, load_env  # noqa: E402  (same database helper)

MB = "https://musicbrainz.org/ws/2"
HEADERS = {"User-Agent": "MusicHub/1.0 ( https://github.com/sharkbarnacles/Big-Music )", "Accept": "application/json"}
PAUSE = 1.1  # MusicBrainz: one request a second
last_call = 0.0


def mb(path: str, params: dict) -> dict | None:
    global last_call
    wait = PAUSE - (time.time() - last_call)
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        last_call = time.time()
        try:
            r = requests.get(f"{MB}/{path}", params={**params, "fmt": "json"}, headers=HEADERS, timeout=30)
        except requests.RequestException:
            time.sleep(3)
            continue
        if r.status_code == 503:  # too fast: back off
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            return None
        return r.json()
    return None


def artist_key(name: str) -> str:
    """Same as the SQL taste_artists() and lib/taste.ts artistKey()."""
    s = re.sub(r"\s+(feat\.?|ft\.?|x|&|and)\s+.*$", "", name or "", flags=re.I)
    s = s.split(",")[0]
    return re.sub(r"\s+", " ", s).strip().lower()


def simple(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[\W_]+", "", s)


SCRIPTS = [
    ("thai", re.compile(r"[฀-๿]")),
    ("hangul", re.compile(r"[가-힯]")),
    ("kana", re.compile(r"[぀-ヿ]")),
    ("han", re.compile(r"[一-鿿]")),
    ("devanagari", re.compile(r"[ऀ-ॿ]")),
    ("arabic", re.compile(r"[؀-ۿ]")),
    ("cyrillic", re.compile(r"[Ѐ-ӿ]")),
    ("greek", re.compile(r"[Ͱ-Ͽ]")),
    ("hebrew", re.compile(r"[֐-׿]")),
]


def script_of(text: str) -> str:
    for name, rx in SCRIPTS:
        if rx.search(text):
            return name
    return "latin"


# Country codes that fit a script, to pick the right namesake.
SCRIPT_COUNTRIES = {"thai": {"TH"}, "hangul": {"KR"}, "kana": {"JP"}, "han": {"CN", "TW", "HK", "MO", "SG", "MY"}}


def best_match(name: str, script: str, results: list) -> dict | None:
    want = simple(name)
    good = []
    for a in results:
        names = {simple(a.get("name", "")), simple(a.get("sort-name", ""))}
        names |= {simple(x.get("name", "")) for x in a.get("aliases", []) or []}
        if want and want in names and int(a.get("score", 0)) >= 85:
            good.append(a)
    if not good:
        return None
    countries = SCRIPT_COUNTRIES.get(script)
    if countries:
        local = [a for a in good if a.get("country") in countries or (a.get("area") or {}).get("iso-3166-1-codes", [None])[0] in countries]
        if local:
            good = local
    return max(good, key=lambda a: int(a.get("score", 0)))


VOICE_TAGS = {
    "male": ("boy band", "boy group", "male vocalists", "male vocalist", "male singer"),
    "female": ("girl group", "girl band", "female vocalists", "female vocalist", "female singer"),
}


def voice_from_tags(tags: list[str]) -> str | None:
    t = " | ".join(tags)
    m = any(x in t for x in VOICE_TAGS["male"])
    f = any(x in t for x in VOICE_TAGS["female"])
    if m and f:
        return "mixed"
    return "male" if m else "female" if f else None


def top_names(items: list, n: int) -> list[str]:
    items = sorted(items or [], key=lambda x: -int(x.get("count", 0)))
    return [x["name"].strip().lower() for x in items[:n] if x.get("name") and int(x.get("count", 0)) >= 0]


def profile(name: str, script: str) -> dict:
    found = mb("artist", {"query": f'artist:"{name}" OR alias:"{name}"', "limit": 8})
    match = best_match(name, script, (found or {}).get("artists", []))
    if not match:
        return {"status": "not_found"}
    info = mb(f"artist/{match['id']}", {"inc": "genres+tags+artist-rels"}) or {}
    genres = top_names(info.get("genres"), 8)
    tags = [t for t in top_names(info.get("tags"), 14) if t not in genres]
    kind = info.get("type") or match.get("type")
    voice = None
    if kind == "Person":
        g = (info.get("gender") or "").lower()
        voice = g if g in ("male", "female") else None
    else:
        voice = voice_from_tags(genres + tags)
        if not voice and kind == "Group":
            members = [r["artist"]["id"] for r in info.get("relations", []) or []
                       if r.get("type") == "member of band" and r.get("direction") == "backward" and r.get("artist")]
            genders = []
            for mid in members[:4]:
                m = mb(f"artist/{mid}", {}) or {}
                if (m.get("gender") or "").lower() in ("male", "female"):
                    genders.append(m["gender"].lower())
            if genders:
                voice = genders[0] if len(set(genders)) == 1 else "mixed"
    area = info.get("area") or match.get("area") or {}
    return {
        "status": "found",
        "mbid": match["id"],
        "kind": kind,
        "voice": voice,
        "country": info.get("country") or match.get("country") or ((area.get("iso-3166-1-codes") or [None])[0]),
        "area": area.get("name"),
        "genres": genres,
        "tags": tags,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=50)
    args = ap.parse_args()
    db = Database(load_env())
    stop = time.time() + args.minutes * 60

    # Keep the queue topped up with your artists (new ones get added; favourites first).
    try:
        db.rpc("queue_taste_artists", {"max_rows": 9000})
    except Exception as e:  # noqa: BLE001
        print("Couldn't refresh the queue:", e)

    # Which script each artist's titles in your library are written in.
    rows = db.get_all("tracks", {"select": "artist,title", "order": "id"})
    scripts: dict[str, Counter] = {}
    for r in rows:
        k = artist_key(r["artist"])
        scripts.setdefault(k, Counter())[script_of(f"{r['title']} {r['artist']}")] += 1

    done = found = 0
    while time.time() < stop:
        batch = db.get("artist_profiles", {
            "select": "artist_key,name", "status": "eq.pending",
            "order": "priority.desc", "limit": "40",
        })
        if not batch:
            print("Queue empty.")
            break
        for a in batch:
            if time.time() >= stop:
                break
            c = scripts.get(a["artist_key"])
            script = c.most_common(1)[0][0] if c else script_of(a["name"])
            # A non-Latin script anywhere in their titles beats Latin.
            if c and script == "latin":
                other = [s for s, _ in c.most_common() if s != "latin"]
                if other:
                    script = other[0]
            try:
                p = profile(a["name"], script)
            except Exception as e:  # noqa: BLE001
                print("Error on", a["name"], e)
                p = {"status": "error"}
            p["script"] = script
            p["checked_at"] = datetime.now(timezone.utc).isoformat()
            db.patch("artist_profiles", {"artist_key": f"eq.{a['artist_key']}"}, p)
            done += 1
            found += p["status"] == "found"
            if done % 50 == 0:
                print(f"{done} checked, {found} found")
    print(f"Done: {done} checked, {found} found.")


if __name__ == "__main__":
    main()
