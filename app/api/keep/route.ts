import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { setHeart } from '@/lib/discover';
import { createHubPlaylist, addToHubPlaylist } from '@/lib/hubPlaylists';
import { keepRadioSong } from '@/lib/keepDiscovery';

export const dynamic = 'force-dynamic';

// The star on the Now Playing screen: keep a song in your "Discoveries" playlist.
// Works for any song: Discover songs ("disc:…") and radio songs ("yt:…") are
// saved to your library first.
//   GET ?trackId=…            → { kept }
//   POST { trackId, on }      → { kept }
const DISCOVERIES = 'Discoveries';

async function discoveriesId(create: boolean): Promise<string | null> {
  const { data } = await db().from('playlists').select('id').eq('service', 'hub').eq('name', DISCOVERIES).limit(1).maybeSingle();
  if (data?.id) return data.id;
  return create ? createHubPlaylist(DISCOVERIES) : null;
}

// The real song ID behind a temporary one, without saving anything new.
async function existingTrackId(id: string): Promise<string | null> {
  if (id.startsWith('disc:')) {
    const { data } = await db().from('discover_items').select('track_id').eq('id', id.slice(5)).maybeSingle();
    return (data?.track_id as string | null) ?? null;
  }
  if (id.startsWith('yt:')) {
    const { data } = await db().from('track_sources').select('track_id').eq('service', 'youtube').eq('external_id', id.slice(3)).maybeSingle();
    return (data?.track_id as string | null) ?? null;
  }
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function isKept(trackId: string | null): Promise<boolean> {
  if (!trackId) return false;
  const pid = await discoveriesId(false);
  if (!pid) return false;
  const { count } = await db().from('playlist_items').select('track_id', { count: 'exact', head: true }).eq('playlist_id', pid).eq('track_id', trackId);
  return (count ?? 0) > 0;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('trackId') ?? '';
  try {
    return NextResponse.json({ kept: await isKept(await existingTrackId(id)) });
  } catch {
    return NextResponse.json({ kept: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.trackId === 'string' ? body.trackId : '';
  const on = body.on !== false;
  if (!id) return NextResponse.json({ error: 'Missing song' }, { status: 400 });
  try {
    // Discover songs keep their heart in step on the Discover page too.
    if (id.startsWith('disc:')) {
      const r = await setHeart(id.slice(5), on);
      return NextResponse.json({ kept: r.hearted, trackId: r.trackId });
    }
    let trackId = await existingTrackId(id);
    if (!trackId && on && id.startsWith('yt:')) trackId = await keepRadioSong(id.slice(3));
    if (!trackId) return NextResponse.json({ kept: false });
    const pid = await discoveriesId(on);
    if (pid && on) await addToHubPlaylist(pid, [trackId]);
    if (pid && !on) await db().from('playlist_items').delete().eq('playlist_id', pid).eq('track_id', trackId);
    await db().from('discover_items').update({ hearted: on }).eq('track_id', trackId);
    return NextResponse.json({ kept: on, trackId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
