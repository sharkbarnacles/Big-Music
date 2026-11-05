// Finds an album on YouTube Music from its name and artist (for the speed
// dial: albums you've been playing come from your library, which only knows
// their names).
import { searchEverywhere, type WebItem } from './ytBrowse';

const simple = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

export async function findAlbum(name: string, artist: string): Promise<WebItem | null> {
  const found = await searchEverywhere(`${name} ${artist}`.trim()).catch(() => null);
  const albums = found?.albums ?? [];
  const want = simple(name);
  const who = simple(artist);
  return (
    albums.find((a) => simple(a.title) === want && simple(a.subtitle).includes(who)) ??
    albums.find((a) => simple(a.title) === want) ??
    albums.find((a) => simple(a.title).includes(want) || want.includes(simple(a.title))) ??
    null
  );
}
