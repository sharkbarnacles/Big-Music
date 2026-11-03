import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

// Runs before every page and API call: if you're not logged in, you get sent
// to /login (pages) or a 401 error (API calls).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();
  // The app icon and name must load before login (iPhone fetches them for the home screen).
  if (/^\/(apple-icon|icon)(-\d+)?\.png$|^\/icon\.svg$|^\/manifest\.webmanifest$/.test(pathname)) return NextResponse.next();
  // Background jobs prove who they are with a signature instead (see the route).
  if (pathname.startsWith('/api/jobs/')) return NextResponse.next();

  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
