import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, InsufficientTokensError } from '@/lib/tokens';
import { getSourceLead, shapeLead, snapshotFromDoc } from '@/lib/leads';
import { limit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

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

  if (!flags.lead) return jsonError(409, 'lead not unlocked yet — unlock the lead first');
  if (flags.contact) {
    return NextResponse.json({ ok: true, lead: shapeLead(doc, flags), charged: 0, balance: null });
  }

  // Trust rule: if the source has NO contact data at all, the unlock is free —
  // we never charge for an empty phone+email+website trio.
  const noContact = !doc.phone && !doc.email && !doc.website;

  const pricing = await getPricing();
  let charged = 0;
  let balance: number | null = null;
  let txId: string | null = null;

  if (!noContact) {
    try {
      const result = await spend({
        userId: s.uid, cost: pricing.CONTACT_UNLOCK_COST, type: 'spend_contact_unlock',
        description: `Kontakt feloldás — ${doc.name || 'ismeretlen'}`,
        ref: { leadId },
        idempotencyKey: `unlock:contact:${s.uid}:${id}`,
      });
      charged = result.duplicate ? 0 : pricing.CONTACT_UNLOCK_COST;
      balance = result.balance;
      txId = result.txId || null;
    } catch (e) {
      if (e instanceof InsufficientTokensError) {
        return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: e.required });
      }
      throw e;
    }
  } else {
    logEvent('contact_unlock_free_no_data', { userId: s.uid, leadId: id });
  }

  await Unlock.create({ userId, leadId, scope: 'contact', txId, snapshot: snapshotFromDoc(doc) })
    .catch((e: { code?: number }) => { if (e?.code !== 11000) throw e; });

  flags.contact = true;
  return NextResponse.json({ ok: true, lead: shapeLead(doc, flags), charged, balance, noContact });
}
