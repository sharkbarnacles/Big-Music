import { NextResponse, type NextRequest } from 'next/server';
import { setAside } from '@/lib/hubPlaylists';

export const dynamic = 'force-dynamic';

// POST { ids, aside }: put playlists in the Set aside folder (aside: true) or bring them back.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return NextResponse.json({ changed: await setAside(ids, body.aside !== false) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
