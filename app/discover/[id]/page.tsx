import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { DiscoverList, MixActions, Mosaic } from '@/components/Discover';
import { getEdition, toTrack } from '@/lib/discover';

export const dynamic = 'force-dynamic';

// Small label above the title, and the short note in the meta line.
const KIND: Record<string, { badge: string; note: string }> = {
  daily: { badge: 'Daily pick', note: 'new to you' },
  weekly: { badge: 'Weekly mix', note: 'new to you' },
  releases: { badge: 'New releases', note: 'from your artists' },
  month: { badge: 'Monthly mix', note: 'played and kept most' },
  forgotten: { badge: 'Monthly mix', note: 'from your library' },
  radio: { badge: 'Saved radio', note: 'started from a song' },
};

// One edition, exactly as it was made. It never changes.
// Layout: Discovery Page Lab pick H2 + A1 + R2 + E3 (mosaic header, Play pill
// with round buttons, rows with a "via" chip, no explainer text).
export default async function EditionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const edition = await getEdition(id);
  if (!edition) notFound();
  const tracks = edition.items.map(toTrack);
  const date = new Date(`${edition.edition_date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  const kind = KIND[edition.kind] ?? { badge: 'Mix', note: '' };

  return (
    <main className="wrap">
      <Header />
      <Link href="/discover" className="muted small d-back">‹ Discover</Link>
      <div className="mix-head">
        <Mosaic images={tracks.map((t) => t.image_url)} />
        <div className="mix-titles">
          <div className="mix-badge">{kind.badge}</div>
          <h1>{edition.title}</h1>
          <div className="mix-meta">
            <span>{tracks.length} songs</span>
            {kind.note && <span>{kind.note}</span>}
            <span>{date}</span>
          </div>
        </div>
      </div>
      <MixActions tracks={tracks} from={edition.title} editionId={edition.id} savedId={edition.playlist_id ?? null} />
      <DiscoverList tracks={tracks} items={edition.items} from={edition.title} />
      <div className="mix-end" aria-hidden="true" />
    </main>
  );
}
