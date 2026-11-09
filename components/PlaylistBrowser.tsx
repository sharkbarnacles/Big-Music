'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlaylistPicker } from './PlaylistPicker';
import LibraryList from './LibraryList';
import PlayButtons from './PlayButtons';
import TagSheet from './TagSheet';
import RadioList from './RadioList';
import type { RadioCard } from '@/lib/radioList';
import { PLAYER_ICONS } from '@/lib/playerIcons';
import type { SavedAlbum } from '@/lib/savedAlbums';
import AlbumList from './AlbumList';
import SpeedDial from './SpeedDial';
import type { SpeedDial as Dial } from '@/lib/speedDial';
import { smallCover } from '@/lib/img';
import type { Tag } from '@/lib/tagTypes';
import type { TrackRowData } from '@/lib/tracks';

// Home (Home Lab pick L3 + T3 + P2 + G2 + E3):
// - T3: a small two-icon switch at the start of the controls line flips
//   between your playlists and every song in your library (remembered).
// - P2: pinned playlists as small cover tiles in two columns at the top.
// - L3: a sideways "Recently updated" shelf of covers, then the full list.
// - G2: a "Tags" button opens a menu with tick boxes; several ticked = only
//   playlists that have all of them. In Songs, the songs from those playlists.
// - E3: Select → "Tag…" tags many playlists at once (playlist pages have pills too).
// Older picks still here: Sort drop-down + service chips (Playlist Sort Lab
// S1 + G3 + K1 + P1) and the Set aside folder + Select (Playlist Tools F2 + M3).

export type PlaylistCard = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  count: number;
  last_added_at: string | null;
  set_aside: boolean;
  pinned_at: string | null;
  tags: string[];
};
export type HomeSongs = { tracks: TrackRowData[]; total: number; query: string; sort: string; error: string | null };
export type HomeView = 'playlists' | 'songs';

type Sort = 'recent' | 'az' | 'size';
type Show = 'all' | 'hub' | 'spotify' | 'youtube' | 'aside' | 'radios' | 'albums';

const SORTS: { id: Sort; label: string; short: string }[] = [
  { id: 'recent', label: 'Recently updated', short: 'Recent' },
  { id: 'az', label: 'Alphabetical', short: 'A–Z' },
  { id: 'size', label: 'Most songs', short: 'Most songs' },
];
const SONG_SORTS: { id: string; label: string; short: string }[] = [
  { id: 'recent', label: 'Recently added', short: 'Recent' },
  { id: 'artist', label: 'Artist A–Z', short: 'Artist' },
  { id: 'title', label: 'Title A–Z', short: 'Title' },
];
const SHOWS: { id: Show; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hub', label: 'Mine' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'youtube', label: 'YouTube' },
];
const KEY = 'musichub.playlistView';

