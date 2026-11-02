import { env } from '@/lib/env';
import { newState, redirectUri, redirectWithState } from '@/lib/oauth';

// What we ask Spotify permission for. Playback scopes are included now so
// you won't need to reconnect when phase 2 (playback) arrives.
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export async function GET() {
  const state = newState();
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env('SPOTIFY_CLIENT_ID'),
    scope: SCOPES,
    redirect_uri: redirectUri('spotify'),
    state,
  }).toString();
  return redirectWithState('spotify', url.toString(), state);
}
