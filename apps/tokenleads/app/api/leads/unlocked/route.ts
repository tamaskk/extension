import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { ObjectId } from 'mongodb';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { requireSessionOrKey, isResponse } from '@/lib/apiUtil';
import { LeadMeta } from '@/lib/models';
import { leadsCollection, shapeLead, validateSourceLead } from '@/lib/leads';

// "My leads" — everything the user has paid for, newest unlock first.
// Falls back to the unlock-time snapshot when the source row was deleted.
export async function GET(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  await dbConnect();

  const scopeFilter = req.nextUrl.searchParams.get('scope'); // optional: lead|contact
  const userId = new Types.ObjectId(s.uid);
  const unlocks = await Unlock.find({ userId }).sort({ createdAt: -1 }).limit(1000).lean() as unknown as
    { leadId: Types.ObjectId; scope: 'lead' | 'contact'; createdAt: Date; snapshot: Record<string, unknown> | null }[];

  const flags = new Map<string, { lead: boolean; contact: boolean; at: Date; snapshot: Record<string, unknown> | null }>();
  for (const u of unlocks) {
    const k = String(u.leadId);
    const f = flags.get(k) || { lead: false, contact: false, at: u.createdAt, snapshot: null };
    f[u.scope] = true;
    if (u.createdAt > f.at) f.at = u.createdAt;
    if (u.snapshot) f.snapshot = u.snapshot;
    flags.set(k, f);
  }

  let entries = [...flags.entries()];
  if (scopeFilter === 'contact') entries = entries.filter(([, f]) => f.contact);
  entries.sort((a, b) => b[1].at.getTime() - a[1].at.getTime());

  const [docs, metas] = await Promise.all([
    leadsCollection().then((col) => col.find({ _id: { $in: entries.map(([k]) => new ObjectId(k)) } }).toArray()),
    LeadMeta.find({ userId, leadId: { $in: entries.map(([k]) => new Types.ObjectId(k)) } }).lean() as Promise<unknown> as Promise<
      { leadId: Types.ObjectId; note: string; status: string; tags: string[] }[]>,
  ]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const metaById = new Map(metas.map((m) => [String(m.leadId), m]));

  const items = entries
    .map(([k, f]) => {
      const doc = byId.get(k) || (f.snapshot ? validateSourceLead({ _id: new ObjectId(k), ...f.snapshot }) : null);
      if (!doc) return null;
      const meta = metaById.get(k);
      return {
        ...shapeLead(doc, { lead: f.lead, contact: f.contact }),
        unlockedAt: f.at,
        meta: meta ? { note: meta.note, status: meta.status, tags: meta.tags } : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, items });
}
