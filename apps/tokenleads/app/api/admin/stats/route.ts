import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { User, Wallet, TokenTransaction, Unlock } from '@/lib/models';
import { requireAdmin, isResponse } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();

  const [userCount, walletAgg, typeAgg, unlockCount, topSpenders] = await Promise.all([
    User.countDocuments(),
    Wallet.aggregate([{ $group: { _id: null, balance: { $sum: '$balance' }, granted: { $sum: '$lifetimeGranted' }, spent: { $sum: '$lifetimeSpent' } } }]),
    TokenTransaction.aggregate([{ $group: { _id: '$type', count: { $sum: 1 }, tokens: { $sum: '$amount' } } }]),
    Unlock.countDocuments(),
    Wallet.aggregate([
      { $sort: { lifetimeSpent: -1 } }, { $limit: 10 },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $project: { balance: 1, lifetimeSpent: 1, email: { $arrayElemAt: ['$user.email', 0] } } },
    ]),
  ]);

  return NextResponse.json({
    ok: true,
    users: userCount,
    tokens: walletAgg[0] || { balance: 0, granted: 0, spent: 0 },
    byType: typeAgg,
    unlocks: unlockCount,
    topSpenders,
  });
}
