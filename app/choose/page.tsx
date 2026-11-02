import Header from '@/components/Header';
import { db } from '@/lib/db';
import { autoInclude, MUSIC_THRESHOLD } from '@/lib/library';

export const dynamic = 'force-dynamic';

type SourceRow = {
  service: 'spotify' | 'youtube';
  external_id: string;
  name: string;
  item_count: number;
  music_ratio: number | null;
  user_choice: boolean | null;
};

export default async function ChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; saved?: string }>;
}) {
  const { service: raw, saved } = await searchParams;
  const service = raw === 'spotify' ? 'spotify' : 'youtube';
  const label = service === 'spotify' ? 'Spotify' : 'YouTube Music';

  const { data, error } = await db()
    .from('source_playlists')
    .select('service, external_id, name, item_count, music_ratio, user_choice')
    .eq('service', service)
    .order('name');
  const rows = (data ?? []) as unknown as SourceRow[];

  return (
    <main className="wrap">
      <Header />
      <h1>Choose {label} playlists</h1>
      <p className="muted small">
        {service === 'youtube'
          ? `Ticked playlists are imported. By default, a playlist is ticked when at least ${Math.round(
              MUSIC_THRESHOLD * 100,
            )}% of it is music, and non-music videos inside it are left out. If you tick one yourself, everything in it is kept.`
          : 'Ticked playlists are imported. Untick any you don’t want in your library.'}
      </p>

      {saved && <div className="notice">Saved. Unticked playlists were removed; run <b>Import playlists</b> again to add newly ticked ones.</div>}
      {error && <div className="notice error">{error.message} (did you re-run schema.sql?)</div>}
      {!error && rows.length === 0 && (
        <p className="muted">Nothing here yet. Run <b>Import playlists</b> once from the home page, then come back.</p>
      )}

      {rows.length > 0 && (
        <form action="/api/playlist-choices" method="post">
          <input type="hidden" name="service" value={service} />
          <div className="list">
            {rows.map((r) => {
              const auto = autoInclude(r.service, r.external_id, r.music_ratio);
              const checked = r.user_choice ?? auto;
              return (
                <label className="item" key={r.external_id} style={{ cursor: 'pointer' }}>
                  <input type="hidden" name="all" value={r.external_id} />
                  <input type="checkbox" name="include" value={r.external_id} defaultChecked={checked} />
                  <div className="main">
                    <div className="title">{r.name}</div>
                    <div className="sub">
                      {r.item_count} items
                      {service === 'youtube' && r.music_ratio !== null && ` · ${Math.round(r.music_ratio * 100)}% music`}
                      {r.user_choice === null ? ' · automatic' : ' · your choice'}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="primary" type="submit">Save choices</button>
            <button type="submit" name="reset" value="1">Reset all to automatic</button>
          </div>
        </form>
      )}
    </main>
  );
}
