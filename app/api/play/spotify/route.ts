import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, explainFailure, NO_DEVICE_MESSAGE, pickDevice, spotifyFetch } from '@/lib/spotifyPlayer';

// POST { ids: ["<spotify track id>", ...] }
// Plays the first song on your Spotify app, with the rest lined up after it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id)).slice(0, 50)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'bad_request', message: 'No song to play.' }, { status: 400 });

  try {
    const device = await pickDevice();
    if (!device) return NextResponse.json({ error: 'no_device', message: NO_DEVICE_MESSAGE }, { status: 409 });

    const res = await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: ids.map((id) => `spotify:track:${id}`) }),
    });
    if (!res.ok) return explainFailure(res);
    return NextResponse.json({ ok: true, device: device.name });
  } catch (err) {
    return errorResponse(err);
  }
}
