import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Report, Unlock } from '@/lib/models';
import { requireSessionOrKey, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { limit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

// "Bad contact data" report → admin refund queue. One per user per lead.
// Only leads the user actually paid contact for can be reported.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`report:${s.uid}`, 10, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid lead id');

  const body = await req.json().catch(() => null);
  const reason = String(body?.reason || '').trim().slice(0, 1000);
  if (!reason) return jsonError(400, 'reason required');

  await dbConnect();
  const userId = new Types.ObjectId(s.uid);
  const leadId = new Types.ObjectId(id);

  const contactUnlock = await Unlock.findOne({ userId, leadId, scope: 'contact' }).lean();
  if (!contactUnlock) return jsonError(409, 'contact not unlocked — nothing to report');

  try {
    const report = await Report.create({ userId, leadId, reason });
    logEvent('lead_reported', { userId: s.uid, leadId: id });
    return NextResponse.json({ ok: true, reportId: String(report._id) });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000) return jsonError(409, 'already reported');
    throw e;
  }
}
