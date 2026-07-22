import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { ObjectId } from 'mongodb';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, InsufficientTokensError } from '@/lib/tokens';
import { leadsCollection, shapeLead, snapshotFromDoc, validateSourceLead } from '@/lib/leads';
import { limit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

const MAX_BULK = 20;

// Bulk lead unlock with a discount — one transaction, one ledger row.
// Only NOT-yet-unlocked leads are charged; already-owned ones ride free.
export async function POST(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`unlock:${s.uid}`, 60, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const gate = await requireVerified(s);
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string' && ObjectId.isValid(x)) : [];
  if (!ids.length) return jsonError(400, 'ids required');
  if (ids.length > MAX_BULK) return jsonError(400, `max ${MAX_BULK} leads per bulk unlock`);

  await dbConnect();
  const userId = new Types.ObjectId(s.uid);
  const objIds = [...new Set(ids)].map((i) => new ObjectId(i));

  const col = await leadsCollection();
  const docs = (await col.find({ _id: { $in: objIds } }).toArray()).map(validateSourceLead);
  if (!docs.length) return jsonError(404, 'no leads found');

  const existing = await Unlock.find({ userId, leadId: { $in: objIds }, scope: 'lead' }).lean() as unknown as { leadId: Types.ObjectId }[];
  const owned = new Set(existing.map((u) => String(u.leadId)));
  const toUnlock = docs.filter((d) => !owned.has(String(d._id)));

  const pricing = await getPricing();
  const fullPrice = toUnlock.length * pricing.LEAD_UNLOCK_COST;
  const cost = Math.ceil(fullPrice * (100 - pricing.BULK_DISCOUNT_PCT) / 100);

  let balance: number | null = null;
  let txId: string | null = null;
  let charged = 0;
  if (toUnlock.length) {
    const idsHash = createHash('sha1').update(toUnlock.map((d) => String(d._id)).sort().join(',')).digest('hex');
    try {
      const result = await spend({
        userId: s.uid, cost, type: 'spend_bulk_unlock',
        description: `Csoportos feloldás — ${toUnlock.length} lead (${pricing.BULK_DISCOUNT_PCT}% kedvezmény, ${fullPrice} helyett ${cost} token)`,
        idempotencyKey: `bulk:${s.uid}:${idsHash}`,
      });
      balance = result.balance;
      txId = result.txId || null;
      charged = result.duplicate ? 0 : cost; // duplicate → decrement was compensated, nothing billed
      if (result.duplicate) logEvent('bulk_unlock_duplicate', { userId: s.uid });
    } catch (e) {
      if (e instanceof InsufficientTokensError) {
        return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: cost });
      }
      throw e;
    }

    // Insert unlocks — duplicates (races) are fine, the unique index guards.
    await Unlock.insertMany(
      toUnlock.map((d) => ({
        userId, leadId: d._id, scope: 'lead', txId, snapshot: snapshotFromDoc(d),
      })),
      { ordered: false },
    ).catch((e: { code?: number; writeErrors?: unknown[] }) => {
      // ordered:false → duplicate-key errors are collected, others rethrow
      if (e?.code !== 11000 && !(e as { message?: string })?.message?.includes('E11000')) throw e;
    });
  }

  const contactUnlocks = await Unlock.find({ userId, leadId: { $in: objIds }, scope: 'contact' }).lean() as unknown as { leadId: Types.ObjectId }[];
  const contactSet = new Set(contactUnlocks.map((u) => String(u.leadId)));
  const items = docs.map((d) => shapeLead(d, { lead: true, contact: contactSet.has(String(d._id)) }));

  logEvent('bulk_unlock', { userId: s.uid, requested: ids.length, unlocked: toUnlock.length, charged });
  return NextResponse.json({ ok: true, items, unlocked: toUnlock.length, alreadyOwned: owned.size, charged, balance });
}
