import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { User } from '@/lib/models';
import { requireSession, isResponse } from '@/lib/apiUtil';

// Marks the onboarding tour as completed.
export async function POST() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  await User.updateOne({ _id: s.uid, onboardedAt: null }, { $set: { onboardedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
