import { dbConnect } from '@/lib/db';
import { Project, Lead, NO_SITE, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Project summaries with lead counts (folderId, total, noWebsite, hot, email).
export async function GET() {
  await dbConnect();
  const [projects, agg] = await Promise.all([
    Project.find().lean(),
    Lead.aggregate([
      { $group: {
        _id: '$project',
        total: { $sum: 1 },
        noWebsite: { $sum: { $cond: [{ $in: ['$websiteStatus', NO_SITE] }, 1, 0] } },
        hot: { $sum: { $cond: [{ $eq: ['$leadTemperature', 'HOT'] }, 1, 0] } },
        email: { $sum: { $cond: [{ $and: [{ $ne: ['$email', ''] }, { $ne: ['$email', null] }] }, 1, 0] } },
        reviews: { $sum: { $cond: [{ $gt: ['$reviewsCount', 0] }, 1, 0] } },
        reviewsSum: { $sum: { $ifNull: ['$reviewsCount', 0] } },
        ai: { $sum: { $cond: [{ $gt: ['$aiAt', ''] }, 1, 0] } },
        oppSum: { $sum: { $ifNull: ['$opportunityScore', 0] } },
      } },
    ]),
  ]);
  const counts: Record<string, any> = {};
  for (const a of agg) counts[a._id] = a;
  const out = (projects as any[]).map((p) => {
    const c = counts[p.query] || { total: 0, noWebsite: 0, hot: 0, email: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };
    return { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || null, total: c.total, noWebsite: c.noWebsite, hot: c.hot, email: c.email, reviews: c.reviews || 0, reviewsSum: c.reviewsSum || 0, ai: c.ai || 0, oppSum: c.oppSum };
  });
  return json(out);
}

// Rename / move — single or bulk: { query?, queries?, name?, folderId? (null = root) }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  const queries: string[] = b.queries || (b.query ? [b.query] : []);
  const set: Record<string, unknown> = {};
  if (typeof b.name === 'string') set.name = b.name;
  if (b.folderId !== undefined) set.folderId = b.folderId || null;
  if (queries.length && Object.keys(set).length) await Project.updateMany({ query: { $in: queries } }, { $set: set });
  return json({ ok: true });
}

// Delete projects + their leads: { query? | queries? }
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  const queries: string[] = b.queries || (b.query ? [b.query] : []);
  if (queries.length) {
    await Project.deleteMany({ query: { $in: queries } });
    await Lead.deleteMany({ project: { $in: queries } });
  }
  return json({ ok: true });
}
