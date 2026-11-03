import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, explainFailure, spotifyFetch } from '@/lib/spotifyPlayer';

// GET → what Spotify is playing right now (the hub checks every few seconds).
export async function GET() {
  try {
    const res = await spotifyFetch('/me/player');
    if (res.status === 204) return NextResponse.json({ active: false });
    if (!res.ok) return explainFailure(res);
    const p = await res.json();
    const item = p.item ?? {};
    return NextResponse.json({
      active: true,
      isPlaying: Boolean(p.is_playing),
      progressMs: p.progress_ms ?? 0,
      durationMs: item.duration_ms ?? 0,
      // Spotify sometimes plays a regional copy of a song; include both IDs.
      trackIds: [item.id, item.linked_from?.id].filter(Boolean),
      deviceId: p.device?.id ?? null,
      deviceName: p.device?.name ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST ?action=pause | resume | seek&positionMs=… | repeat&state=track|off
export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const action = q.get('action');
  let method = 'PUT';
  let path = '';
  if (action === 'pause') path = '/me/player/pause';
  else if (action === 'resume') path = '/me/player/play';
  else if (action === 'seek') path = `/me/player/seek?position_ms=${Math.max(0, Math.floor(Number(q.get('positionMs')) || 0))}`;
  else if (action === 'repeat') path = `/me/player/repeat?state=${q.get('state') === 'track' ? 'track' : 'off'}`;
  else if (action === 'next') {
    method = 'POST';
    path = '/me/player/next';
  } else return NextResponse.json({ error: 'bad_request', message: 'Unknown action.' }, { status: 400 });

  try {
    const res = await spotifyFetch(path, { method });
    if (!res.ok) return explainFailure(res);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
