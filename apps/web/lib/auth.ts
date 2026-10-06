// Shared auth bits used by the login route (Node) and the middleware (Edge).
// HS256 JWT signed with AUTH_SECRET. Both are Edge-safe (only TextEncoder +
// process.env).
export const AUTH_COOKIE = 'gl_auth';
// 90 days: the outreach runner tab is left alone for weeks and must not be logged out under it.
export const AUTH_MAX_AGE = 90 * 24 * 3600;

// No fallback on purpose: a key derived from PASSWORD or from a string in the
// source lets anyone who knows it forge a session. Unset means nobody gets in.
export function authKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set in the environment');
  return new TextEncoder().encode(secret);
}
