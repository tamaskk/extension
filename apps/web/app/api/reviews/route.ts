import { dbConnect } from '@/lib/db';
import { Lead, Review, CORS, json } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';

export const runtime = 'nodejs';
export const maxDuration = 120;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/reviews?dedupKey=...   → all stored reviews for one business
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const dedupKey = u.get('dedupKey') || '';
    if (!dedupKey) return json({ ok: false, error: 'dedupKey required' }, { status: 400 });
    const docs = await Review.find({ dedupKey }).sort({ scrapedAt: -1, _id: -1 }).lean();
    const rows = (docs as Record<string, unknown>[]).map(({ _id, ...r }) => r);
    return json({ ok: true, total: rows.length, rows });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'fetch failed' }, { status: 500 });
  }
}

// POST /api/reviews
//   { project, dedupKey, cid?, placeId?, name?, reviews:[{id,author,authorUrl,rating,text,time,ownerResponse}], error? }
//   Saves up to 100 reviews (idempotent by reviewId) and marks the lead done so
//   it's skipped next time. Always marks done (even on 0 reviews / error) so the
//   scraper never loops forever on one business; `error` is recorded for retry.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const project = String(b?.project || '');
    const dedupKey = String(b?.dedupKey || '');
    if (!project || !dedupKey) return json({ ok: false, error: 'project + dedupKey required' }, { status: 400 });

    const now = new Date().toISOString();
    const cid = b?.cid ? String(b.cid) : '';
    const placeId = b?.placeId ? String(b.placeId) : '';
    const items = Array.isArray(b?.reviews) ? b.reviews.slice(0, 100) : [];

    if (items.length) {
      const ops = items.map((r: Record<string, unknown>) => {
        const doc = {
          project, dedupKey, cid, placeId,
          reviewId: r.id ? String(r.id) : '',
          author: r.author ? String(r.author) : '',
          authorUrl: r.authorUrl ? String(r.authorUrl) : '',
          rating: r.rating == null ? null : Number(r.rating),
          text: r.text ? String(r.text) : '',
          relativeTime: r.time ? String(r.time) : '',
          ownerResponse: r.ownerResponse ? String(r.ownerResponse) : '',
          scrapedAt: now,
        };
        return doc.reviewId
          ? { updateOne: { filter: { dedupKey, reviewId: doc.reviewId }, update: { $set: doc }, upsert: true } }
          : { insertOne: { document: doc } };
      });
      await Review.bulkWrite(ops, { ordered: false });
    }

    await Lead.updateOne(
      { project, dedupKey },
      { $set: { reviewsScrapedAt: now, reviewsCount: items.length, reviewsError: b?.error ? String(b.error) : '' } },
    );
    await recomputeProjectStats([project]); // reviews/reviewsSum counters changed

    return json({ ok: true, saved: items.length });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'save failed' }, { status: 500 });
  }
}
