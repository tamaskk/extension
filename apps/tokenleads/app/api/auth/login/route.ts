import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { dbConnect } from '@/lib/db';
import { User, Wallet } from '@/lib/models';
import { signSession, sessionCookie } from '@/lib/session';
import { jsonError, clientIp, rateLimited } from '@/lib/apiUtil';
import { limit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  // Brute-force guard — shares the per-IP window with registration.
  const rl = limit(`auth:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const body = await req.json().catch(() => null);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || !password) return jsonError(400, 'email and password required');

  await dbConnect();
  const user = await User.findOne({ email }).lean() as
    { _id: unknown; email: string; name: string; role: 'user' | 'admin'; passwordHash: string } | null;
  // Same error for unknown email and wrong password — no account enumeration.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return jsonError(401, 'invalid credentials');
  }

  const wallet = await Wallet.findOne({ userId: user._id }).lean() as { balance: number } | null;
  const token = await signSession({ uid: String(user._id), email: user.email, role: user.role });
  const res = NextResponse.json({
    ok: true,
    user: { id: String(user._id), email: user.email, name: user.name, role: user.role },
    balance: wallet?.balance ?? 0,
  });
  res.cookies.set(sessionCookie(token));
  return res;
}
