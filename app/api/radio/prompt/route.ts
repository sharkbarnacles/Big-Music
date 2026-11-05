import { NextResponse, type NextRequest } from 'next/server';
import { runPromptRadio } from '@/lib/promptRadioRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET ?q=niche underground chill thai&mode=… → a radio built from playlists
// people made for those words (lib/promptRadio.ts). More comes through
// /api/radio?continuation=p:… like any radio.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') === 'new' ? 'new' : sp.get('mode') === 'familiar' ? 'familiar' : 'mixed';
  try {
    const out = await runPromptRadio({ q: sp.get('q') ?? '', mode });
    if (!out.tracks.length) {
      return NextResponse.json({ error: `Couldn’t find playlists for “${sp.get('q')}”. Try fewer or other words.` }, { status: 404 });
    }
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
