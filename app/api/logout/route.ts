import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/env';
import { SESSION_COOKIE } from '@/lib/session';

export async function POST() {
  const res = NextResponse.redirect(new URL('/login', appUrl()), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
