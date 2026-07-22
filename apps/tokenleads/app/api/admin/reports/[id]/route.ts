import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Report } from '@/lib/models';
import { requireAdmin, isResponse, jsonError } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { credit } from '@/lib/tokens';
import { logEvent } from '@/lib/monitoring';

// Resolve a bad-data report: refund (contact price back) or reject.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid report id');
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'refund' && action !== 'reject') return jsonError(400, 'action must be refund|reject');

  await dbConnect();
  const report = await Report.findOne({ _id: id, status: 'pending' }) as
    { _id: unknown; userId: unknown; leadId: unknown; status: string; refundTxId: unknown;
      resolvedBy: string; resolvedAt: Date | null; save: () => Promise<unknown> } | null;
  if (!report) return jsonError(404, 'pending report not found');

  if (action === 'refund') {
    const pricing = await getPricing();
    const r = await credit({
      userId: String(report.userId), amount: pricing.CONTACT_UNLOCK_COST, type: 'refund',
      description: 'Visszatérítés — hibás kontaktadat bejelentés elfogadva',
      ref: { leadId: report.leadId as Types.ObjectId },
      idempotencyKey: `refund:report:${report._id}`,
    });
    report.refundTxId = r.txId ? new Types.ObjectId(r.txId) : null;
    report.status = 'refunded';
  } else {
    report.status = 'rejected';
  }
  report.resolvedBy = s.email;
  report.resolvedAt = new Date();
  await report.save();
  logEvent('report_resolved', { reportId: id, action, by: s.email });
  return NextResponse.json({ ok: true, status: report.status });
}
