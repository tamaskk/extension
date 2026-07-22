import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE, authKey } from '@/lib/auth';

// Public pages + APIs. Everything else requires a valid session cookie —
// except developer API-key requests (Bearer tl_…): those pass through here
// and get resolved against the DB in the route layer (Edge can't reach Mongo).
const OPEN_PAGES = new Set(['/login', '/register']);
const OPEN_API = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/verify',
  '/api/pricing', '/api/webhooks/stripe',
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (req.method === 'OPTIONS') return NextResponse.next();
  if (OPEN_PAGES.has(pathname)) return NextResponse.next();
  if (pathname.startsWith('/api/')) {
    if (OPEN_API.has(pathname)) return NextResponse.next();
    if (pathname.startsWith('/api/cron/')) return NextResponse.next();       // CRON_SECRET checked in-route
    const auth = req.headers.get('authorization') || '';
    if (auth.startsWith('Bearer tl_')) return NextResponse.next();           // API key resolved in-route
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  let authed = false;
  if (token) { try { await jwtVerify(token, authKey()); authed = true; } catch { authed = false; } }
  if (authed) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif)).*)'],
};
