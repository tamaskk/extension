import { SignJWT } from 'jose';
import { timingSafeEqual } from 'crypto';
import { AUTH_COOKIE, AUTH_MAX_AGE, authKey } from '@/lib/auth';

export const runtime = 'nodejs';

// constant-time string compare (avoids leaking the password length/prefix via timing)
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) { try { timingSafeEqual(ab, ab); } catch { /* */ } return false; }
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const E = (process.env.EMAIL || '').trim();
  const P = process.env.PASSWORD || '';
  if (!E || !P) return Response.json({ ok: false, error: 'Login is not configured (set EMAIL & PASSWORD in the environment).' }, { status: 500 });

  const emailOk = String(body?.email || '').trim().toLowerCase() === E.toLowerCase();
  const passOk = safeEqual(String(body?.password || ''), P);
  if (!emailOk || !passOk) return Response.json({ ok: false, error: 'Invalid email or password.' }, { status: 401 });

  const token = await new SignJWT({ sub: E.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(authKey());

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${AUTH_MAX_AGE}; SameSite=Lax${secure}`,
    },
  });
}
