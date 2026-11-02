import { NextResponse, type NextRequest } from 'next/server';
import { importSpotify } from '@/lib/importers/spotify';
import { importYouTube } from '@/lib/importers/youtube';

// Big libraries can take a few minutes to import.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const service = req.nextUrl.searchParams.get('service');
  try {
    if (service === 'spotify') return NextResponse.json(await importSpotify());
    if (service === 'youtube') return NextResponse.json(await importYouTube());
    return NextResponse.json({ error: 'Unknown service' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
