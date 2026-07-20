import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds, NO_SITE } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/stats?folder=&project=&granularity=day|hour
//   day  → buckets keyed by YYYY-MM-DD
//   hour → buckets keyed by "HH" (00..23, hour-of-day in UTC, summed over the range)
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const folder = u.get('folder') || '';
    const project = u.get('project') || '';
    const gran = u.get('granularity') === 'hour' ? 'hour' : 'day';

    // scope filter (folder → its projects incl. sub-folders, or a single project)
    const scope: Record<string, unknown> = {};
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      scope.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      scope.project = project;
    }

    const idExpr = gran === 'hour' ? { $substrBytes: ['$scrapedAt', 0, 13] } : { $substrBytes: ['$scrapedAt', 0, 10] };
    const [rows, metricAgg] = await Promise.all([
      Lead.aggregate([
        { $match: { ...scope, scrapedAt: { $nin: [null, ''] } } },
        { $group: { _id: idExpr, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).allowDiskUse(true),
      // same breakdown as the widget cards, for this scope
      Lead.aggregate([
        { $match: scope },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          noWebsite: { $sum: { $cond: [{ $in: ['$websiteStatus', NO_SITE] }, 1, 0] } },
          hot: { $sum: { $cond: [{ $eq: ['$leadTemperature', 'HOT'] }, 1, 0] } },
          email: { $sum: { $cond: [{ $and: [{ $ne: ['$email', ''] }, { $ne: ['$email', null] }] }, 1, 0] } },
          reviews: { $sum: { $cond: [{ $gt: ['$reviewsCount', 0] }, 1, 0] } },
          reviewsSum: { $sum: { $ifNull: ['$reviewsCount', 0] } },
          ai: { $sum: { $cond: [{ $gt: ['$aiAt', ''] }, 1, 0] } },
          oppSum: { $sum: { $ifNull: ['$opportunityScore', 0] } },
        } },
      ]).allowDiskUse(true),
    ]);

    const valid = gran === 'hour' ? /^\d{4}-\d{2}-\d{2}T\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
    const buckets = (rows as { _id: string; count: number }[])
      .filter((r) => r._id && valid.test(r._id))
      .map((r) => ({ key: r._id, count: r.count }));
    const total = buckets.reduce((s, b) => s + b.count, 0);
    const m = (metricAgg as any[])[0] || {};
    const metrics = {
      total: m.total || 0, noWebsite: m.noWebsite || 0, hot: m.hot || 0, email: m.email || 0,
      reviews: m.reviews || 0, reviewsSum: m.reviewsSum || 0, ai: m.ai || 0,
      avgOpp: m.total ? Math.round((m.oppSum || 0) / m.total) : 0,
    };
    return json({ buckets, gran, total, metrics });
  } catch (e: any) {
    return json({ buckets: [], total: 0, error: e?.message || 'stats failed' }, { status: 500 });
  }
}
