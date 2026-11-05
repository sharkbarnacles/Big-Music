// Home's speed dial (Speed Dial Lab pick S1 + C3 + T1 + P1 + A1 + N1):
// "Jump back in" — your recent radios and the albums, artists and songs you've
// been enjoying, six of each, one kind at a time (chips).
// "Enjoyed" = played for 30 seconds or more (table plays). An album needs 2
// different songs or 3 plays in the last 60 days, an artist 2 plays, so one
// stray play doesn't fill the dial.
import { db } from './db';
import { TRACK_COLUMNS, type TrackRowData } from './tracks';
import { splitTitle } from './titles';

export type DialKind = 'radio' | 'album' | 'artist' | 'song';
export type DialItem = {
  kind: DialKind;
  key: string;
  title: string;
  sub: string;
  image: string | null;
  href: string | null; // page to open (songs have none: tapping plays)
  // How the play button plays it.
  play: { radio?: string; album?: { name: string; artist: string }; artist?: string; track?: TrackRowData };
};
export type SpeedDial = Record<DialKind, DialItem[]>;

const PER_KIND = 6;
const mainArtist = (a: string) =>
  (a.split(/\s*(?:,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i)[0] ?? a).trim();

export async function loadSpeedDial(): Promise<SpeedDial> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [{ data: radios }, { data: plays }] = await Promise.all([
    db()
      .from('discover_editions')
      .select('id, title, subtitle, created_at')
      .eq('kind', 'radio')
      .order('created_at', { ascending: false })
      .limit(PER_KIND),
    db()
      .from('plays')
      .select(`played_at, tracks(${TRACK_COLUMNS})`)
      .gte('played_at', since)
      .order('played_at', { ascending: false })
      .limit(1500),
  ]);

  // Radios: a cover from the first song of each.
  const radioIds = (radios ?? []).map((r) => r.id);
  const { data: firstItems } = radioIds.length
    ? await db().from('discover_items').select('edition_id, position, image_url').in('edition_id', radioIds).lt('position', 4).order('position')
    : { data: [] as any[] };
  const coverOf = new Map<string, string>();
  for (const it of firstItems ?? []) if (it.image_url && !coverOf.has(it.edition_id)) coverOf.set(it.edition_id, it.image_url);
  const radioItems: DialItem[] = (radios ?? []).map((r) => ({
    kind: 'radio',
    key: r.id,
    title: String(r.title).replace(/^Radio:\s*/, '').replace(/^Radio from\s*/, ''),
    sub: r.subtitle ?? 'Radio',
    image: coverOf.get(r.id) ?? null,
    href: `/discover/${r.id}`,
    play: { radio: r.id },
  }));

  // Songs, albums, artists from what you've played (newest first).
  const songs: DialItem[] = [];
  const seenSong = new Set<string>();
  const albums = new Map<string, { item: DialItem; plays: number; songs: Set<string> }>();
  const artists = new Map<string, { item: DialItem; plays: number }>();
  for (const p of (plays ?? []) as any[]) {
    const t = p.tracks as TrackRowData | null;
    if (!t) continue;
    const artist = mainArtist(t.artist || '');
    if (!seenSong.has(t.id) && songs.length < PER_KIND) {
      seenSong.add(t.id);
      songs.push({ kind: 'song', key: t.id, title: splitTitle(t.title).title, sub: t.artist, image: t.image_url, href: null, play: { track: t } });
    }
    if (t.album && artist) {
      const k = `${t.album.toLowerCase()}|${artist.toLowerCase()}`;
      const a = albums.get(k) ?? {
        item: {
          kind: 'album' as const,
          key: k,
          title: t.album,
          sub: artist,
          image: t.image_url,
          href: `/album?${new URLSearchParams({ name: t.album, artist })}`,
          play: { album: { name: t.album, artist } },
        },
        plays: 0,
        songs: new Set<string>(),
      };
      a.plays++;
      a.songs.add(t.id);
      albums.set(k, a);
    }
    if (artist) {
      const k = artist.toLowerCase();
      const a = artists.get(k) ?? {
        item: { kind: 'artist' as const, key: k, title: artist, sub: '', image: t.image_url, href: `/artist?name=${encodeURIComponent(artist)}`, play: { artist } },
        plays: 0,
      };
      a.plays++;
      artists.set(k, a);
    }
  }
  // Maps keep the order things were first met in, which is newest play first.
  const albumItems = [...albums.values()].filter((a) => a.songs.size >= 2 || a.plays >= 3).slice(0, PER_KIND).map((a) => ({ ...a.item, sub: `${a.item.sub}` }));
  const artistItems = [...artists.values()]
    .filter((a) => a.plays >= 2)
    .slice(0, PER_KIND)
    .map((a) => ({ ...a.item, sub: `${a.plays} plays lately` }));
  return { radio: radioItems, album: albumItems, artist: artistItems, song: songs };
}
