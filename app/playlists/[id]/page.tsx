import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import TrackList from '@/components/TrackList';
import { TRACK_COLUMNS, type TrackRowData } from '@/lib/tracks';
import { db, fetchAllRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: playlist } = await db()
    .from('playlists')
    .select('id, service, name, description, image_url, imported_at')
    .eq('id', id)
    .maybeSingle();
  if (!playlist) notFound();

  const { rows: items, error } = await fetchAllRows<any>((from, to) =>
    db()
      .from('playlist_items')
      .select(`position, tracks(${TRACK_COLUMNS})`)
      .eq('playlist_id', id)
      .order('position')
      .range(from, to),
  );

  const tracks = items
    .map((row) => row.tracks as TrackRowData | null)
    .filter((t): t is TrackRowData => t !== null);

  return (
    <main className="wrap">
      <Header />
      <h1>{playlist.name}</h1>
      <div className="muted small">
        <span className={`dot ${playlist.service}`} />
        {playlist.service === 'spotify' ? 'Spotify' : 'YouTube Music'} · {tracks.length} songs · imported{' '}
        {new Date(playlist.imported_at).toLocaleDateString()}
      </div>
      {playlist.description && <p className="muted">{playlist.description}</p>}
      {error && <div className="notice error">{error}</div>}

      <div style={{ marginTop: 20 }}>
        <TrackList tracks={tracks} />
      </div>
    </main>
  );
}
