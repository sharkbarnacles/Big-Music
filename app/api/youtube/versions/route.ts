import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { fetchVersions, searchStudioSong } from '@/lib/ytRadio';

export const dynamic = 'force-dynamic';

// POST { id, trackId? } → { audioId, mvId }
// The studio audio and the music video of the song YouTube video `id` belongs
// to, from YouTube Music. For a song in your library the answer is saved, so
// the eye button and the studio version work straight away next time.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' && /^[\w-]{11}$/.test(body.id) ? body.id : '';
  const trackId = typeof body.trackId === 'string' && /^[0-9a-f-]{36}$/i.test(body.trackId) ? body.trackId : null;
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    const v = await fetchVersions(id).catch(() => ({ audioId: null as string | null, mvId: null as string | null }));
    // Only a video, no studio version paired with it: try finding the song by name.
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : '';
    const artist = typeof body.artist === 'string' ? body.artist.slice(0, 120) : '';
    if (!v.audioId && title && (v.mvId === id || body.looksLikeVideo)) {
      v.audioId = await searchStudioSong(title, artist).catch(() => null);
      if (v.audioId && !v.mvId) v.mvId = id;
    }
    if (trackId && (v.audioId || v.mvId)) {
      const { data: t } = await db().from('tracks').select('yt_audio_id, video_id').eq('id', trackId).maybeSingle();
      if (t) {
        const patch: Record<string, string> = {};
        // A music video was standing in for the song: use the studio audio instead.
        if (v.audioId && (!t.yt_audio_id || t.yt_audio_id === v.mvId)) patch.yt_audio_id = v.audioId;
        if (v.mvId && !t.video_id) patch.video_id = v.mvId;
        if (Object.keys(patch).length) await db().from('tracks').update(patch).eq('id', trackId);
      }
    }
    return NextResponse.json(v);
  } catch (err) {
    return NextResponse.json({ audioId: null, mvId: null, message: (err as Error).message });
  }
}
