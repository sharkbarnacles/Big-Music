import Link from 'next/link';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import { searchArtists } from '@/lib/ytBrowse';

export const dynamic = 'force-dynamic';

// /artist?name=…: tapping an artist's name in Now Playing lands here. It finds
// that artist on YouTube Music and opens their page in the hub (top songs,
// albums, singles with "See all", and your own songs by them).
const simple = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

export default async function ArtistByName({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const name = ((await searchParams).name ?? '').trim().slice(0, 120);
  let id: string | null = null;
  if (name) {
    const found = await searchArtists(name).catch(() => []);
    const want = simple(name);
    const hit =
      found.find((a) => simple(a.title) === want) ??
      found.find((a) => simple(a.title).includes(want) || want.includes(simple(a.title))) ??
      found[0];
    id = hit?.id ?? null;
  }
  if (id) redirect(`/web/artist/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`);
  return (
    <main className="wrap">
      <Header />
      <h1>{name || 'Artist'}</h1>
      <p className="muted">YouTube Music didn’t find this artist just now. Try again in a moment.</p>
      {name && (
        <p>
          <Link href={`/library?artist=${encodeURIComponent(name)}`} className="web-more">
            Your songs by {name} ›
          </Link>
        </p>
      )}
    </main>
  );
}
