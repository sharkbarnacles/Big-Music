import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/env';
import { autoInclude, cleanupOrphans, removePlaylist } from '@/lib/library';
import type { Service } from '@/lib/oauth';

// Saves the checkboxes from the "Choose playlists" page.
// A choice is only stored when it differs from the automatic one, so
// playlists you didn't touch keep following the automatic music check.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const service: Service = form.get('service') === 'spotify' ? 'spotify' : 'youtube';
  const all = new Set(form.getAll('all').map(String));
  const included = new Set(form.getAll('include').map(String));
  const reset = form.get('reset') === '1';

  const { data, error } = await db()
    .from('source_playlists')
    .select('external_id, music_ratio')
    .eq('service', service);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of data ?? []) {
    if (!all.has(row.external_id)) continue;
    const auto = autoInclude(service, row.external_id, row.music_ratio);
    const wanted = reset ? auto : included.has(row.external_id);
    const choice = wanted === auto ? null : wanted;

    await db()
      .from('source_playlists')
      .update({ user_choice: choice })
      .eq('service', service)
      .eq('external_id', row.external_id);
    if (!wanted) await removePlaylist(service, row.external_id);
  }
  await cleanupOrphans();

  return NextResponse.redirect(new URL(`/choose?service=${service}&saved=1`, appUrl()), 303);
}
