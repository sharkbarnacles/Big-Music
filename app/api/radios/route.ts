import { NextResponse } from 'next/server';
import { loadRadios } from '@/lib/radioList';

export const dynamic = 'force-dynamic';

// Every radio you've made, for the "Radios" chip on Home / Library playlists.
export async function GET() {
  const { radios, error } = await loadRadios();
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ radios });
}
