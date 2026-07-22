import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Report, User } from '@/lib/models';
import { requireAdmin, isResponse } from '@/lib/apiUtil';

export async function GET(req: NextRequest) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();
  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const reports = await Report.find(status === 'all' ? {} : { status }).sort({ createdAt: -1 }).limit(200).lean() as unknown as
    { _id: Types.ObjectId; userId: Types.ObjectId; leadId: Types.ObjectId; reason: string; status: string; createdAt: Date; resolvedBy: string; resolvedAt: Date | null }[];
  const users = await User.find({ _id: { $in: reports.map((r) => r.userId) } }).select('email').lean() as unknown as
    { _id: Types.ObjectId; email: string }[];
  const emailById = new Map(users.map((u) => [String(u._id), u.email]));
  return NextResponse.json({
    ok: true,
    reports: reports.map((r) => ({
      id: String(r._id), userEmail: emailById.get(String(r.userId)) || '?', leadId: String(r.leadId),
      reason: r.reason, status: r.status, createdAt: r.createdAt, resolvedBy: r.resolvedBy, resolvedAt: r.resolvedAt,
    })),
  });
}
