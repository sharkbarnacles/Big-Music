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

type Method = 'uris' | 'album' | 'next';
const METHODS: Method[] = ['uris', 'album', 'next'];
async function loadMethod(): Promise<Method | null> {
  const { data } = await db().from('taste_settings').select('value').eq('key', 'spotify_method').maybeSingle();
  const m = (data?.value as { method?: string } | null)?.method;
  return METHODS.includes(m as Method) ? (m as Method) : null;
}
async function saveMethod(method: Method) {
  await db().from('taste_settings').upsert({ key: 'spotify_method', value: { method }, updated_at: new Date().toISOString() });
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

// The hub's own player (Web Playback SDK, "Music Hub (this browser)"),
// 2026-11-05: it follows a list of songs sent at once, so the whole line-up
// goes in one "play" (up to 50) and nothing is added to Spotify's queue.
// Spotify plays its queue before the list, so songs left in the queue by
// earlier hand-offs are skipped past first (then the list is started again).
async function startInHub(device: Device, ids: string[], positionMs: number, repeatOne: boolean) {
  const target = `device_id=${encodeURIComponent(device.id)}`;
  const want = ids[0];
  await makeActive(device);
  await spotifyFetch(`/me/player/shuffle?state=false&${target}`, { method: 'PUT' }).catch(() => null);
  const play = () =>
    spotifyFetch(`/me/player/play?${target}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: ids.map((id) => `spotify:track:${id}`), offset: { position: 0 }, position_ms: positionMs }),
    });
  let res = await play();
  if (res.status === 429) {
    await logSpotify('play failed', { method: 'in-hub list', status: 429, retryAfter: res.headers.get('retry-after') });
    return explainFailure(res);
  }
  if (!res.ok) {
    await logSpotify('play refused', { method: 'in-hub list', status: res.status, reply: await replyText(res) });
    return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: 0, confirmed: false });
  }

  // Old songs waiting in Spotify's queue would play before the list. Spotify
  // shows at most 20 queued songs at a time, so this runs up to 4 rounds.
  let stale = 0;
  for (let round = 0; round < 4; round++) {
    await sleep(round === 0 ? 1000 : 700);
    const qr = await spotifyFetch('/me/player/queue');
    if (!qr.ok) break;
    const q = await qr.json().catch(() => ({}));
    const items: { id?: string }[] = q.queue ?? [];
    let n: number;
    if (ids.length > 1) {
      const at = items.findIndex((it) => it?.id === ids[1]);
      n = at >= 0 ? at : Math.min(items.length, 20);
    } else n = Math.min(items.length, 20);
    if (n <= 0) break;
    await spotifyFetch(`/me/player/pause?${target}`, { method: 'PUT' }).catch(() => null);
    for (let k = 0; k < n; k++) {
      await spotifyFetch(`/me/player/next?${target}`, { method: 'POST' }).catch(() => null);
      await sleep(250);
    }
    stale += n;
    res = await play();
  }
  if (stale > 0) {
    await logSpotify('cleared old queue', { skipped: stale, replayStatus: res.status });
    await sleep(800);
  }
  await saveQueued([]);
  await spotifyFetch(`/me/player/repeat?state=${repeatOne ? 'track' : 'off'}&${target}`, { method: 'PUT' }).catch(() => null);

  await sleep(700);
  const r = await spotifyFetch('/me/player');
  const p = r.ok && r.status !== 204 ? await r.json().catch(() => ({})) : {};
  const item = (p.item?.id as string) ?? null;
  const linked = (p.item?.linked_from?.id as string) ?? null;
  const playing = Boolean(p.is_playing) && (item === want || linked === want);
  await logSpotify(playing ? 'playing confirmed' : 'said yes but silent', { method: 'in-hub list', songs: ids.length, item, wanted: want, staleSkipped: stale });
  return NextResponse.json({
    ok: true,
    device: device.name,
    deviceId: device.id,
    queued: ids.length - 1,
    confirmed: playing || item === want || linked === want,
    mode: 'list',
  });
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

    if (body.inHub === true && preferred && device.id === preferred && body.append !== true) {
      return await startInHub(device, ids, positionMs, body.repeatOne === true);
    }

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

    // 2. Make sure this device is the player, then start the first song.
    await makeActive(device);
    await spotifyFetch(`/me/player/shuffle?state=false&${target}`, { method: 'PUT' }).catch(() => null);

    // Spotify's iPhone app (Nov 2026) can say yes to "play this song" and then
    // load nothing at all. So there are three ways to ask, tried in turn, and
    // the one that worked is remembered for next time (taste_settings
    // 'spotify_method'). After each, /me/player shows whether it really plays.
    const want = ids[0];
    const check = async () => {
      await sleep(1500);
      const r = await spotifyFetch('/me/player');
      if (r.status === 204 || !r.ok) return { playing: false, item: null as string | null, status: r.status };
      const p = await r.json().catch(() => ({}));
      const item = (p.item?.id as string) ?? null;
      const linked = (p.item?.linked_from?.id as string) ?? null;
      return { playing: Boolean(p.is_playing) && (item === want || linked === want), item, status: r.status };
    };
    const tryMethod = async (m: Method): Promise<Response | null> => {
      if (m === 'uris') {
        return spotifyFetch(`/me/player/play?${target}`, { method: 'PUT', body: JSON.stringify({ uris: [`spotify:track:${want}`], position_ms: positionMs }) });
      }
      if (m === 'album') {
        // Play the song inside its album; the hub's queue (added next) plays before the album would continue.
        const t = await spotifyFetch(`/tracks/${want}`);
        if (!t.ok) return t;
        const album = (await t.json().catch(() => ({})))?.album?.uri as string | undefined;
        if (!album) return null;
        return spotifyFetch(`/me/player/play?${target}`, {
          method: 'PUT',
          body: JSON.stringify({ context_uri: album, offset: { uri: `spotify:track:${want}` }, position_ms: positionMs }),
        });
      }
      // 'next': put the song at the front of Spotify's queue and skip to it.
      const q = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(`spotify:track:${want}`)}&${target}`, { method: 'POST' });
      if (!q.ok) return q;
      await sleep(400);
      const n = await spotifyFetch(`/me/player/next?${target}`, { method: 'POST' });
      if (n.ok && positionMs > 0) {
        await sleep(600);
        await spotifyFetch(`/me/player/seek?position_ms=${positionMs}&${target}`, { method: 'PUT' }).catch(() => null);
      }
      return n;
    };
    const saved = await loadMethod();
    const order: Method[] = [saved, ...METHODS.filter((m) => m !== saved)].filter(Boolean) as Method[];
    let worked: Method | null = null;
    let state = { playing: false, item: null as string | null, status: 0 };
    for (const m of order) {
      const res = await tryMethod(m);
      if (res && res.status === 429) {
        await logSpotify('play failed', { method: m, status: 429, retryAfter: res.headers.get('retry-after') });
        return explainFailure(res);
      }
      if (!res || !res.ok) {
        await logSpotify('play refused', { method: m, status: res?.status ?? null, reply: res ? await replyText(res) : 'no album' });
        continue;
      }
      state = await check();
      await logSpotify(state.playing ? 'playing confirmed' : 'said yes but silent', { method: m, ...state, wanted: want });
      if (state.playing) {
        worked = m;
        break;
      }
    }
    if (worked && worked !== saved) await saveMethod(worked);
    await spotifyFetch(`/me/player/repeat?state=${body.repeatOne ? 'track' : 'off'}&${target}`, { method: 'PUT' }).catch(
      () => null,
    );
    if (!worked) {
      // None worked: tell the hub, which plays the song through YouTube instead.
      return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: 0, confirmed: false });
    }

    // 3. Line up the next few in Spotify's own queue, in order.
    const queued = await addToQueue(ids.slice(1, 1 + QUEUE_SIZE), target);
    await saveQueued(queued);
    await logSpotify('started', { device: device.name, waited: body.wait === true, queued: queued.length, leftoversSkipped: leftovers });

    return NextResponse.json({ ok: true, device: device.name, deviceId: device.id, queued: queued.length, skippedLeftovers: leftovers, confirmed: true, method: worked });
  } catch (err) {
    await logSpotify('error', { message: (err as Error).message?.slice(0, 300) });
    return errorResponse(err);
  }
}
