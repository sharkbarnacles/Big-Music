import FlashToast from '@/components/FlashToast';
import Header from '@/components/Header';
import PlaylistBrowser, { type PlaylistCard } from '@/components/PlaylistBrowser';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Home (Home Top Lab pick H2 + T2 + V3 + N2): small header with Services and
// Account buttons, one line of library numbers, then playlists.

type PlaylistRow = {
  id: string;
  service: 'spotify' | 'youtube' | 'hub';
  name: string;
  image_url: string | null;
  imported_at: string;
  last_added_at: string | null;
  playlist_items: { count: number }[];
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const [playlistsRes, tracksRes] = await Promise.all([
    db()
      .from('playlists')
      .select('id, service, name, image_url, imported_at, last_added_at, playlist_items(count)')
      .order('name'),
    db().from('tracks').select('id', { count: 'exact', head: true }),
  ]);
  const playlists = (playlistsRes.data ?? []) as unknown as PlaylistRow[];
  const cards: PlaylistCard[] = playlists.map((p) => ({
    id: p.id,
    service: p.service,
    name: p.name,
    image_url: p.image_url,
    count: p.playlist_items?.[0]?.count ?? 0,
    last_added_at: p.last_added_at,
  }));

  return (
    <main className="wrap">
      <Header />

      {connected && <FlashToast message={`Connected ${connected === 'spotify' ? 'Spotify' : 'YouTube Music'}`} />}
      {error && <FlashToast error message={`Sign-in problem: ${error}`} />}
      {playlistsRes.error && (
        <div className="notice error">
          Database error: {playlistsRes.error.message}. Did you run supabase/schema.sql?
        </div>
      )}

      <p className="lib-line">
        <b>{(tracksRes.count ?? 0).toLocaleString()}</b> songs · <b>{playlists.length.toLocaleString()}</b> playlists
      </p>

      <PlaylistBrowser playlists={cards} />
    </main>
  );
}
