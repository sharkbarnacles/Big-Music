import { NextResponse, type NextRequest } from 'next/server';
import { logPlay } from '@/lib/discover';

// The player reports each song you listen to for 30 seconds or more.
// These plays make the Month mix and keep Forgotten favorites truly forgotten.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.trackId !== 'string') return NextResponse.json({ ok: false }, { status: 400 });
  await logPlay(body.trackId, body.service === 'spotify' ? 'spotify' : 'youtube').catch(() => {});
  return NextResponse.json({ ok: true });
}
