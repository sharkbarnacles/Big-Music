import { NextResponse, type NextRequest } from 'next/server';
import { addToHubPlaylist, removeFromHubPlaylist, reorderHubPlaylist } from '@/lib/hubPlaylists';

export const dynamic = 'force-dynamic';

// POST { trackIds }: add songs to the end. DELETE { positions } (or { position }): remove songs.
// PATCH { order }: every song's current position, in the new order → { positions } (new ones).
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
    const positions: number[] = Array.isArray(body.positions) ? body.positions.map(Number) : [Number(body.position)];
    await removeFromHubPlaylist(id, positions);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const order: number[] = Array.isArray(body.order) ? body.order : [];
    return NextResponse.json({ positions: await reorderHubPlaylist(id, order) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
