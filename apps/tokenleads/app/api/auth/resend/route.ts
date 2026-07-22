import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { dbConnect } from '@/lib/db';
import { User } from '@/lib/models';
import { requireSession, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { limit } from '@/lib/rateLimit';
import { getPricing } from '@/lib/pricing';
import { sendMail, verifyEmailHtml } from '@/lib/mailer';

// Re-send the verification email (logged-in, unverified users).
export async function POST() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const rl = limit(`resend:${s.uid}`, 3, 10 * 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  await dbConnect();
  const user = await User.findById(s.uid) as
    { _id: unknown; email: string; emailVerifiedAt: Date | null; verifyToken: string | null;
      verifyTokenExp: Date | null; save: () => Promise<unknown> } | null;
  if (!user) return jsonError(404, 'user not found');
  if (user.emailVerifiedAt) return jsonError(409, 'already verified');

  user.verifyToken = randomBytes(32).toString('hex');
  user.verifyTokenExp = new Date(Date.now() + 24 * 3600_000);
  await user.save();

  const pricing = await getPricing();
  const appUrl = process.env.APP_URL || 'http://localhost:3010';
  const verifyUrl = `${appUrl}/api/auth/verify?token=${user.verifyToken}`;
  const status = await sendMail(user.email, 'Erősítsd meg az e-mail címed — TokenLeads', verifyEmailHtml(verifyUrl, pricing.SIGNUP_BONUS));
  return NextResponse.json({ ok: true, mailStatus: status, ...(status === 'dev' ? { devVerifyUrl: verifyUrl } : {}) });
}
