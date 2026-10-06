import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE, authKey } from '@/lib/auth';

// API routes reachable without a login. EXACT paths only, so sub-routes like
// /api/reviews/list stay PROTECTED. The two read-only scraper routes
// (/api/reviews/next, /api/missing-states) are open on purpose. The routes that
// WRITE lead data (/api/sync, /api/reviews) are not: the extensions send the
// gl_auth cookie, like /api/audit. /api/enrich is localhost-guarded inside the
// route (403s on prod), safe to leave open here.
// /api/outreach/cron is for a scheduler, which has no session: the route itself
// lets in only a request that carries CRON_SECRET, and answers 404 to the rest.
const OPEN_API = new Set(['/api/login', '/api/logout', '/api/reviews/next', '/api/missing-states', '/api/enrich', '/api/outreach/cron']);

function isOpenApi(pathname: string) {
  return OPEN_API.has(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (req.method === 'OPTIONS') return NextResponse.next();   // CORS preflight — never block
  if (pathname === '/login') return NextResponse.next();      // login page is public
  if (pathname.startsWith('/api/') && isOpenApi(pathname)) return NextResponse.next();

  // everything else requires a valid session cookie
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  let authed = false;
  if (token) { try { await jwtVerify(token, authKey()); authed = true; } catch { authed = false; } }
  if (authed) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'unauthorized — log in first' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  return NextResponse.redirect(url);
}

// run on everything except Next internals and static image assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif)).*)'],
};