function ago(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function homeHref(view: HomeView, tags: string[], songSort?: string) {
  const qs = new URLSearchParams({ view });
  if (tags.length) qs.set('tags', tags.join(','));
  if (view === 'songs' && songSort && songSort !== 'recent') qs.set('ssort', songSort);
  return `/?${qs}`;
}

export function libraryPlaylistsHref(tags: string[]) {
  const qs = new URLSearchParams({ view: 'playlists' });
  if (tags.length) qs.set('tags', tags.join(','));
  return `/library?${qs}`;
}

const PIN = <path d="M15 3l6 6-3 1-4 4 1 5-2 1-4-5-5 5H3v-1l5-5-5-4 1-2 5 1 4-4z" />;

export default function PlaylistBrowser({
  playlists,
  tags: tagsProp,
  view,
  initialTags,
  songs,
  base = '/',
  dial,
}: {
  dial?: Dial; // Home only: "Jump back in" (recent radios, albums, artists, songs)
  base?: '/' | '/library'; // Home, or the Library tab's playlist view
  playlists: PlaylistCard[];
  tags: Tag[];
  view: HomeView;
  initialTags: string[];
  songs?: HomeSongs;
}) {
  const [sort, setSort] = useState<Sort>('recent');
  const [show, setShow] = useState<Show>('all');
  // The "Radios" chip (after Mine): every radio you've made, loaded when first shown.
  const [radios, setRadios] = useState<RadioCard[] | null>(null);
  const [radiosError, setRadiosError] = useState<string | null>(null);
  useEffect(() => {
    if (show !== 'radios' || radios) return;
    fetch('/api/radios')
      .then((r) => r.json())
      .then((d) => (d.radios ? setRadios(d.radios) : setRadiosError(d.error ?? 'Couldn’t load your radios.')))
      .catch(() => setRadiosError('Couldn’t load your radios.'));
  }, [show, radios]);
  // The "Albums" chip (after Radios): albums you've starred, loaded fresh each time it's opened.
  const [albums, setAlbums] = useState<SavedAlbum[] | null>(null);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  useEffect(() => {
    if (show !== 'albums') return;
    let alive = true;
    fetch('/api/albums')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.albums) {
          setAlbums(d.albums);
          setAlbumsError(null);
        } else setAlbumsError(d.error ?? 'Couldn’t load your albums.');
      })
      .catch(() => alive && setAlbumsError('Couldn’t load your albums.'));
    return () => {
      alive = false;
    };
  }, [show]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const [chosen, setChosen] = useState<string[]>(initialTags);
  const newPlaylist = usePlaylistPicker();
  const router = useRouter();
  // Changes you just made, shown at once (the page refreshes behind them).
  const [moved, setMoved] = useState<Record<string, boolean>>({});
  const [pins, setPins] = useState<Record<string, string | null>>({});
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [known, setKnown] = useState<Tag[]>(tagsProp);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Start again from the server's copy whenever the page refreshes.
  useEffect(() => {
    setTagMap(Object.fromEntries(playlists.map((p) => [p.id, p.tags])));
    setPins({});
  }, [playlists]);
  useEffect(() => setKnown(tagsProp), [tagsProp]);
  useEffect(() => setChosen(initialTags), [initialTags.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const aside = (p: PlaylistCard) => moved[p.id] ?? p.set_aside;
  const pinnedAt = (p: PlaylistCard) => (p.id in pins ? pins[p.id] : p.pinned_at);
  const tagsOf = (p: PlaylistCard) => tagMap[p.id] ?? p.tags;
  const byId = useMemo(() => new Map(known.map((t) => [t.id, t])), [known]);

  // Remember your last choice on this phone.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.sort && SORTS.some((s) => s.id === saved.sort)) setSort(saved.sort);
      if (saved?.show && (saved.show === 'aside' || saved.show === 'radios' || saved.show === 'albums' || SHOWS.some((s) => s.id === saved.show))) setShow(saved.show);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sort, show }));
    } catch {
      /* ignore */
    }
  }, [sort, show]);

  const flash = (text: string, ms = 2500) => {
    setNote(text);
    setTimeout(() => setNote(null), ms);
  };

  // ── Switching views (T3) ──
  const go = (next: HomeView, nextTags = chosen) => {
    if (base === '/library') {
      // Library: the music side is the Library's own song list.
      router.push(next === 'songs' ? '/library' : libraryPlaylistsHref(nextTags));
      return;
    }
    try {
      document.cookie = `mh-home-view=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
    router.push(homeHref(next, nextTags, songs?.sort));
  };

  // ── Tags menu (G2) ──
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of playlists) for (const t of tagsOf(p)) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [playlists, tagMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuTags = known.filter((t) => (counts.get(t.id) ?? 0) > 0 || chosen.includes(t.id));
  const chooseTags = (next: string[]) => {
    setChosen(next);
    setPicked(new Set());
    if (view === 'songs') {
      router.replace(homeHref('songs', next, songs?.sort));
    } else {
      try {
        window.history.replaceState(null, '', base === '/library' ? libraryPlaylistsHref(next) : homeHref('playlists', next));
      } catch {
        /* ignore */
      }
    }
  };
  const toggleTag = (id: string) => chooseTags(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const chosenNames = chosen.map((id) => byId.get(id)?.name).filter(Boolean) as string[];

  // ── Playlists ──
  const matches = (p: PlaylistCard) => chosen.every((t) => tagsOf(p).includes(t));
  const shown = useMemo(
    () =>
      playlists.filter(
        (p) => (show === 'aside' ? aside(p) : !aside(p) && (show === 'all' || p.service === show)) && matches(p),
      ),
    [playlists, show, moved, chosen, tagMap], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const byName = (a: PlaylistCard, b: PlaylistCard) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sorted = useMemo(
    () =>
      [...shown].sort((a, b) => {
        if (sort === 'az') return byName(a, b);
        if (sort === 'size') return b.count - a.count || byName(a, b);
        const ta = a.last_added_at ? Date.parse(a.last_added_at) : 0;
        const tb = b.last_added_at ? Date.parse(b.last_added_at) : 0;
        return tb - ta || byName(a, b);
      }),
    [shown, sort],
  );
  const pinnedList = shown
    .filter((p) => pinnedAt(p))
    .sort((a, b) => Date.parse(pinnedAt(a)!) - Date.parse(pinnedAt(b)!));
  const showTop = !selecting && show !== 'aside';
  const rest = showTop ? sorted.filter((p) => !pinnedAt(p)) : [...pinnedList, ...sorted.filter((p) => !pinnedAt(p))];
  const shelf = showTop
    ? shown
        .filter((p) => !pinnedAt(p) && p.last_added_at)
        .sort((a, b) => Date.parse(b.last_added_at!) - Date.parse(a.last_added_at!))
        .slice(0, 12)
    : [];

  const missingDates = sort === 'recent' && playlists.some((p) => !p.last_added_at);
  const current = SORTS.find((s) => s.id === sort)!;
  const songSort = SONG_SORTS.find((s) => s.id === songs?.sort) ?? SONG_SORTS[0];
  const asideCount = playlists.filter(aside).length;
  useEffect(() => {
    if (show === 'aside' && asideCount === 0) setShow('all');
  }, [show, asideCount]);
  useEffect(() => setPicked(new Set()), [show]);

  // ── Select bar: Pin, Tag…, Set aside ──
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setTagging(false);
  };
  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickedCards = playlists.filter((p) => picked.has(p.id));
  const allPinned = pickedCards.length > 0 && pickedCards.every((p) => pinnedAt(p));
  const post = async (url: string, body: object) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error);
  };
  const n = (k: number) => (k === 1 ? '1 playlist' : `${k} playlists`);
  const run = async (work: () => Promise<string>) => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      flash(await work());
      stopSelecting();
      router.refresh();
    } catch (e) {
      flash((e as Error).message || 'Couldn’t do that. Try again.', 3500);
    } finally {
      setBusy(false);
    }
  };
  const putAside = (value: boolean) =>
    run(async () => {
      const ids = [...picked];
      await post('/api/playlists/set-aside', { ids, aside: value });
      setMoved((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, value])) }));
      return value ? `Set aside ${n(ids.length)}` : `Brought back ${n(ids.length)}`;
    });
  const pin = (value: boolean) =>
    run(async () => {
      // Keep the order they appear in on screen.
      const ids = rest.map((p) => p.id).filter((id) => picked.has(id));
      await post('/api/playlists/pin', { ids, pinned: value });
      const now = Date.now();
      setPins((old) => ({
        ...old,
        ...Object.fromEntries(
          ids.map((id, i) => {
            const was = playlists.find((p) => p.id === id);
            return [id, value ? (was && pinnedAt(was)) || new Date(now + i).toISOString() : null];
          }),
        ),
      }));
      return value ? `Pinned ${n(ids.length)}` : `Unpinned ${n(ids.length)}`;
    });

  const onTagChange = (tag: Tag, on: boolean) => {
    setKnown((old) => (old.some((t) => t.id === tag.id) ? old : [...old, tag].sort((a, b) => a.name.localeCompare(b.name))));
    setTagMap((old) => {
      const next = { ...old };
      for (const id of picked) {
        const have = next[id] ?? [];
        next[id] = on ? (have.includes(tag.id) ? have : [...have, tag.id]) : have.filter((t) => t !== tag.id);
      }
      return next;
    });
  };

  // ── Pieces ──
  const tagDots = (p: PlaylistCard) => {
    const list = tagsOf(p).map((id) => byId.get(id)).filter(Boolean) as Tag[];
    return list.length ? (
      <span className="tag-dots" aria-label={`Tags: ${list.map((t) => t.name).join(', ')}`}>
        {list.slice(0, 5).map((t) => (
          <i key={t.id} className={`tag-${t.color}`} />
        ))}
      </span>
    ) : null;
  };
  const cover = (p: PlaylistCard) =>
    p.image_url ? <img src={smallCover(p.image_url)} alt="" loading="lazy" decoding="async" /> : <div className="ph" />;

  const switcher = (
    <span className="home-switch" role="group" aria-label="Show">
      <button type="button" aria-pressed={view === 'playlists'} aria-label="Playlists" onClick={() => view !== 'playlists' && go('playlists')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="12" height="12" rx="2" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /></svg>
      </button>
      <button type="button" aria-pressed={view === 'songs'} aria-label="All songs" onClick={() => view !== 'songs' && go('songs')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
      </button>
    </span>
  );
  const tagButton = (
    <button
      type="button"
      className="pl-chip pl-tags-btn"
      aria-pressed={chosen.length > 0}
      aria-haspopup="menu"
      aria-expanded={tagMenu}
      onClick={() => {
        setMenuOpen(false);
        setTagMenu(!tagMenu);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" /></svg>
      Tags{chosen.length ? ` · ${chosen.length}` : ''}
    </button>
  );

  return (
    <section className="playlists">
      <div className="pl-head">
        <h2>{view === 'songs' ? 'Songs' : show === 'aside' ? 'Set aside' : 'Playlists'}</h2>
        {view === 'songs' ? (
          songs && songs.tracks.length > 0 && (
            <PlayButtons tracks={songs.tracks} source={{ query: songs.query, total: songs.total }} />
          )
        ) : (
          <span className="pl-head-btns">
            <button
              type="button"
              className="pl-new"
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              {selecting ? 'Cancel' : 'Select'}
            </button>
            {!selecting && (
              <button type="button" className="pl-new" onClick={() => newPlaylist([])}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                New
              </button>
            )}
          </span>
        )}
      </div>

      {/* Jump back in (Speed Dial pick P1): top of Home's playlist view */}
      {view === 'playlists' && showTop && dial && <SpeedDial dial={dial} />}

      {/* P2: pinned playlists as quick tiles */}
      {view === 'playlists' && showTop && pinnedList.length > 0 && (
        <div className="pin-tiles" aria-label="Pinned playlists">
          {pinnedList.map((p) => (
            <Link key={p.id} href={`/playlists/${p.id}`} className="pin-tile">
              {cover(p)}
              <span className="title">{p.name}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Switch · Sort · Tags · service chips, on one line that scrolls sideways */}
      <div className="pl-controls-wrap">
        <div className="pl-controls">
          {switcher}
          <span className="pl-divider" aria-hidden="true" />
          <button
            type="button"
            className="pl-sort-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Sort: ${view === 'songs' ? songSort.short : current.short}`}
            onClick={() => {
              setTagMenu(false);
              setMenuOpen(!menuOpen);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
            {view === 'songs' ? songSort.short : current.short}
          </button>
          {(menuTags.length > 0 || chosen.length > 0) && tagButton}
          {view === 'playlists' && (
            <div className="pl-chips" role="group" aria-label="Show playlists from">
              {SHOWS.map((s) => (
                <button key={s.id} type="button" className="pl-chip" aria-pressed={show === s.id} onClick={() => setShow(s.id)}>
                  {s.id !== 'all' && <span className={`dot ${s.id}`} />}
                  {s.label}
                </button>
              )).flatMap((chip, k) =>
                SHOWS[k].id === 'hub'
                  ? [
                      chip,
                      <button
                        key="radios"
                        type="button"
                        className="pl-chip pl-radios-chip"
                        aria-pressed={show === 'radios'}
                        onClick={() => setShow(show === 'radios' ? 'all' : 'radios')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="picon" dangerouslySetInnerHTML={{ __html: PLAYER_ICONS.radio }} />
                        Radios
                      </button>,
                      <button
                        key="albums"
                        type="button"
                        className="pl-chip pl-albums-chip"
                        aria-pressed={show === 'albums'}
                        onClick={() => setShow(show === 'albums' ? 'all' : 'albums')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.2" /></svg>
                        Albums
                      </button>,
                    ]
                  : [chip],
              )}
              {(asideCount > 0 || show === 'aside') && (
                <button
                  type="button"
                  className="pl-chip pl-aside-chip"
                  aria-pressed={show === 'aside'}
                  onClick={() => setShow(show === 'aside' ? 'all' : 'aside')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16v10H4zM3 5h18v4H3zM10 13h4" /></svg>
                  Set aside · {asideCount}
                </button>
              )}
            </div>
          )}
        </div>
        {menuOpen && (
          <>
            <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="row-menu pl-menu" role="menu">
              {view === 'songs'
                ? SONG_SORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={songSort.id === s.id}
                      onClick={() => {
                        setMenuOpen(false);
                        router.replace(homeHref('songs', chosen, s.id));
                      }}
                    >
                      {s.label}
                    </button>
                  ))
                : SORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sort === s.id}
                      onClick={() => {
                        setSort(s.id);
                        setMenuOpen(false);
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
            </div>
          </>
        )}
        {tagMenu && (
          <>
            <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setTagMenu(false)} />
            <div className="row-menu pl-menu tag-menu" role="menu" aria-label="Tags">
              {menuTags.length === 0 && <p className="small muted tag-menu-empty">No tags yet.</p>}
              {menuTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={chosen.includes(t.id)}
                  className="tag-menu-item"
                  onClick={() => toggleTag(t.id)}
                >
                  <span className={`ck${chosen.includes(t.id) ? ' on' : ''}`} aria-hidden="true" />
                  <i className={`tag-dot tag-${t.color}`} aria-hidden="true" />
                  <span className="tag-menu-name">{t.name}</span>
                  <span className="muted small">{counts.get(t.id) ?? 0}</span>
                </button>
              ))}
              <div className="tag-menu-foot">
                {chosen.length > 0 && (
                  <button type="button" onClick={() => chooseTags([])}>
                    Clear
                  </button>
                )}
                <button type="button" className="tag-menu-done" onClick={() => setTagMenu(false)}>
                  Done
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {chosenNames.length > 0 && (
        <p className="small muted tag-note">
          {view === 'songs'
            ? `${(songs?.total ?? 0).toLocaleString()} songs from playlists tagged ${chosenNames.join(' + ')}`
            : `Playlists tagged ${chosenNames.join(' + ')}`}
        </p>
      )}

      {/* ── All songs ── */}
      {view === 'songs' && songs && (
        <div style={{ marginTop: 4 }}>
          {songs.error && <div className="notice error">{songs.error}</div>}
          <LibraryList key={songs.query} initial={songs.tracks} total={songs.total} query={songs.query} />
          {songs.tracks.length === 0 && !songs.error && (
            <p className="muted">{chosen.length ? 'No songs in playlists with all of those tags.' : 'No songs yet.'}</p>
          )}
        </div>
      )}

      {/* ── Radios (chip after Mine) ── */}
      {view === 'playlists' && show === 'radios' && (
        <div style={{ marginTop: 8 }}>
          {radiosError && <div className="notice error">{radiosError}</div>}
          {!radios && !radiosError && <p className="small muted">Loading your radios…</p>}
          {radios && <RadioList radios={radios} />}
        </div>
      )}

      {/* ── Albums (chip after Radios) ── */}
      {view === 'playlists' && show === 'albums' && (
        <div style={{ marginTop: 8 }}>
          {albumsError && <div className="notice error">{albumsError}</div>}
          {!albums && !albumsError && <p className="small muted">Loading your albums…</p>}
          {albums && <AlbumList albums={albums} />}
        </div>
      )}

      {/* ── Playlists ── */}
      {view === 'playlists' && show !== 'radios' && show !== 'albums' && (
        <>
          {show === 'aside' && (
            <p className="small muted pl-aside-note">Kept out of your taste profile. They still play as usual.</p>
          )}

          {/* L3: Recently updated shelf */}
          {shelf.length > 2 && (
            <>
              <div className="pl-sec">Recently updated</div>
              <div className="pl-shelf">
                {shelf.map((p) => (
                  <Link key={p.id} href={`/playlists/${p.id}`} className="shelf-tile">
                    {cover(p)}
                    <span className="title">{p.name}</span>
                    <span className="sub">{ago(p.last_added_at)}</span>
                  </Link>
                ))}
              </div>
              <div className="pl-sec">All playlists</div>
            </>
          )}

          <div className="list">
            {rest.map((p) => {
              const inner = (
                <>
                  {selecting && <span className={`tick${picked.has(p.id) ? ' on' : ''}`} aria-hidden="true" />}
                  {cover(p)}
                  <div className="main">
                    <div className="title">{p.name}</div>
                    <div className="sub pl-meta">
                      <span className={`dot ${p.service}`} />
                      {p.service === 'spotify' ? 'Spotify' : p.service === 'youtube' ? 'YouTube' : 'Music Hub'} · {p.count.toLocaleString()} songs
                      {sort === 'recent' && p.last_added_at ? ` · ${ago(p.last_added_at)}` : ''}
                      {tagDots(p)}
                    </div>
                  </div>
                  {selecting && pinnedAt(p) && (
                    <svg className="pin-mark" viewBox="0 0 24 24" aria-label="Pinned">{PIN}</svg>
                  )}
                  {!selecting && <span className="muted" aria-hidden="true">›</span>}
                </>
              );
              return selecting ? (
                <button
                  type="button"
                  className="item pl-row pl-pick"
                  key={p.id}
                  aria-pressed={picked.has(p.id)}
                  onClick={() => toggle(p.id)}
                >
                  {inner}
                </button>
              ) : (
                <Link className="item pl-row" key={p.id} href={`/playlists/${p.id}`}>
                  {inner}
                </Link>
              );
            })}
            {rest.length === 0 && pinnedList.length === 0 && (
              <p className="muted">{chosen.length ? 'No playlists have all of those tags.' : 'No playlists here yet.'}</p>
            )}
          </div>

          {missingDates && (
            <p className="small muted" style={{ marginTop: 12 }}>
              Some playlists don’t have an “updated” date yet. Tap Import playlists in Services once for each service to fill
              them in.
            </p>
          )}
        </>
      )}

      {selecting && view === 'playlists' && (
        <div className="select-bar home-select-bar" role="toolbar" aria-label="Selected playlists">
          <span className="select-count">{picked.size === 0 ? 'Tap to pick' : `${picked.size} picked`}</span>
          {show !== 'aside' && (
            <button type="button" disabled={!picked.size || busy} onClick={() => pin(!allPinned)}>
              {allPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          <button type="button" disabled={!picked.size || busy} onClick={() => setTagging(true)}>
            Tag…
          </button>
          <button type="button" className="primary" disabled={!picked.size || busy} onClick={() => putAside(show !== 'aside')}>
            {show === 'aside' ? 'Bring back' : 'Set aside'}
          </button>
        </div>
      )}
      {tagging && picked.size > 0 && (
        <TagSheet
          playlistIds={[...picked]}
          what={pickedCards.map((p) => p.name).join(', ')}
          tags={known}
          assigned={tagMap}
          onChange={onTagChange}
          onClose={() => {
            setTagging(false);
            router.refresh();
          }}
        />
      )}
      {note && (
        <div className="flash-toast" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {note}
        </div>
      )}
    </section>
  );
}
