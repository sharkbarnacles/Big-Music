import { NextResponse, type NextRequest } from 'next/server';
import type { TrackRowData } from '@/lib/tracks';
import { appendToRadioEdition, createRadioEdition } from '@/lib/radioEditions';
import { fetchRadio } from '@/lib/ytRadio';
import { runPromptRadio } from '@/lib/promptRadioRoute';
import { playlistRadio } from '@/lib/playlistRadio';
import { RADIO_SIZE, radioMode, toRadioTracks } from '@/lib/radioTracks';
import { tasteOrder } from '@/lib/tasteRank';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET ?videoId=… (start) or ?continuation=… (more), &mode=familiar|mixed|new
// Returns songs ready for the player (see lib/radioTracks.ts for the dial).
// A new radio starts with 50 songs (RADIO_SIZE); more come as you listen.
// Continuations: "p:…" = a radio from words, "pl:…" = a radio from a playlist,
// anything else = YouTube Music's own token for a song radio.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = radioMode(q.get('mode'));
  const token = q.get('continuation');
  const editionParam = q.get('editionId');

  try {
    // More songs for a radio started from words.
    if (token?.startsWith('p:')) {
      return NextResponse.json(await runPromptRadio({ token, mode, editionId: editionParam }));
    }
    // More songs for a radio started from a playlist.
    if (token?.startsWith('pl:')) {
      const { tracks, continuation } = await playlistRadio({ token, mode });
      if (editionParam) await appendToRadioEdition(editionParam, tracks).catch(() => {});
      return NextResponse.json({ tracks, continuation, editionId: editionParam });
    }

    const libSeen = { n: 0 };
    const first = await fetchRadio({ videoId: q.get('videoId') ?? undefined, continuation: token ?? undefined });
    let continuation = first.continuation;
    const tracks: TrackRowData[] = await toRadioTracks(first.songs, mode, new Set(), libSeen);

    // A new radio: keep asking until there are 50 songs (the dial can drop many).
    if (!token) {
      const have = new Set(tracks.map((t) => t.yt_audio_id ?? t.id));
      for (let round = 0; round < 4 && tracks.length < RADIO_SIZE + 1 && continuation; round++) {
        const more = await fetchRadio({ continuation });
        continuation = more.continuation;
        for (const t of await toRadioTracks(more.songs, mode, new Set(), libSeen)) {
          const k = t.yt_audio_id ?? t.id;
          if (!have.has(k)) {
            have.add(k);
            tracks.push(t);
          }
        }
      }
    }
    if (!tracks.length) return NextResponse.json({ tracks: [], continuation: null });

    // Keep the radio in Past editions: a new edition when it starts, more songs as it goes.
    let editionId = editionParam;
    const seedTitle = q.get('seedTitle');
    // Your taste decides which suggestions stay and their order (lib/tasteRank.ts).
    const ranked = await tasteOrder(tracks, { keepFirst: !token }).catch(() => tracks);
    let list = ranked;
    if (!token && seedTitle) {
      // The song you started from always comes first, even if the dial filters it out,
      // followed by 49 more: 50 in all.
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
      list = ranked.filter((t) => t.yt_audio_id !== vid && t.id !== seedId).slice(0, RADIO_SIZE - 1);
      editionId = await createRadioEdition({ title: seedTitle, artist: seed.artist, videoId: vid, label: q.get('seedLabel') }, [seed, ...list]).catch(() => null);
    } else if (!token) {
      list = ranked.slice(0, RADIO_SIZE);
    } else if (editionId) {
      await appendToRadioEdition(editionId, ranked).catch(() => {});
    }
    return NextResponse.json({ tracks: list, continuation, editionId: editionId ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
