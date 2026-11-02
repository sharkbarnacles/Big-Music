import type { NextRequest } from 'next/server';
import { saveConnection, spotifyTokenRequest } from '@/lib/connections';
import { finishRedirect, readCallback, redirectUri } from '@/lib/oauth';

// Spotify sends you back here after you click "Agree".
export async function GET(req: NextRequest) {
  const result = readCallback('spotify', req);
  if ('error' in result) return finishRedirect('spotify', result.error);

  try {
    const tokens = await spotifyTokenRequest({
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri('spotify'),
    });
    const me = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => (r.ok ? r.json() : null));
    await saveConnection('spotify', tokens, me?.display_name ?? me?.id ?? null);
    return finishRedirect('spotify');
  } catch (err) {
    return finishRedirect('spotify', (err as Error).message.slice(0, 150));
  }
}
