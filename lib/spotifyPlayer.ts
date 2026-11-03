import { NextResponse } from 'next/server';
import { getAccessToken, NotConnectedError } from './connections';

// Talks to Spotify Connect: the feature that lets one device tell another
// Spotify player what to play. Requires Spotify Premium.

const API = 'https://api.spotify.com/v1';

export const NO_DEVICE_MESSAGE =
  'Spotify is asleep on this phone. Open the Spotify app for a moment, then come back. Or switch on YouTube mode to play here instead.';

type Device = { id: string; name: string; type: string; is_active: boolean; is_restricted: boolean };

export async function spotifyFetch(path: string, init: { method?: string; body?: string } = {}) {
  const token = await getAccessToken('spotify');
  return fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

// Picks the device to play on: the one asked for (e.g. this browser tab),
// else the one already playing, else your phone, else any open Spotify app.
export async function pickDevice(preferredId?: string | null): Promise<Device | null> {
  const res = await spotifyFetch('/me/player/devices');
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const { devices = [] } = (await res.json()) as { devices?: Device[] };
  const usable = devices.filter((d) => d.id && !d.is_restricted);
  return (
    (preferredId ? usable.find((d) => d.id === preferredId) : undefined) ??
    usable.find((d) => d.is_active) ??
    usable.find((d) => d.type === 'Smartphone') ??
    usable[0] ??
    null
  );
}

// Turns a failed Spotify reply into a message a person can act on.
export async function explainFailure(res: Response) {
  const text = await res.text();
  if (res.status === 404 || text.includes('NO_ACTIVE_DEVICE')) {
    return NextResponse.json({ error: 'no_device', message: NO_DEVICE_MESSAGE }, { status: 409 });
  }
  if (res.status === 403 && text.includes('PREMIUM')) {
    return NextResponse.json({ error: 'premium', message: 'Spotify says this needs Premium on the connected account.' }, { status: 403 });
  }
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json(
      { error: 'permission', message: 'Spotify refused. Reconnect Spotify from the Home page and try again.' },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: 'spotify', message: `Spotify error ${res.status}. Try again in a moment.` }, { status: 502 });
}

export function errorResponse(err: unknown) {
  if (err instanceof NotConnectedError) {
    return NextResponse.json({ error: 'not_connected', message: 'Spotify isn’t connected. Connect it from the Home page.' }, { status: 401 });
  }
  return NextResponse.json({ error: 'spotify', message: (err as Error).message }, { status: 500 });
}
