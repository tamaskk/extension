import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { dbConnect } from '@/lib/db';
import { User, Wallet } from '@/lib/models';
import { signSession, sessionCookie } from '@/lib/session';
import { jsonError, clientIp, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { isDisposableEmail } from '@/lib/disposableDomains';
import { limit, bumpDailyQuota } from '@/lib/rateLimit';
import { sendMail, verifyEmailHtml } from '@/lib/mailer';
import { logEvent } from '@/lib/monitoring';

const REG_PER_IP_PER_DAY = 3;

// Anti-farming flow: the account is created immediately, but the signup bonus
// is only credited when the email gets VERIFIED (see /api/auth/verify).
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = limit(`auth:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const body = await req.json().catch(() => null);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const name = String(body?.name || '').trim().slice(0, 80);
  const refCode = String(body?.ref || '').trim().toUpperCase().slice(0, 16);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'invalid email');
  if (isDisposableEmail(email)) return jsonError(400, 'disposable_email');
  if (password.length < 8) return jsonError(400, 'password must be at least 8 characters');

  await dbConnect();
  if (await User.exists({ email })) return jsonError(409, 'email already registered');

  const regCount = await bumpDailyQuota(`reg:${ip}`);
  if (regCount > REG_PER_IP_PER_DAY) {
    logEvent('registration_ip_quota_hit', { ip });
    return jsonError(429, 'too_many_registrations');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const role = email === (process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'user';
  const verifyToken = randomBytes(32).toString('hex');
  const referralCode = randomBytes(4).toString('hex').toUpperCase();

  let referredBy = null;
  if (refCode) {
    const referrer = await User.findOne({ referralCode: refCode }).select('_id').lean() as { _id: unknown } | null;
    if (referrer) referredBy = referrer._id;
  }

  let user;
  try {
    user = await User.create({
      email, passwordHash, name, role,
      verifyToken, verifyTokenExp: new Date(Date.now() + 24 * 3600_000),
      referralCode, referredBy,
    });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000) return jsonError(409, 'email already registered');
    throw e;
  }
  await Wallet.create({ userId: user._id, balance: 0 });

  const pricing = await getPricing();
  const appUrl = process.env.APP_URL || 'http://localhost:3010';
  const verifyUrl = `${appUrl}/api/auth/verify?token=${verifyToken}`;
  const mailStatus = await sendMail(email, 'Erősítsd meg az e-mail címed — TokenLeads', verifyEmailHtml(verifyUrl, pricing.SIGNUP_BONUS));
  logEvent('user_registered', { userId: String(user._id), referred: !!referredBy, mailStatus });

  const token = await signSession({ uid: String(user._id), email, role });
  const res = NextResponse.json({
    ok: true,
    user: { id: String(user._id), email, name, role },
    balance: 0,
    verifyMailStatus: mailStatus,
    // Dev convenience: without an email provider the link is surfaced here
    // (and in the admin outbox). Never present when RESEND is configured.
    ...(mailStatus === 'dev' ? { devVerifyUrl: verifyUrl } : {}),
  });
  res.cookies.set(sessionCookie(token));
  return res;
}
