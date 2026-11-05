import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { artistKey } from '@/lib/taste';

export const dynamic = 'force-dynamic';

// POST { trackId, title, artist, playedMs, durationMs }: you pressed Next early
// on a song you didn't pick yourself (the player decides what counts).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const artist = String(b.artist ?? '').slice(0, 300);
  const key = artistKey(artist);
  if (!key) return NextResponse.json({ ok: false });
  await db()
    .from('skips')
    .insert({
      track_id: typeof b.trackId === 'string' ? b.trackId.slice(0, 120) : null,
      artist_key: key,
      artist,
      title: String(b.title ?? '').slice(0, 300),
      played_ms: Math.max(0, Math.round(Number(b.playedMs) || 0)),
      duration_ms: Math.max(0, Math.round(Number(b.durationMs) || 0)),
    });
  return NextResponse.json({ ok: true });
}
