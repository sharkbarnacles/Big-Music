import { NextResponse, type NextRequest } from 'next/server';
import { NotConnectedError } from '@/lib/connections';
import { findAudioForTrack } from '@/lib/videos';

// POST { trackId } → { audioId } — the YouTube version to play for a song.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const trackId = typeof body.trackId === 'string' ? body.trackId : '';
  if (!/^[0-9a-f-]{36}$/i.test(trackId)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    return NextResponse.json(await findAudioForTrack(trackId));
  } catch (err) {
    const message =
      err instanceof NotConnectedError ? 'YouTube isn’t connected. Reconnect it from the Home page.' : (err as Error).message;
    return NextResponse.json({ audioId: null, message }, { status: 200 });
  }
}
