import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, explainFailure, spotifyFetch } from '@/lib/spotifyPlayer';

// POST /api/player/spotify?action=pause|resume|next|previous
const ACTIONS: Record<string, { method: string; path: string }> = {
  pause: { method: 'PUT', path: '/me/player/pause' },
  resume: { method: 'PUT', path: '/me/player/play' },
  next: { method: 'POST', path: '/me/player/next' },
  previous: { method: 'POST', path: '/me/player/previous' },
};

export async function POST(req: NextRequest) {
  const action = ACTIONS[req.nextUrl.searchParams.get('action') ?? ''];
  if (!action) return NextResponse.json({ error: 'bad_request', message: 'Unknown action.' }, { status: 400 });
  try {
    const res = await spotifyFetch(action.path, { method: action.method });
    if (!res.ok) return explainFailure(res);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
