import { NextResponse, type NextRequest } from 'next/server';
import { addToHubPlaylist, createHubPlaylist, listHubPlaylists } from '@/lib/hubPlaylists';

export const dynamic = 'force-dynamic';

// GET: your hub playlists. POST { name, trackIds? }: make a new one.
export async function GET() {
  try {
    return NextResponse.json({ playlists: await listHubPlaylists() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = await createHubPlaylist(String(body.name ?? ''));
    const ids: string[] = Array.isArray(body.trackIds) ? body.trackIds.map(String) : [];
    const result = ids.length ? await addToHubPlaylist(id, ids) : { added: 0, skipped: 0 };
    return NextResponse.json({ id, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
