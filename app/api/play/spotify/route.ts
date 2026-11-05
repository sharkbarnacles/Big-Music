import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { chooseDevice, errorResponse, explainFailure, listDevices, logSpotify, NO_DEVICE_MESSAGE, replyText, spotifyFetch, type Device } from '@/lib/spotifyPlayer';

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
//
// Gentler (2026-11-05, owner's choice): only 10 songs are lined up at a time
// (about 40 minutes); `append: true` adds the next ones to the end of
// Spotify's queue without restarting anything (the hub sends these while
// it's open). Every step is written to the Spotify diary (logSpotify).
export const maxDuration = 90;

const QUEUE_SIZE = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findDevice(preferred: string | null, wait: boolean) {
  const until = Date.now() + (wait ? 45_000 : 0);
  let tries = 0;
  for (;;) {
    tries++;
    const devices = await listDevices();
    const device = chooseDevice(devices, preferred);
    if (device || Date.now() > until) {
      await logSpotify(device ? 'device found' : 'no device', {
        tries,
        waited: wait,
        devices: devices.map((d) => ({ name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted })),
        picked: device?.name ?? null,
      });
      return device;
    }
    await sleep(2500);
  }
}

// A phone's Spotify app that is open but not the active player often ignores
// "play" until playback is handed to it first.
async function makeActive(device: Device) {
  if (device.is_active) return;
  const res = await spotifyFetch('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [device.id], play: false }) });
  await logSpotify('hand playback to device', { device: device.name, status: res.status, reply: res.ok ? '' : await replyText(res) });
  await sleep(700);
}

// Adds songs to the end of Spotify's queue, one by one. Stops at the first
// refusal and writes down why.
async function addToQueue(ids: string[], target: string) {
  const queued: string[] = [];
  for (const id of ids) {
    const q = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(`spotify:track:${id}`)}&${target}`, { method: 'POST' });
    if (!q.ok) {
      await logSpotify('queue refused', {
        added: queued.length,
        wanted: ids.length,
        status: q.status,
        retryAfter: q.headers.get('retry-after'),
        reply: await replyText(q),
      });
      break;
    }
    queued.push(id);
    await sleep(250);
  }
  return queued;
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

    // More songs for a line-up that is already playing: just add them.
    if (body.append === true) {
      const queued = await addToQueue(ids.slice(0, QUEUE_SIZE), target);
      await saveQueued([...(await loadQueued()), ...queued].slice(-60));
      await logSpotify('topped up', { added: queued.length, wanted: Math.min(ids.length, QUEUE_SIZE) });
      return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: queued.length });
    }

    // 1. Skip past songs the hub queued last time and that haven't played yet.
    const leftovers = await leftoverCount(await loadQueued());
    if (leftovers > 0) {
      await spotifyFetch(`/me/player/pause?${target}`, { method: 'PUT' }).catch(() => null);
      for (let i = 0; i < leftovers; i++) {
        await spotifyFetch(`/me/player/next?${target}`, { method: 'POST' }).catch(() => null);
        await sleep(250);
      }
    }

    // 2. Make sure this device is the player, then play the first song on its own.
    await makeActive(device);
    await spotifyFetch(`/me/player/shuffle?state=false&${target}`, { method: 'PUT' }).catch(() => null);
    const playBody = JSON.stringify({ uris: [`spotify:track:${ids[0]}`], position_ms: positionMs });
    let res = await spotifyFetch(`/me/player/play?${target}`, { method: 'PUT', body: playBody });
    if (!res.ok && res.status !== 429) {
      // One more try after handing playback over (a sleepy phone app often needs it).
      await logSpotify('play refused, trying again', { device: device.name, status: res.status, reply: await replyText(res) });
      await makeActive({ ...device, is_active: false });
      res = await spotifyFetch(`/me/player/play?${target}`, { method: 'PUT', body: playBody });
    }
    if (!res.ok) {
      await logSpotify('play failed', { device: device.name, status: res.status, retryAfter: res.headers.get('retry-after'), reply: await replyText(res) });
      return explainFailure(res);
    }
    await spotifyFetch(`/me/player/repeat?state=${body.repeatOne ? 'track' : 'off'}&${target}`, { method: 'PUT' }).catch(
      () => null,
    );

    // Check that Spotify really plays it (on 2026-11-05 it said yes twice and
    // stayed silent). If not, nudge it once with "resume".
    const check = async () => {
      await sleep(1500);
      const r = await spotifyFetch('/me/player');
      if (r.status === 204 || !r.ok) return { playing: false, status: r.status, item: null as string | null, device: null as string | null };
      const p = await r.json().catch(() => ({}));
      return { playing: Boolean(p.is_playing), status: r.status, item: (p.item?.id as string) ?? null, device: (p.device?.name as string) ?? null };
    };
    let state = await check();
    if (!state.playing) {
      await logSpotify('said yes but silent, nudging', { ...state, wanted: ids[0] });
      await spotifyFetch(`/me/player/play?${target}`, { method: 'PUT' }).catch(() => null);
      state = await check();
    }
    await logSpotify(state.playing ? 'playing confirmed' : 'still silent', { ...state, wanted: ids[0] });

    // 3. Line up the next few in Spotify's own queue, in order.
    const queued = await addToQueue(ids.slice(1, 1 + QUEUE_SIZE), target);
    await saveQueued(queued);
    await logSpotify('started', { device: device.name, waited: body.wait === true, queued: queued.length, leftoversSkipped: leftovers });

    return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: queued.length, skippedLeftovers: leftovers, confirmed: state.playing });
  } catch (err) {
    await logSpotify('error', { message: (err as Error).message?.slice(0, 300) });
    return errorResponse(err);
  }
}
