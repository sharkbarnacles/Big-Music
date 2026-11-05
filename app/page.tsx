import { cookies } from 'next/headers';
import FlashToast from '@/components/FlashToast';
import Header from '@/components/Header';
import PlaylistBrowser, { type HomeSongs, type HomeView, type PlaylistCard } from '@/components/PlaylistBrowser';
import { db, fetchAllRows } from '@/lib/db';
import { trackQueryString, type TrackQuery } from '@/lib/libraryParams';
import { loadTracks } from '@/lib/libraryQuery';
import { listTags } from '@/lib/playlistTags';

export const dynamic = 'force-dynamic';

// Home (Home Top Lab pick H2 + T2 + V3 + N2 for the top; Home Lab pick
// L3 + T3 + P2 + G2 + E3 below): small header, one line of numbers, then
// your playlists or, with the switch, every song in your library.
// ?view=playlists|songs (else the last one you used, cookie mh-home-view),
// ?tags=id,id (chosen tags), ?ssort= (song order). Needs playlists.pinned_at,
// playlist_tags and library_page(tag_ids) from supabase/schema.sql.

type PlaylistRow = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  last_added_at: string | null;
  set_aside: boolean;
  pinned_at: string | null;
  playlist_items: { count: number }[];
  playlist_tags: { tag_id: string }[];
};

const SONG_SORTS = ['recent', 'artist', 'title'];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; view?: string; tags?: string; ssort?: string }>;
}) {
  const sp = await searchParams;
  const saved = (await cookies()).get('mh-home-view')?.value;
  const wanted = sp.view ?? saved;
  const view: HomeView = wanted === 'songs' ? 'songs' : 'playlists';
  const chosen = (sp.tags ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const songSort = SONG_SORTS.includes(sp.ssort ?? '') ? sp.ssort! : 'recent';

  const songQuery: TrackQuery = { sort: songSort, tags: chosen.join(',') || undefined };
  const [playlistsRes, tracksRes, tags, songPage] = await Promise.all([
    fetchAllRows<PlaylistRow>((from, to) =>
      db()
        .from('playlists')
        .select('id, service, name, image_url, last_added_at, set_aside, pinned_at, playlist_items(count), playlist_tags(tag_id)')
        .order('name')
        .range(from, to),
    ),
    db().from('tracks').select('id', { count: 'exact', head: true }),
    listTags().catch(() => []),
    view === 'songs' ? loadTracks(songQuery, 0, 200) : Promise.resolve(null),
  ]);
  const playlists = playlistsRes.rows;
  const cards: PlaylistCard[] = playlists.map((p) => ({
    id: p.id,
    service: p.service,
    name: p.name,
    image_url: p.image_url,
    count: p.playlist_items?.[0]?.count ?? 0,
    last_added_at: p.last_added_at,
    set_aside: !!p.set_aside,
    pinned_at: p.pinned_at,
    tags: (p.playlist_tags ?? []).map((t) => t.tag_id),
  }));
  const songs: HomeSongs | undefined = songPage
    ? {
        tracks: songPage.tracks,
        total: songPage.total ?? songPage.tracks.length,
        query: trackQueryString(songQuery),
        sort: songSort,
        error: songPage.error,
      }
    : undefined;

  return (
    <main className="wrap">
      <Header />

      {sp.connected && <FlashToast message={`Connected ${sp.connected === 'spotify' ? 'Spotify' : 'YouTube Music'}`} />}
      {sp.error && <FlashToast error message={`Sign-in problem: ${sp.error}`} />}
      {playlistsRes.error && (
        <div className="notice error">
          Database error: {playlistsRes.error}. Did you run supabase/schema.sql?
        </div>
      )}

      <p className="lib-line">
        <b>{(tracksRes.count ?? 0).toLocaleString()}</b> songs · <b>{playlists.length.toLocaleString()}</b> playlists
      </p>

      <PlaylistBrowser playlists={cards} tags={tags} view={view} initialTags={chosen} songs={songs} />
    </main>
  );
}
