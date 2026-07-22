import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Wallet, Unlock } from '@/lib/models';
import { requireSession, isResponse } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  const [wallet, leadUnlocks, contactUnlocks] = await Promise.all([
    Wallet.findOne({ userId: s.uid }).lean() as Promise<{ balance: number; lifetimeGranted: number; lifetimeSpent: number } | null>,
    Unlock.countDocuments({ userId: s.uid, scope: 'lead' }),
    Unlock.countDocuments({ userId: s.uid, scope: 'contact' }),
  ]);
  return NextResponse.json({
    ok: true,
    balance: wallet?.balance ?? 0,
    lifetimeGranted: wallet?.lifetimeGranted ?? 0,
    lifetimeSpent: wallet?.lifetimeSpent ?? 0,
    leadUnlocks, contactUnlocks,
  });
}
