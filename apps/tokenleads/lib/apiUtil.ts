import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSession, Session } from './session';
import { dbConnect } from './db';
import { User, ApiKey } from './models';

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function requireSession(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) return jsonError(401, 'unauthorized');
  return s;
}

// Cookie session OR developer API key (Authorization: Bearer tl_live_…).
// The Edge middleware lets Bearer tl_ requests through; identity resolves
// here in the Node runtime where the DB is reachable.
export async function requireSessionOrKey(req: NextRequest): Promise<Session | NextResponse> {
  const s = await getSession();
  if (s) return s;
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer tl_')) {
    const raw = auth.slice(7);
    const keyHash = createHash('sha256').update(raw).digest('hex');
    await dbConnect();
    const key = await ApiKey.findOne({ keyHash, revokedAt: null }).lean() as { _id: unknown; userId: unknown } | null;
    if (key) {
      const user = await User.findById(key.userId).select('email role').lean() as { email: string; role: 'user' | 'admin' } | null;
      if (user) {
        void ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).exec();
        return { uid: String(key.userId), email: user.email, role: user.role };
      }
    }
    return jsonError(401, 'invalid api key');
  }
  return jsonError(401, 'unauthorized');
}

// Spending endpoints require a verified email — this is the anti-farming gate:
// the signup bonus and all token actions only open after verification.
export async function requireVerified(s: Session): Promise<NextResponse | null> {
  await dbConnect();
  const u = await User.findById(s.uid).select('emailVerifiedAt').lean() as { emailVerifiedAt?: Date | null } | null;
  if (!u) return jsonError(401, 'unauthorized');
  if (!u.emailVerifiedAt) return jsonError(403, 'email_not_verified');
  return null;
}

// Admin = role claim in the JWT AND role still 'admin' in the DB — a revoked
// admin loses access immediately, not at cookie expiry.
export async function requireAdmin(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s || s.role !== 'admin') return jsonError(403, 'admin only');
  await dbConnect();
  const u = await User.findById(s.uid).select('role').lean() as { role?: string } | null;
  if (u?.role !== 'admin') return jsonError(403, 'admin only');
  return s;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export function rateLimited(retryAfter: number) {
  const res = jsonError(429, 'rate_limited', { retryAfter });
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}
