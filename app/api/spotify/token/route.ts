import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/connections';

// Gives Spotify's in-browser player (computers only) a short-lived token so it
// can play inside the hub tab. Only reachable when you're logged in.
export async function GET() {
  try {
    return NextResponse.json({ token: await getAccessToken('spotify') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
