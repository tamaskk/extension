import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { User } from '@/lib/models';
import { requireSession, isResponse } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';

export async function GET() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  const [me, invited, rewarded, pricing] = await Promise.all([
    User.findById(s.uid).select('referralCode').lean() as Promise<{ referralCode?: string } | null>,
    User.countDocuments({ referredBy: new Types.ObjectId(s.uid) }),
    User.countDocuments({ referredBy: new Types.ObjectId(s.uid), referralRewardedAt: { $ne: null } }),
    getPricing(),
  ]);
  const appUrl = process.env.APP_URL || 'http://localhost:3010';
  return NextResponse.json({
    ok: true,
    code: me?.referralCode || '',
    link: me?.referralCode ? `${appUrl}/register?ref=${me.referralCode}` : '',
    invited, rewarded,
    bonus: pricing.REFERRAL_BONUS,
  });
}
