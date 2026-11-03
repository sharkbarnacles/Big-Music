import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import HubTrackList from '@/components/HubTrackList';
import PlayButtons from '@/components/PlayButtons';
import PlaylistMenu from '@/components/PlaylistMenu';
import TrackList from '@/components/TrackList';
import { TRACK_COLUMNS, type TrackRowData } from '@/lib/tracks';
import { db, fetchAllRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: playlist } = await db()
    .from('playlists')
    .select('id, service, name, description, image_url, imported_at, last_added_at')
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

  const kept = items.filter((row) => row.tracks);
  const tracks = kept.map((row) => row.tracks as TrackRowData);
  const positions = kept.map((row) => row.position as number);
  const hub = playlist.service === 'hub';
  const services: Record<string, string> = { spotify: 'Spotify', youtube: 'YouTube Music', hub: 'Music Hub' };
  const from = services[playlist.service as string] ?? '';
  const when = hub ? playlist.last_added_at ?? playlist.imported_at : playlist.imported_at;

  return (
    <main className="wrap">
      <Header />
      <div className="page-title">
        <h1>{playlist.name}</h1>
        <span className="play-buttons">
          <PlaylistMenu
            id={playlist.id}
            name={playlist.name}
            hub={hub}
            tracks={tracks.map((t) => ({ id: t.id, title: t.title }))}
          />
          <PlayButtons tracks={tracks} />
        </span>
      </div>
      <div className="muted small">
        <span className={`dot ${playlist.service}`} />
        {from} · {tracks.length.toLocaleString()} songs · {hub ? 'updated' : 'imported'}{' '}
        {new Date(when).toLocaleDateString()}
      </div>
      {playlist.description && <p className="muted">{playlist.description}</p>}
      {error && <div className="notice error">{error}</div>}

      <div style={{ marginTop: 14 }}>
        {hub ? (
          <HubTrackList
            key={`${positions.length}-${positions[positions.length - 1] ?? ''}`}
            playlistId={playlist.id}
            tracks={tracks}
            positions={positions}
          />
        ) : (
          <TrackList tracks={tracks} />
        )}
      </div>
    </main>
  );
}
