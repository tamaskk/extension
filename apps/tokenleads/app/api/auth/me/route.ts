import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { User, Wallet, Subscription } from '@/lib/models';
import { requireSession, isResponse } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  const [user, wallet, sub] = await Promise.all([
    User.findById(s.uid).select('email name role createdAt emailVerifiedAt onboardedAt referralCode').lean() as
      Promise<{ email: string; name: string; role: string; emailVerifiedAt: Date | null; onboardedAt: Date | null; referralCode?: string } | null>,
    Wallet.findOne({ userId: s.uid }).lean() as Promise<{ balance: number; lifetimeGranted: number; lifetimeSpent: number } | null>,
    Subscription.findOne({ userId: s.uid, status: 'active' }).lean() as Promise<{ plan: string; currentPeriodEnd: Date } | null>,
  ]);
  if (!user) return NextResponse.json({ ok: false, error: 'user not found' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    user: {
      id: s.uid, email: user.email, name: user.name, role: user.role,
      verified: !!user.emailVerifiedAt,
      onboarded: !!user.onboardedAt,
      referralCode: user.referralCode || '',
      plan: sub?.plan || null,
    },
    balance: wallet?.balance ?? 0,
    lifetimeGranted: wallet?.lifetimeGranted ?? 0,
    lifetimeSpent: wallet?.lifetimeSpent ?? 0,
  });
}
