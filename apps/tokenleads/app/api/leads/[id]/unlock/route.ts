import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, InsufficientTokensError } from '@/lib/tokens';
import { getSourceLead, shapeLead, snapshotFromDoc, cityName } from '@/lib/leads';
import { limit } from '@/lib/rateLimit';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`unlock:${s.uid}`, 60, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const gate = await requireVerified(s);
  if (gate) return gate;
  const { id } = await ctx.params;
  await dbConnect();

  const doc = await getSourceLead(id);
  if (!doc) return jsonError(404, 'lead not found');

  const userId = new Types.ObjectId(s.uid);
  const leadId = new Types.ObjectId(id);
  const existing = await Unlock.find({ userId, leadId }).lean() as unknown as { scope: 'lead' | 'contact' }[];
  const flags = { lead: false, contact: false };
  for (const u of existing) flags[u.scope] = true;

  // Already paid → free, idempotent response.
  if (flags.lead) {
    return NextResponse.json({ ok: true, lead: shapeLead(doc, flags), charged: 0, balance: null });
  }

  const pricing = await getPricing();
  const city = cityName(doc.address as string | undefined);
  let result;
  try {
    result = await spend({
      userId: s.uid, cost: pricing.LEAD_UNLOCK_COST, type: 'spend_lead_unlock',
      description: `Lead feloldás — ${doc.name || 'ismeretlen'}${city ? `, ${city}` : ''}`,
      ref: { leadId },
      idempotencyKey: `unlock:lead:${s.uid}:${id}`,
    });
  } catch (e) {
    if (e instanceof InsufficientTokensError) {
      return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: e.required });
    }
    throw e;
  }

  await Unlock.create({ userId, leadId, scope: 'lead', txId: result.txId || null, snapshot: snapshotFromDoc(doc) })
    .catch((e: { code?: number }) => { if (e?.code !== 11000) throw e; });

  flags.lead = true;
  return NextResponse.json({ ok: true, lead: shapeLead(doc, flags), charged: result.duplicate ? 0 : pricing.LEAD_UNLOCK_COST, balance: result.balance });
}
