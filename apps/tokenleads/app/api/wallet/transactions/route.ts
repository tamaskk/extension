import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { TokenTransaction, TX_TYPES } from '@/lib/models';
import { requireSession, isResponse } from '@/lib/apiUtil';

const PAGE = 50;

// Cursor pagination on _id desc — stays fast however long the ledger gets.
export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();

  const sp = req.nextUrl.searchParams;
  const q: Record<string, unknown> = { userId: new Types.ObjectId(s.uid) };
  const type = sp.get('type');
  if (type && (TX_TYPES as readonly string[]).includes(type)) q.type = type;
  const from = sp.get('from'); const to = sp.get('to');
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) { const d = new Date(to); d.setDate(d.getDate() + 1); range.$lt = d; }
    q.createdAt = range;
  }
  const cursor = sp.get('cursor');
  if (cursor && Types.ObjectId.isValid(cursor)) q._id = { $lt: new Types.ObjectId(cursor) };

  const rows = await TokenTransaction.find(q).sort({ _id: -1 }).limit(PAGE + 1).lean() as unknown as
    { _id: Types.ObjectId; type: string; amount: number; balanceAfter: number; description: string; ref?: { leadId?: Types.ObjectId }; createdAt: Date }[];
  const hasMore = rows.length > PAGE;
  const items = rows.slice(0, PAGE).map((r) => ({
    id: String(r._id), type: r.type, amount: r.amount, balanceAfter: r.balanceAfter,
    description: r.description, leadId: r.ref?.leadId ? String(r.ref.leadId) : null,
    createdAt: r.createdAt,
  }));
  return NextResponse.json({ ok: true, items, nextCursor: hasMore ? items[items.length - 1].id : null });
}
