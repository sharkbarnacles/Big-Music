import Link from 'next/link';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import { findAlbum } from '@/lib/findAlbum';

export const dynamic = 'force-dynamic';

// /album?name=…&artist=…: opens that album's page in the hub (from YouTube Music).
export default async function AlbumByName({ searchParams }: { searchParams: Promise<{ name?: string; artist?: string }> }) {
  const sp = await searchParams;
  const name = (sp.name ?? '').trim().slice(0, 150);
  const artist = (sp.artist ?? '').trim().slice(0, 120);
  const hit = name ? await findAlbum(name, artist) : null;
  if (hit) redirect(`/web/album/${encodeURIComponent(hit.id)}`);
  return (
    <main className="wrap">
      <Header />
      <h1>{name || 'Album'}</h1>
      <p className="muted">YouTube Music didn’t find this album just now. Try again in a moment.</p>
      {artist && (
        <p>
          <Link href={`/artist?name=${encodeURIComponent(artist)}`} className="web-more">
            Open {artist} ›
          </Link>
        </p>
      )}
    </main>
  );
}
