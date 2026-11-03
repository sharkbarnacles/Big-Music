import Link from 'next/link';
import Header from '@/components/Header';
import VoicePrefs from '@/components/VoicePrefs';
import { db } from '@/lib/db';
import { NOT_STYLE } from '@/lib/taste';

export const dynamic = 'force-dynamic';

const COUNTRY: Record<string, string> = {
  KR: 'South Korea', JP: 'Japan', TH: 'Thailand', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', US: 'United States', GB: 'United Kingdom',
  CA: 'Canada', AU: 'Australia', FR: 'France', DE: 'Germany', SE: 'Sweden', NO: 'Norway', IS: 'Iceland', IE: 'Ireland', ID: 'Indonesia',
  PH: 'Philippines', VN: 'Vietnam', MY: 'Malaysia', SG: 'Singapore', IN: 'India', BR: 'Brazil', MX: 'Mexico', ES: 'Spain', IT: 'Italy',
  NL: 'Netherlands', BE: 'Belgium', NZ: 'New Zealand', JM: 'Jamaica', NG: 'Nigeria', ZA: 'South Africa', XW: 'Worldwide', XE: 'Europe',
};

// What the hub has learned about your taste: favourite artists, genres and
// tags (from MusicBrainz), where your music is from, whose voices, and your
// vocal preferences per language. Radios from words use all of it.
export default async function TastePage() {
  const [{ data: artists }, { data: tags }, { data: overview }, { data: voice }] = await Promise.all([
    db().rpc('taste_artists', { max_rows: 15 }),
    db().rpc('taste_tags', { max_rows: 90 }),
    db().rpc('taste_overview'),
    db().from('taste_settings').select('value').eq('key', 'voice').maybeSingle(),
  ]);
  const o = (overview ?? {}) as any;
  const prog = o.progress ?? {};
  const total = Object.values(prog).reduce((a: number, b: any) => a + Number(b), 0) as number;
  const checked = total - Number(prog.pending ?? 0);
  const styles = ((tags as any[]) ?? []).filter((t) => !NOT_STYLE.test(t.tag)).slice(0, 40);
  const topTag = styles[0]?.weight || 1;
  const countries = (o.countries ?? []) as { country: string; w: number; n: number }[];
  const topCountry = countries[0]?.w || 1;
  const voices = (o.voices ?? []) as { lang: string; voice: string; w: number; n: number }[];
  const byLang = new Map<string, Record<string, number>>();
  for (const v of voices) byLang.set(v.lang, { ...(byLang.get(v.lang) ?? {}), [v.voice]: Number(v.w) });
  const langOrder = ['Thai', 'Chinese', 'Korean', 'Japanese', 'Other'];

  return (
    <main className="wrap">
      <Header />
      <Link href="/discover" className="muted small d-back">‹ Discover</Link>
      <div className="page-title"><h1>Your taste</h1></div>
      <p className="muted small t-lede">
        Built from your library: artists you’ve saved, put in many of your playlists, played and starred, with genres, countries and
        voices from MusicBrainz. Radios from words lean on it.
      </p>

      <section className="t-sec">
        <div className="t-progress" aria-label="Tagging progress">
          <div><b>{checked.toLocaleString()}</b> of {total.toLocaleString()} artists tagged{prog.found ? ` · ${Number(prog.found).toLocaleString()} found on MusicBrainz` : ''}</div>
          <div className="t-bar"><i style={{ width: `${total ? (checked / total) * 100 : 0}%` }} /></div>
          {checked < total && <div className="muted small">Your favourites go first; the rest fills in over about a day.</div>}
        </div>
      </section>

      <section className="t-sec">
        <h2>Vocals you prefer</h2>
        <p className="muted small">A gentle lift in radios for that language. Other voices still play.</p>
        <VoicePrefs initial={((voice as any)?.value ?? {}) as Record<string, string>} />
      </section>

      <section className="t-sec">
        <h2>Artists you love most</h2>
        <ol className="t-artists">
          {((artists as any[]) ?? []).map((a) => (
            <li key={a.artist_key}>
              <Link href={`/library?view=songs&artist=${encodeURIComponent(a.artist)}`}>{a.artist}</Link>
              <span className="muted small">{a.songs} songs · in {a.playlists} playlists</span>
            </li>
          ))}
        </ol>
      </section>

      {styles.length > 0 && (
        <section className="t-sec">
          <h2>Genres and styles</h2>
          <div className="t-tags">
            {styles.map((t) => (
              <span key={t.tag} className="t-tag" style={{ ['--w' as string]: String(0.35 + 0.65 * Math.sqrt(t.weight / topTag)) } as React.CSSProperties}>
                {t.tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {countries.length > 0 && (
        <section className="t-sec">
          <h2>Where your music is from</h2>
          <div className="t-rows">
            {countries.map((c) => (
              <div key={c.country} className="t-row">
                <span>{COUNTRY[c.country] ?? c.country}</span>
                <div className="t-bar"><i style={{ width: `${(c.w / topCountry) * 100}%` }} /></div>
                <span className="muted small">{c.n}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {byLang.size > 0 && (
        <section className="t-sec">
          <h2>Whose voices</h2>
          <div className="t-rows">
            {langOrder.filter((l) => byLang.has(l)).map((l) => {
              const v = byLang.get(l)!;
              const sum = (v.male ?? 0) + (v.female ?? 0) + (v.mixed ?? 0) || 1;
              return (
                <div key={l} className="t-row">
                  <span>{l === 'Other' ? 'Everything else' : l}</span>
                  <div className="t-split" aria-label={`${Math.round(((v.male ?? 0) / sum) * 100)}% male`}>
                    <i className="m" style={{ width: `${((v.male ?? 0) / sum) * 100}%` }} />
                    <i className="x" style={{ width: `${((v.mixed ?? 0) / sum) * 100}%` }} />
                    <i className="f" style={{ width: `${((v.female ?? 0) / sum) * 100}%` }} />
                  </div>
                  <span className="muted small">{Math.round(((v.male ?? 0) / sum) * 100)}% male</span>
                </div>
              );
            })}
          </div>
          <div className="t-legend muted small"><span><i className="m" />male</span><span><i className="x" />mixed group</span><span><i className="f" />female</span></div>
        </section>
      )}
      <div className="mix-end" aria-hidden="true" />
    </main>
  );
}
