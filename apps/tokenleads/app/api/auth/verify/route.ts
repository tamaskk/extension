import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { User } from '@/lib/models';
import { getPricing } from '@/lib/pricing';
import { credit } from '@/lib/tokens';
import { logEvent, logError } from '@/lib/monitoring';

// Email verification link target (public GET — clicked from the email).
// On success: mark verified, grant the signup bonus, pay out referral rewards.
// Everything is idempotent — a double-clicked link can't double-credit.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const appUrl = process.env.APP_URL || 'http://localhost:3010';
  const bounce = (q: string) => NextResponse.redirect(`${appUrl}/dashboard?${q}`);

  if (!token) return bounce('verify=invalid');
  await dbConnect();

  const user = await User.findOne({ verifyToken: token }) as
    { _id: unknown; email: string; emailVerifiedAt: Date | null; verifyTokenExp: Date | null;
      referredBy: unknown; referralRewardedAt: Date | null; save: () => Promise<unknown>;
      verifyToken: string | null } | null;
  if (!user) return bounce('verify=invalid');
  if (user.emailVerifiedAt) return bounce('verify=already');
  if (!user.verifyTokenExp || user.verifyTokenExp < new Date()) return bounce('verify=expired');

  user.emailVerifiedAt = new Date();
  user.verifyToken = null;
  user.verifyTokenExp = null;
  await user.save();

  const pricing = await getPricing();
  try {
    await credit({
      userId: String(user._id), amount: pricing.SIGNUP_BONUS, type: 'signup_bonus',
      description: `Üdvözlő bónusz — ${pricing.SIGNUP_BONUS} token (e-mail megerősítve)`,
      idempotencyKey: `signup:${user._id}`,
    });
  } catch (e) {
    logError('signup_bonus_failed', e, { userId: String(user._id) });
  }

  // Referral payout — both sides, once.
  if (user.referredBy && !user.referralRewardedAt) {
    try {
      await credit({
        userId: String(user.referredBy), amount: pricing.REFERRAL_BONUS, type: 'referral_bonus',
        description: `Ajánlási bónusz — meghívott felhasználó megerősítve (${user.email})`,
        idempotencyKey: `referral:${user._id}:referrer`,
      });
      await credit({
        userId: String(user._id), amount: pricing.REFERRAL_BONUS, type: 'referral_bonus',
        description: 'Ajánlási bónusz — meghívóval regisztráltál',
        idempotencyKey: `referral:${user._id}:referee`,
      });
      await User.updateOne({ _id: user._id }, { $set: { referralRewardedAt: new Date() } });
    } catch (e) {
      logError('referral_reward_failed', e, { userId: String(user._id) });
    }
  }

  logEvent('email_verified', { userId: String(user._id) });
  return bounce('verified=1');
}
