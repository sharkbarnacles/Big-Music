import Link from 'next/link';
import Header from '@/components/Header';
import ImportButton from '@/components/ImportButton';
import { getConnection } from '@/lib/connections';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PlaylistRow = {
  id: string;
  service: 'spotify' | 'youtube';
  name: string;
  image_url: string | null;
  imported_at: string;
  playlist_items: { count: number }[];
};

const SERVICES = [
  { id: 'spotify', name: 'Spotify', connect: '/api/auth/spotify/start' },
  { id: 'youtube', name: 'YouTube Music', connect: '/api/auth/google/start' },
] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const [spotify, youtube, playlistsRes, tracksRes] = await Promise.all([
    getConnection('spotify'),
    getConnection('youtube'),
    db()
      .from('playlists')
      .select('id, service, name, image_url, imported_at, playlist_items(count)')
      .order('name'),
    db().from('tracks').select('id', { count: 'exact', head: true }),
  ]);
  const connections = { spotify, youtube };
  const playlists = (playlistsRes.data ?? []) as unknown as PlaylistRow[];

  return (
    <main className="wrap">
      <Header />

      {connected && <div className="notice">Connected {connected === 'spotify' ? 'Spotify' : 'YouTube Music'}.</div>}
      {error && <div className="notice error">Sign-in problem — {error}</div>}
      {playlistsRes.error && (
        <div className="notice error">
          Database error: {playlistsRes.error.message}. Did you run supabase/schema.sql?
        </div>
      )}

      <h1>Your library</h1>
      <div className="stats">
        <div><b>{tracksRes.count ?? 0}</b><span className="muted small">songs</span></div>
        <div><b>{playlists.length}</b><span className="muted small">playlists</span></div>
      </div>

      {/* Folded away once both services are connected; tap the line to open it. */}
      <details className="card collapsible services" open={!(spotify && youtube)}>
        <summary>
          <span className="services-title">Services</span>
          <span className="services-status small muted">
            <span className="dot spotify" style={{ opacity: spotify ? 1 : 0.3 }} />
            <span className="dot youtube" style={{ opacity: youtube ? 1 : 0.3 }} />
            {spotify && youtube ? 'Both connected' : 'Needs attention'}
          </span>
        </summary>
      <div className="grid" style={{ marginTop: 14 }}>
        {SERVICES.map((s) => {
          const conn = connections[s.id];
          return (
            <div className="card" key={s.id}>
              <div className="row">
                <div>
                  <span className={`dot ${s.id}`} />
                  <b>{s.name}</b>
                  <div className="muted small">
                    {conn ? `Connected as ${conn.account_name ?? 'you'}` : 'Not connected'}
                  </div>
                </div>
                <a className="btn" href={s.connect}>{conn ? 'Reconnect' : 'Connect'}</a>
              </div>
              {conn && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                  <ImportButton service={s.id} label="Import playlists" />
                  <Link className="small muted" href={`/choose?service=${s.id}`}>Choose which playlists →</Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </details>

      {SERVICES.map((s) => {
        const list = playlists.filter((p) => p.service === s.id);
        if (list.length === 0) return null;
        return (
          <section key={s.id}>
            <h2><span className={`dot ${s.id}`} />{s.name} playlists</h2>
            <div className="list">
              {list.map((p) => (
                <Link className="item" key={p.id} href={`/playlists/${p.id}`}>
                  {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <div className="ph" />}
                  <div className="main">
                    <div className="title">{p.name}</div>
                    <div className="sub">{p.playlist_items?.[0]?.count ?? 0} songs</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
