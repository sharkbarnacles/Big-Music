import Link from 'next/link';
import Header from '@/components/Header';
import PlayButtons from '@/components/PlayButtons';
import { ArchiveCalendar, RadioExplore, TodayGrid } from '@/components/Discover';
import { latestEditions, toTrack, type Edition } from '@/lib/discover';
import { smallCover } from '@/lib/img';

export const dynamic = 'force-dynamic';

// Your Discover pick: P3 shelves + T5 two-row Today + W2 weekly + M3 monthly + A1 calendar + E3 radio (moods next).
// Every list here was made once, has a date, and never changes.

const NY = 'America/New_York';
const todayInNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date()); // YYYY-MM-DD
const nice = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

function MixCard({ edition, fallback }: { edition?: Edition; fallback: { title: string; note: string } }) {
  if (!edition) {
    return (
      <div className="d-mix empty">
        <span className="d-quad" aria-hidden="true" />
        <span className="d-nm">{fallback.title}</span>
        <span className="d-ar">{fallback.note}</span>
      </div>
    );
  }
  const covers = edition.items.map((i) => i.image_url).filter(Boolean).slice(0, 4) as string[];
  return (
    <Link href={`/discover/${edition.id}`} className="d-mix">
      <span className="d-quad" aria-hidden="true">
        {covers.map((c, i) => (
          <img key={i} src={smallCover(c)} alt="" loading="lazy" decoding="async" />
        ))}
      </span>
      <span className="d-nm">{edition.title}</span>
      <span className="d-ar">
        {edition.items.length} songs · {edition.subtitle ?? nice(edition.edition_date)}
      </span>
    </Link>
  );
}

export default async function DiscoverPage() {
  const today = todayInNY();
  const e = await latestEditions();
  const daily = e.daily;
  const dailyTracks = daily ? daily.items.map(toTrack) : [];
  const isToday = daily?.edition_date === today;
  const nothingYet = !daily && !e.weekly && !e.forgotten;

  const now = new Date(`${today}T12:00:00Z`);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

  return (
    <main className="wrap">
      <Header />
      <div className="page-title">
        <h1>Discover</h1>
      </div>

      {nothingYet && (
        <div className="notice small">
          Your first lists are being made in the background. They arrive every morning at about 6:40 am, and nothing on
          this page ever changes or disappears once it&apos;s here.
        </div>
      )}

      {daily && (
        <section className="d-sec">
          <div className="d-sech">
            <div>
              <h2>Daily discover</h2>
              <div className="d-stamp">
                <b>{nice(daily.edition_date)}</b>{' '}
                {isToday ? '· stays until tomorrow' : '· today’s list arrives at about 6:40 am'}
              </div>
            </div>
            <PlayButtons tracks={dailyTracks} />
          </div>
          <TodayGrid tracks={dailyTracks} items={daily.items} />
        </section>
      )}

      <section className="d-sec">
        <div className="d-sech">
          <div>
            <h2>This week</h2>
            <div className="d-stamp">Each one stays until its next day</div>
          </div>
        </div>
        <div className="d-mixes">
          <MixCard edition={e.weekly} fallback={{ title: 'Monday Discovery', note: '30 songs every Monday' }} />
          <MixCard edition={e.releases} fallback={{ title: 'Friday New Releases', note: 'First one this Friday' }} />
        </div>
      </section>

      <section className="d-sec">
        <div className="d-sech">
          <div>
            <h2>This month</h2>
            <div className="d-stamp">Made on the 1st · next on {nice(nextMonth, { day: 'numeric', month: 'short' })}</div>
          </div>
        </div>
        <div className="d-mixes">
          <MixCard
            edition={e.month}
            fallback={{ title: 'Month mix', note: `First one on ${nice(nextMonth, { day: 'numeric', month: 'short' })}, from what you play` }}
          />
          <MixCard edition={e.forgotten} fallback={{ title: 'Forgotten favorites', note: 'Arriving with the next list' }} />
        </div>
      </section>

      <section className="d-sec">
        <div className="d-sech">
          <div>
            <h2>Radio</h2>
            <div className="d-stamp">Plays as a queue; never changes your mixes</div>
          </div>
          <Link href="/taste" className="muted small">Your taste ›</Link>
        </div>
        <RadioExplore
          seeds={[
            { label: 'From today’s picks', tracks: dailyTracks },
            { label: 'From this week', tracks: e.weekly ? e.weekly.items.map(toTrack) : [] },
            { label: 'From forgotten favorites', tracks: e.forgotten ? e.forgotten.items.map(toTrack) : [] },
          ]}
        />
      </section>

      <section className="d-sec">
        <div className="d-sech">
          <div>
            <h2>Past editions</h2>
            <div className="d-stamp">Kept forever</div>
          </div>
        </div>
        <ArchiveCalendar today={today} />
      </section>
    </main>
  );
}
