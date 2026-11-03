import { NextResponse, type NextRequest } from 'next/server';
import { deleteHubPlaylist, renameHubPlaylist } from '@/lib/hubPlaylists';

export const dynamic = 'force-dynamic';

// PATCH { name }: rename. DELETE: delete the playlist (songs stay in your library).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await renameHubPlaylist(id, String(body.name ?? ''));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteHubPlaylist(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
