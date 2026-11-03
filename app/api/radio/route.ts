import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { matchKey } from '@/lib/library';
import { TRACK_COLUMNS, type TrackRowData } from '@/lib/tracks';
import { appendToRadioEdition, createRadioEdition } from '@/lib/radioEditions';
import { fetchRadio } from '@/lib/ytRadio';
import { runPromptRadio } from '@/lib/promptRadioRoute';

export const dynamic = 'force-dynamic';

// GET ?videoId=… (start) or ?continuation=… (more), &mode=familiar|mixed|new
// Returns songs ready for the player. Songs already in your library come back
// as your own songs; new ones get a temporary "yt:<video id>" ID and are
// remembered in radio_songs so you can keep them or add them to a playlist.
//   familiar = everything YouTube suggests
//   mixed    = mostly new to you, with about one song in three you have
//   new      = only songs that aren't in your library
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'new' ? 'new' : q.get('mode') === 'familiar' ? 'familiar' : 'mixed';
  // More songs for a radio started from words.
  const token = q.get('continuation');
  if (token?.startsWith('p:')) {
    try {
      return NextResponse.json(await runPromptRadio({ token, mode, editionId: q.get('editionId') }));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
  }
  try {
    const { songs, continuation } = await fetchRadio({
      videoId: q.get('videoId') ?? undefined,
      continuation: q.get('continuation') ?? undefined,
    });
    if (!songs.length) return NextResponse.json({ tracks: [], continuation: null });

    // Which of these are already in your library (same YouTube video, or same artist + title)?
    // Studio audio first when YouTube Music has it; the music video is kept for the eye button.
    for (const s of songs) if (s.audioId && s.audioId !== s.videoId) s.videoId = s.audioId;
    const videoIds = [...new Set(songs.flatMap((s) => [s.videoId, s.mvId].filter(Boolean) as string[]))];
    const keys = songs.map((s) => matchKey({ service: 'youtube', externalId: s.videoId, url: '', title: s.title, artist: s.artist }));
    const [byAudio, bySource, byKey] = await Promise.all([
      db().from('tracks').select(TRACK_COLUMNS).in('yt_audio_id', videoIds),
      db().from('track_sources').select(`external_id, tracks(${TRACK_COLUMNS})`).eq('service', 'youtube').in('external_id', videoIds),
      db().from('tracks').select(`match_key, ${TRACK_COLUMNS}`).in('match_key', keys),
    ]);
    const mine = new Map<string, TrackRowData>();
    for (const t of (byAudio.data ?? []) as any[]) if (t.yt_audio_id) mine.set(t.yt_audio_id, t);
    for (const r of (bySource.data ?? []) as any[]) if (r.tracks) mine.set(r.external_id, r.tracks);
    const byMatch = new Map<string, TrackRowData>(((byKey.data ?? []) as any[]).map((t) => [t.match_key, t]));

    const fresh: any[] = [];
    let libCount = 0;
    const tracks: TrackRowData[] = [];
    songs.forEach((s, i) => {
      const own = mine.get(s.videoId) ?? (s.mvId ? mine.get(s.mvId) : undefined) ?? byMatch.get(keys[i]);
      if (own) {
        if (mode === 'new') return;
        if (mode === 'mixed' && libCount++ % 3 !== 0) return;
        tracks.push({ ...own, yt_audio_id: own.yt_audio_id ?? s.videoId, video_id: own.video_id ?? s.mvId });
        return;
      }
      fresh.push({ video_id: s.videoId, title: s.title, artist: s.artist, album: s.album, image_url: s.image, duration_ms: s.durationMs, seen_at: new Date().toISOString() });
      tracks.push({
        id: `yt:${s.videoId}`,
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration_ms: s.durationMs,
        image_url: s.image,
        video_id: s.mvId,
        yt_audio_id: s.videoId,
        track_sources: [{ service: 'youtube', external_id: s.videoId, url: `https://music.youtube.com/watch?v=${s.videoId}` }],
      });
    });
    if (fresh.length) await db().from('radio_songs').upsert(fresh, { onConflict: 'video_id' });

    // Keep the radio in Past editions: a new edition when it starts, more songs as it goes.
    let editionId = q.get('editionId');
    const seedTitle = q.get('seedTitle');
    if (!q.get('continuation') && seedTitle) {
      // The song you started from always comes first, even if the dial filters it out.
      const vid = q.get('videoId') ?? '';
      const seedId = q.get('seedId') ?? '';
      const seed: TrackRowData = {
        id: seedId || `yt:${vid}`,
        title: seedTitle,
        artist: q.get('seedArtist') ?? '',
        album: null,
        duration_ms: null,
        image_url: q.get('seedImage'),
        video_id: null,
        yt_audio_id: vid,
        track_sources: [],
      };
      const list = [seed, ...tracks.filter((t) => t.yt_audio_id !== vid && t.id !== seedId)];
      editionId = await createRadioEdition({ title: seedTitle, artist: seed.artist, videoId: vid, label: q.get('seedLabel') }, list).catch(() => null);
    } else if (editionId) {
      await appendToRadioEdition(editionId, tracks).catch(() => {});
    }
    return NextResponse.json({ tracks, continuation, editionId: editionId ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
