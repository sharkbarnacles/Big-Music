import { NextResponse, type NextRequest } from 'next/server';
import { setPinned } from '@/lib/playlistTags';

export const dynamic = 'force-dynamic';

// POST { ids, pinned }: pin playlists to the top of Home (pinned: true) or unpin them.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json({ changed: await setPinned(body.ids, body.pinned !== false) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
