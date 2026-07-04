// Shared auth bits used by the login route (Node) and the middleware (Edge).
// HS256 JWT signed with AUTH_SECRET (falls back to PASSWORD if unset). Both are
// Edge-safe (only TextEncoder + process.env).
export const AUTH_COOKIE = 'gl_auth';
export const AUTH_MAX_AGE = 7 * 24 * 3600; // 7 days

export function authKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD || 'insecure-dev-secret-change-me';
  return new TextEncoder().encode(secret);
}
