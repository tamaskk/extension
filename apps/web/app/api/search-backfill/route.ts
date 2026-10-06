import { dbConnect } from '@/lib/db';
import { CORS, json, mongoose } from '@/lib/models';
import { markSearchTokensReady } from '@/lib/searchIndex';
import { tokensOf } from '@/lib/searchTokens.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Write `searchTokens` on every stored lead, a chunk at a time (same pattern as
// /api/recalc). The client walks the collection by passing back `lastId` until
// done:true; the last call switches the lead search to the token index.
// Safe to run again: it only rewrites the tokens from the lead's own fields.
// POST { after?: <objectId hex>, limit?: number } → { ok, processed, lastId, done }
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const limit = Math.min(5000, Math.max(100, parseInt(b.limit, 10) || 5000));
    const after = b.after ? new mongoose.Types.ObjectId(String(b.after)) : null;
    const leads = mongoose.connection.db!.collection('leads');

    const docs = await leads.find(after ? { _id: { $gt: after } } : {}, { projection: { name: 1, category: 1, address: 1, phone: 1, email: 1 } })
      .sort({ _id: 1 }).limit(limit).toArray();
    if (docs.length) {
      await leads.bulkWrite(docs.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { searchTokens: tokensOf(d) } } } })), { ordered: false });
    }
    const done = docs.length < limit;
    if (done) await markSearchTokensReady();
    return json({ ok: true, processed: docs.length, lastId: docs.length ? String(docs[docs.length - 1]._id) : null, done });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'search backfill failed' }, { status: 500 });
  }
}
