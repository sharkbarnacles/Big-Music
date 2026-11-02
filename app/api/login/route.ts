import { NextResponse, type NextRequest } from 'next/server';
import { appUrl, env } from '@/lib/env';
import { createSessionToken, safeEqual, SESSION_COOKIE, SESSION_DAYS } from '@/lib/session';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get('password') ?? '');

  if (!safeEqual(password, env('APP_PASSWORD'))) {
    // Small delay makes password guessing slower.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.redirect(new URL('/login?error=1', appUrl()), 303);
  }

  const res = NextResponse.redirect(new URL('/', appUrl()), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: appUrl().startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}
