import { env } from '@/lib/env';
import { newState, redirectUri, redirectWithState } from '@/lib/oauth';

// Read-only access to your YouTube account (playlists, likes). Nothing can be changed.
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

export async function GET() {
  const state = newState();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri('youtube'),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // gives a refresh token so you stay connected
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return redirectWithState('youtube', url.toString(), state);
}
