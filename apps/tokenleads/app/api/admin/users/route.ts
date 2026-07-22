import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { User, Wallet } from '@/lib/models';
import { requireAdmin, isResponse } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();
  const users = await User.find().sort({ createdAt: -1 }).limit(500)
    .select('email name role createdAt').lean() as unknown as
    { _id: Types.ObjectId; email: string; name: string; role: string; createdAt: Date }[];
  const wallets = await Wallet.find({ userId: { $in: users.map((u) => u._id) } }).lean() as unknown as
    { userId: Types.ObjectId; balance: number; lifetimeGranted: number; lifetimeSpent: number }[];
  const byUser = new Map(wallets.map((w) => [String(w.userId), w]));
  return NextResponse.json({
    ok: true,
    users: users.map((u) => {
      const w = byUser.get(String(u._id));
      return {
        id: String(u._id), email: u.email, name: u.name, role: u.role, createdAt: u.createdAt,
        balance: w?.balance ?? 0, lifetimeGranted: w?.lifetimeGranted ?? 0, lifetimeSpent: w?.lifetimeSpent ?? 0,
      };
    }),
  });
}
