// A tiny login system for a one-person app.
// After you type the right password, the browser gets a signed cookie:
// "<expiry time>.<signature>". The signature proves the server made it,
// so nobody can fake one without knowing SESSION_SECRET.
// Uses Web Crypto so it works in middleware (edge) and normal routes alike.

export const SESSION_COOKIE = 'mh_session';
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 20) {
    throw new Error('SESSION_SECRET is missing or too short (use 40+ random characters).');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

// Compares two strings without leaking how many characters matched.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${expires}.${await sign(String(expires))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  try {
    return safeEqual(signature, await sign(expires));
  } catch {
    return false;
  }
}
