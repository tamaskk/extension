import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { ObjectId } from 'mongodb';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { requireSessionOrKey, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getLeadOrSnapshot, leadsCollection, shapeLead, validateSourceLead, cityName } from '@/lib/leads';
import { limit } from '@/lib/rateLimit';

// Free masked teaser: 5 leads with the same category around the same city.
// Marketing surface — drives the next unlock, so no token charge.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`similar:${s.uid}`, 30, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const { id } = await ctx.params;
  await dbConnect();

  const userId = new Types.ObjectId(s.uid);
  const doc = await getLeadOrSnapshot(id, userId);
  if (!doc) return jsonError(404, 'lead not found');

  const city = cityName(doc.address as string | undefined);
  const query: Record<string, unknown> = { _id: { $ne: new ObjectId(id) } };
  if (doc.category) query.category = doc.category;
  if (city) query.address = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const col = await leadsCollection();
  const docs = (await col.find(query).sort({ leadScore: -1, _id: 1 }).limit(5).toArray()).map(validateSourceLead);

  const unlocks = await Unlock.find({ userId, leadId: { $in: docs.map((d) => d._id) } }).lean() as unknown as
    { leadId: Types.ObjectId; scope: 'lead' | 'contact' }[];
  const fmap = new Map<string, { lead: boolean; contact: boolean }>();
  for (const u of unlocks) {
    const f = fmap.get(String(u.leadId)) || { lead: false, contact: false };
    f[u.scope] = true;
    fmap.set(String(u.leadId), f);
  }

  return NextResponse.json({
    ok: true,
    items: docs.map((d) => shapeLead(d, fmap.get(String(d._id)) || { lead: false, contact: false })),
  });
}
