import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import PlayButtons from '@/components/PlayButtons';
import { DiscoverList } from '@/components/Discover';
import { getEdition, toTrack } from '@/lib/discover';

export const dynamic = 'force-dynamic';

const KIND_NOTE: Record<string, string> = {
  daily: 'Daily discover',
  weekly: 'Weekly · new-to-you music',
  releases: 'Weekly · new from your artists',
  month: 'Monthly · what you played and kept most',
  forgotten: 'Monthly · from your own library',
};

// One edition, exactly as it was made. It never changes.
export default async function EditionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const edition = await getEdition(id);
  if (!edition) notFound();
  const tracks = edition.items.map(toTrack);
  const date = new Date(`${edition.edition_date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

  return (
    <main className="wrap">
      <Header />
      <Link href="/discover" className="muted small d-back">‹ Discover</Link>
      <div className="page-title">
        <h1>{edition.title}</h1>
        <PlayButtons tracks={tracks} />
      </div>
      <div className="muted small">
        {KIND_NOTE[edition.kind]} · {tracks.length} songs · {date}
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>Tap the heart to keep a song in your Discoveries playlist.</p>
      <div style={{ marginTop: 10 }}>
        <DiscoverList tracks={tracks} items={edition.items} />
      </div>
    </main>
  );
}
