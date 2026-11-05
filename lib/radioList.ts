// Every radio you've started (Library → Radios pill): saved radio editions,
// newest first, each with up to four covers and its number of songs.
import { db } from './db';

export type RadioCard = {
  id: string;
  title: string;
  subtitle: string | null;
  date: string; // ISO
  covers: string[];
  count: number;
};

export async function loadRadios(): Promise<{ radios: RadioCard[]; error?: string }> {
  const { data, error } = await db()
    .from('discover_editions')
    .select('id, title, subtitle, created_at')
    .eq('kind', 'radio')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return { radios: [], error: error.message };
  const rows = data ?? [];
  const ids = rows.map((r) => r.id as string);
  const covers = new Map<string, string[]>();
  if (ids.length) {
    const { data: first } = await db()
      .from('discover_items')
      .select('edition_id, position, image_url')
      .in('edition_id', ids)
      .lt('position', 8)
      .order('position');
    for (const it of first ?? []) {
      if (!it.image_url) continue;
      const list = covers.get(it.edition_id) ?? [];
      if (list.length < 4 && !list.includes(it.image_url)) list.push(it.image_url);
      covers.set(it.edition_id, list);
    }
  }
  const counts = await Promise.all(
    ids.map(async (id) => {
      const { count } = await db().from('discover_items').select('id', { count: 'exact', head: true }).eq('edition_id', id);
      return count ?? 0;
    }),
  );
  return {
    radios: rows.map((r, i) => ({
      id: r.id,
      title: String(r.title ?? 'Radio').replace(/^Radio:\s*/, '').replace(/^Radio from\s*/, ''),
      subtitle: r.subtitle ?? null,
      date: r.created_at,
      covers: covers.get(r.id) ?? [],
      count: counts[i],
    })),
  };
}
