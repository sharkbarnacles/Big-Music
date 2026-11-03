import { NextResponse, type NextRequest } from 'next/server';
import { addToHubPlaylist, removeFromHubPlaylist } from '@/lib/hubPlaylists';

export const dynamic = 'force-dynamic';

// POST { trackIds }: add songs to the end. DELETE { position }: remove one song.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const ids: string[] = Array.isArray(body.trackIds) ? body.trackIds.map(String) : [];
    return NextResponse.json(await addToHubPlaylist(id, ids));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await removeFromHubPlaylist(id, Number(body.position));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
