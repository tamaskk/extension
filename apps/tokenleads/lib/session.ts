import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, AUTH_MAX_AGE, authKey } from './auth';

export interface Session { uid: string; email: string; role: 'user' | 'admin'; }

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ email: s.email, role: s.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.uid)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_MAX_AGE}s`)
    .sign(authKey());
}

// Session from the request cookie — route handlers only (middleware already
// guarantees a valid token exists on protected paths, but verify anyway).
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authKey());
    if (!payload.sub) return null;
    return { uid: payload.sub, email: String(payload.email || ''), role: payload.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return {
    name: AUTH_COOKIE, value: token,
    httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_MAX_AGE, path: '/',
  };
}
