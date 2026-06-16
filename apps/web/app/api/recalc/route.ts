import { dbConnect } from '@/lib/db';
import { Lead, mongoose, CORS, json } from '@/lib/models';
import { score } from '@/lib/scoring';
import type { WebsiteStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Recompute opportunity/lead scores for stored leads, a chunk at a time. The
// client walks the whole collection by passing back `lastId` until done:true.
// POST { after?: <objectId hex>, limit?: number } → { ok, processed, lastId, done, total? }
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const limit = Math.min(5000, Math.max(100, parseInt(b.limit, 10) || 2000));
    const after = b.after ? new mongoose.Types.ObjectId(String(b.after)) : null;

    const q = after ? { _id: { $gt: after } } : {};
    const docs = await Lead.find(q)
      .sort({ _id: 1 })
      .limit(limit)
      .select('_id website websiteStatus reviewCount rating hasBookingHint')
      .lean() as any[];

    const ops = docs.map((d) => {
      const s = score({
        website: d.website,
        websiteStatus: d.websiteStatus as WebsiteStatus,
        reviewCount: d.reviewCount,
        rating: d.rating,
        hasBookingHint: d.hasBookingHint,
      });
      return { updateOne: { filter: { _id: d._id }, update: { $set: {
        opportunityScore: s.opportunityScore,
        leadScore: s.leadScore,
        leadTemperature: s.leadTemperature,
        topPitch: s.topPitch,
      } } } };
    });
    if (ops.length) await Lead.bulkWrite(ops, { ordered: false });

    const lastId = docs.length ? String(docs[docs.length - 1]._id) : null;
    const done = docs.length < limit;
    const total = after ? undefined : await Lead.countDocuments({});
    return json({ ok: true, processed: docs.length, lastId, done, total });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'recalc failed' }, { status: 500 });
  }
}
