import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from './env';

// OAuth "state": a random value we set in a cookie before sending you to
// Spotify/Google, then check when you come back. It blocks forged sign-ins.

export type Service = 'spotify' | 'youtube';

const cookieName = (service: Service) => `mh_oauth_state_${service}`;

export function redirectUri(service: Service): string {
  const path = service === 'spotify' ? 'spotify' : 'google';
  return `${appUrl()}/api/auth/${path}/callback`;
}

export function newState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function redirectWithState(service: Service, authorizeUrl: string, state: string) {
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(cookieName(service), state, {
    httpOnly: true,
    secure: appUrl().startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes to finish signing in
  });
  return res;
}

// Returns the ?code=... if the state matches, otherwise an error message.
export function readCallback(service: Service, req: NextRequest): { code: string } | { error: string } {
  const params = req.nextUrl.searchParams;
  if (params.get('error')) return { error: params.get('error') as string };
  const code = params.get('code');
  const state = params.get('state');
  const saved = req.cookies.get(cookieName(service))?.value;
  if (!code) return { error: 'no_code' };
  if (!state || !saved || state !== saved) return { error: 'state_mismatch' };
  return { code };
}

export function finishRedirect(service: Service, error?: string) {
  const url = new URL('/', appUrl());
  if (error) url.searchParams.set('error', `${service}: ${error}`);
  else url.searchParams.set('connected', service);
  const res = NextResponse.redirect(url);
  res.cookies.delete(cookieName(service));
  return res;
}
