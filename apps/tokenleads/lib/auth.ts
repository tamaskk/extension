// Shared auth bits used by API routes (Node) and the middleware (Edge).
// HS256 JWT signed with AUTH_SECRET. Edge-safe (only TextEncoder + process.env)
// — session helpers that need next/headers live in lib/session.ts.
export const AUTH_COOKIE = 'tl_auth';
export const AUTH_MAX_AGE = 7 * 24 * 3600; // 7 days

export function authKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'insecure-dev-secret-change-me';
  return new TextEncoder().encode(secret);
}
