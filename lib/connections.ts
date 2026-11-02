import { db } from './db';
import { env } from './env';
import type { Service } from './oauth';

// Stores sign-ins and hands out a working access token, refreshing it when
// it's about to expire (Spotify and Google tokens last about an hour).

export type Connection = {
  service: Service;
  account_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export class NotConnectedError extends Error {
  constructor(service: Service) {
    super(`${service} is not connected (or the sign-in expired). Connect it again from the home page.`);
  }
}

export async function getConnection(service: Service): Promise<Connection | null> {
  const { data, error } = await db().from('connections').select('*').eq('service', service).maybeSingle();
  if (error) throw new Error(`Database error: ${error.message}`);
  return data as Connection | null;
}

export async function saveConnection(service: Service, tokens: TokenResponse, accountName: string | null) {
  const existing = await getConnection(service);
  const row = {
    service,
    account_name: accountName ?? existing?.account_name ?? null,
    access_token: tokens.access_token,
    // Google only sends a refresh token the first time; keep the old one if none came back.
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from('connections').upsert(row, { onConflict: 'service' });
  if (error) throw new Error(`Database error: ${error.message}`);
}

// ── Token exchange with each service ──────────────────────────────────

export async function spotifyTokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = btoa(`${env('SPOTIFY_CLIENT_ID')}:${env('SPOTIFY_CLIENT_SECRET')}`);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function googleTokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...body,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getAccessToken(service: Service): Promise<string> {
  const conn = await getConnection(service);
  if (!conn) throw new NotConnectedError(service);

  const msLeft = new Date(conn.expires_at).getTime() - Date.now();
  if (msLeft > 60_000) return conn.access_token;

  if (!conn.refresh_token) throw new NotConnectedError(service);
  try {
    const params = { grant_type: 'refresh_token', refresh_token: conn.refresh_token };
    const tokens =
      service === 'spotify' ? await spotifyTokenRequest(params) : await googleTokenRequest(params);
    await saveConnection(service, tokens, conn.account_name);
    return tokens.access_token;
  } catch {
    // Usually means the refresh token was revoked or expired.
    throw new NotConnectedError(service);
  }
}
