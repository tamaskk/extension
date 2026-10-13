// Shared auth bits used by API routes (Node) and the middleware (Edge).
// HS256 JWT signed with AUTH_SECRET. Edge-safe (only TextEncoder + process.env)
// — session helpers that need next/headers live in lib/session.ts.
export const AUTH_COOKIE = 'tl_auth';
export const AUTH_MAX_AGE = 7 * 24 * 3600; // 7 days

// No fallback on purpose: a key from a string in the source lets anyone who
// knows it forge a session. Unset means nobody gets in.
export function authKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set in the environment');
  return new TextEncoder().encode(secret);
}
