import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, explainFailure, NO_DEVICE_MESSAGE, pickDevice, spotifyFetch } from '@/lib/spotifyPlayer';

// POST { ids: ["<spotify track id>", ...], deviceId?, positionMs?, repeatOne? }
// Plays the first song, with the rest lined up after it. The hub manages
// shuffle itself, so Spotify's own shuffle is switched off first.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id)).slice(0, 50)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'bad_request', message: 'No song to play.' }, { status: 400 });
  const positionMs = Math.max(0, Math.floor(Number(body.positionMs) || 0));
  const preferred = typeof body.deviceId === 'string' ? body.deviceId : null;

  try {
    const device = await pickDevice(preferred);
    if (!device) return NextResponse.json({ error: 'no_device', message: NO_DEVICE_MESSAGE }, { status: 409 });
    const target = `device_id=${encodeURIComponent(device.id)}`;

    // Best effort: if these fail, playback still starts.
    await spotifyFetch(`/me/player/shuffle?state=false&${target}`, { method: 'PUT' }).catch(() => null);

    const res = await spotifyFetch(`/me/player/play?${target}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: ids.map((id) => `spotify:track:${id}`), position_ms: positionMs }),
    });
    if (!res.ok) return explainFailure(res);

    await spotifyFetch(`/me/player/repeat?state=${body.repeatOne ? 'track' : 'off'}&${target}`, { method: 'PUT' }).catch(
      () => null,
    );
    return NextResponse.json({ ok: true, device: device.name, deviceId: device.id });
  } catch (err) {
    return errorResponse(err);
  }
}
