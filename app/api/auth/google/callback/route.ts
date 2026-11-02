import type { NextRequest } from 'next/server';
import { googleTokenRequest, saveConnection } from '@/lib/connections';
import { finishRedirect, readCallback, redirectUri } from '@/lib/oauth';

// Google sends you back here after you click "Allow".
export async function GET(req: NextRequest) {
  const result = readCallback('youtube', req);
  if ('error' in result) return finishRedirect('youtube', result.error);

  try {
    const tokens = await googleTokenRequest({
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri('youtube'),
    });
    const channel = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => (r.ok ? r.json() : null));
    await saveConnection('youtube', tokens, channel?.items?.[0]?.snippet?.title ?? null);
    return finishRedirect('youtube');
  } catch (err) {
    return finishRedirect('youtube', (err as Error).message.slice(0, 150));
  }
}
