import { NextResponse, type NextRequest } from 'next/server';
import { listTags, makeTag, setPlaylistTag } from '@/lib/playlistTags';

export const dynamic = 'force-dynamic';

// GET: your tags (only ones on at least one playlist) with counts.
export async function GET() {
  try {
    return NextResponse.json({ tags: await listTags() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST { ids, tag?: id, name?: text, on }: put a tag on several playlists
// (or take it off with on: false). A `name` finds or makes the tag first.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tag = body.name ? await makeTag(String(body.name)) : null;
    const tagId = tag?.id ?? String(body.tag ?? '');
    const changed = await setPlaylistTag(body.ids, tagId, body.on !== false);
    return NextResponse.json({ changed, tag });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
