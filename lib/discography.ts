// An artist's whole discography (lib/discographyBuild.ts), kept for 6 hours
// so sorting and coming back are instant.
import { unstable_cache } from 'next/cache';
import { buildDiscography } from './discographyBuild';

export { sortDiscography, playsLabel } from './discographyBuild';
export type { DiscoSong, Discography, DiscoSort } from './discographyBuild';

export const loadDiscography = (id: string) =>
  unstable_cache(() => buildDiscography(id), ['discography-v1', id], { revalidate: 6 * 60 * 60 })();
