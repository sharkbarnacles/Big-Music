import { NextResponse, type NextRequest } from 'next/server';
import type { TrackRowData } from '@/lib/tracks';
import { appendToRadioEdition, createRadioEdition } from '@/lib/radioEditions';
import { fetchRadio } from '@/lib/ytRadio';
import { runPromptRadio } from '@/lib/promptRadioRoute';
import { playlistRadio } from '@/lib/playlistRadio';
import { RADIO_SIZE, radioMode, toRadioTracks } from '@/lib/radioTracks';
import { tasteOrder } from '@/lib/tasteRank';
import { seedRadioMore, seedRadioStart, type SeedInfo } from '@/lib/seedRadio';
import { songLanguage } from '@/lib/taste';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET ?videoId=… (start) or ?continuation=… (more), &mode=familiar|mixed|new
// Returns songs ready for the player (see lib/radioTracks.ts for the dial).
// A new radio starts with 50 songs (RADIO_SIZE); more come as you listen.
// Continuations: "p:…" = a radio from words, "pl:…" = a radio from a playlist,
// "s:…" = a song radio that keeps to the seed's era and sound (lib/seedRadio.ts),
// anything else = YouTube Music's own token (song radios from before 2026-11-21).
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
    let tracks: TrackRowData[] = [];
    let continuation: string | null = null;
    let seed: SeedInfo | undefined;
    const addAll = (list: TrackRowData[], have: Set<string>) => {
      for (const t of list) {
        const k = t.yt_audio_id ?? t.id;
        if (have.has(k) || have.has(t.id)) continue;
        have.add(k);
        have.add(t.id);
        tracks.push(t);
      }
    };

    if (!token) {
      // A new song radio: the seed's radio plus radios from songs of its era (lib/seedRadio.ts).
      const videoId = q.get('videoId');
      if (!videoId) throw new Error('No song to start the radio from.');
      const start = await seedRadioStart(videoId, { lang: (s) => songLanguage(`${s.title} ${s.artist}`, undefined) });
      seed = start.seed;
      if (!seed.artist) seed.artist = q.get('seedArtist') ?? '';
      continuation = start.continuation;
      addAll(await toRadioTracks(start.songs, mode, new Set(), libSeen), new Set());
    } else if (token.startsWith('s:')) {
      const more = await seedRadioMore(token);
      if (!more) return NextResponse.json({ tracks: [], continuation: null });
      seed = more.seed;
      continuation = more.continuation;
      addAll(await toRadioTracks(more.songs, mode, new Set(), libSeen), new Set());
    } else {
      // A radio started before era-aware radios: YouTube's own token, as before.
      const more = await fetchRadio({ continuation: token });
      continuation = more.continuation;
      tracks = await toRadioTracks(more.songs, mode, new Set(), libSeen);
    }
    if (!tracks.length) return NextResponse.json({ tracks: [], continuation: null });

    // Keep the radio in Past editions: a new edition when it starts, more songs as it goes.
    let editionId = editionParam;
    const seedTitle = q.get('seedTitle');
    // Your taste decides which suggestions stay and their order (lib/tasteRank.ts).
    // With a seed, its era and sound lead and your taste breaks ties.
    const ranked = await tasteOrder(tracks, { keepFirst: !token, seed }).catch(() => tracks);
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
    } else {
      // Era radios gather from several chains at once: hand over the best 40 each time.
      if (token.startsWith('s:')) list = ranked.slice(0, 40);
      if (editionId) await appendToRadioEdition(editionId, list).catch(() => {});
    }
    return NextResponse.json({ tracks: list, continuation, editionId: editionId ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
