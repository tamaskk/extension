// A second look at the session inside a route, for the routes that handle the
// sender accounts' passwords. Server code.
//
// middleware.ts already keeps every /api path behind the login. These routes do
// not rely on that alone: if the middleware is ever skipped (a framework bug, a
// matcher that changes), what is behind them is mailbox credentials, not lead data.
import { jwtVerify } from 'jose';
import { AUTH_COOKIE, authKey } from '@/lib/auth';
import { json } from '@/lib/models';

function cookieValue(req: Request, name: string): string {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// → null when the request may go on, otherwise the answer to return.
// `write` is for requests that change something: they must be JSON sent by the
// dashboard itself. A form on another site can post text without asking the
// browser first, but it cannot set this content type.
export async function refuseUnlessOperator(req: Request, write: boolean): Promise<Response | null> {
  const token = cookieValue(req, AUTH_COOKIE);
  let authed = false;
  if (token) {
    try {
      await jwtVerify(token, authKey());
      authed = true;
    } catch {
      authed = false; // expired, forged, or AUTH_SECRET is not set: no session either way
    }
  }
  if (!authed) return json({ ok: false, error: 'unauthorized — log in first' }, { status: 401 });
  if (!write) return null;
  // browsers say where a request comes from; anything but the dashboard's own page is refused
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ ok: false, error: 'This request must come from the dashboard.' }, { status: 400 });
  // the media type itself, not a text that merely contains it: "text/plain; application/json" is still a form post
  if ((req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json({ ok: false, error: 'This request must be JSON.' }, { status: 400 });
  return null;
}
