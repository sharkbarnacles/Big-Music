import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { errorResponse, explainFailure, NO_DEVICE_MESSAGE, pickDevice, spotifyFetch } from '@/lib/spotifyPlayer';

// POST { ids: ["<spotify track id>", ...], deviceId?, positionMs?, repeatOne?, wait? }
//
// Since about Oct 2026 Spotify's apps ignore a list of songs sent at once and
// play the first song's album instead. They DO follow their own queue, which
// also keeps going with the phone locked. So: play the first song, then add
// the following songs to Spotify's queue one by one, in the hub's order.
//
// Spotify can't clear its queue, so the hub remembers what it added last
// time and skips past any leftovers before starting the new line-up.
//
// `wait: true` is used when the hub has just opened the Spotify app to wake
// it: this request keeps checking for up to ~45 s until the app shows up,
// then starts the music. It finishes on the server even if the hub is
// already in the background.
export const maxDuration = 90;

const QUEUE_SIZE = 30; // about two hours of music; the hub tops it up while it's open
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findDevice(preferred: string | null, wait: boolean) {
  const until = Date.now() + (wait ? 45_000 : 0);
  for (;;) {
    const device = await pickDevice(preferred);
    if (device || Date.now() > until) return device;
    await sleep(2000);
  }
}

async function loadQueued(): Promise<string[]> {
  const { data } = await db().from('spotify_queue_state').select('queued').eq('id', 1).maybeSingle();
  return (data?.queued as string[] | undefined) ?? [];
}

async function saveQueued(ids: string[]) {
  await db().from('spotify_queue_state').upsert({ id: 1, queued: ids, updated_at: new Date().toISOString() });
}

// How many songs at the front of Spotify's queue are leftovers the hub added before.
async function leftoverCount(previous: string[]): Promise<number> {
  if (!previous.length) return 0;
  const res = await spotifyFetch('/me/player/queue');
  if (!res.ok) return 0;
  const q = await res.json().catch(() => ({}));
  const prev = new Set(previous);
  let n = 0;
  for (const item of q.queue ?? []) {
    if (item?.id && prev.has(item.id)) n++;
    else break;
  }
  return n;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id)).slice(0, 50)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'bad_request', message: 'No song to play.' }, { status: 400 });
  const positionMs = Math.max(0, Math.floor(Number(body.positionMs) || 0));
  const preferred = typeof body.deviceId === 'string' ? body.deviceId : null;

  try {
    const device = await findDevice(preferred, body.wait === true);
    if (!device) return NextResponse.json({ error: 'no_device', message: NO_DEVICE_MESSAGE }, { status: 409 });
    const target = `device_id=${encodeURIComponent(device.id)}`;

    // 1. Skip past songs the hub queued last time and that haven't played yet.
    const leftovers = await leftoverCount(await loadQueued());
    if (leftovers > 0) {
      await spotifyFetch(`/me/player/pause?${target}`, { method: 'PUT' }).catch(() => null);
      for (let i = 0; i < leftovers; i++) {
        await spotifyFetch(`/me/player/next?${target}`, { method: 'POST' }).catch(() => null);
        await sleep(250);
      }
    }

    // 2. Play the first song on its own (best effort: shuffle off first).
    await spotifyFetch(`/me/player/shuffle?state=false&${target}`, { method: 'PUT' }).catch(() => null);
    const res = await spotifyFetch(`/me/player/play?${target}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [`spotify:track:${ids[0]}`], position_ms: positionMs }),
    });
    if (!res.ok) return explainFailure(res);
    await spotifyFetch(`/me/player/repeat?state=${body.repeatOne ? 'track' : 'off'}&${target}`, { method: 'PUT' }).catch(
      () => null,
    );

    // 3. Line up the rest in Spotify's own queue, in order.
    const rest = ids.slice(1, 1 + QUEUE_SIZE);
    const queued: string[] = [];
    for (const id of rest) {
      const q = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(`spotify:track:${id}`)}&${target}`, { method: 'POST' });
      if (!q.ok) break;
      queued.push(id);
      await sleep(200);
    }
    await saveQueued(queued);

    return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: queued.length, skippedLeftovers: leftovers });
  } catch (err) {
    return errorResponse(err);
  }
}
