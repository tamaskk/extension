import { dbConnect } from '@/lib/db';
import { Lead, Project, ProjectStat, CORS, json, descendantFolderIds } from '@/lib/models';
import { cachedData } from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const BUCKET_TTL_MS = 10 * 60_000;

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

    // Buckets: a $group over the leads in scope. For "all leads" that is the whole
    // collection (3 s+), so it is cached for 10 minutes and refreshed after the
    // response; a folder or project scope is narrowed by the project index and runs live.
    const idExpr = gran === 'hour' ? { $substrBytes: ['$scrapedAt', 0, 13] } : { $substrBytes: ['$scrapedAt', 0, 10] };
    const buildBuckets = () => Lead.aggregate([
      { $match: { ...scope, scrapedAt: { $gt: '' } } },
      { $group: { _id: idExpr, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).allowDiskUse(true) as unknown as Promise<{ _id: string; count: number }[]>;
    const scoped = !!(folder || project);
    const [rows, metricAgg] = await Promise.all([
      scoped ? buildBuckets() : cachedData(`stats:${gran}`, BUCKET_TTL_MS, buildBuckets),
      // The same breakdown as the widget cards, from the same precomputed
      // per-project counters they use — not a second pass over the leads.
      ProjectStat.aggregate([
        { $match: scope },
        { $group: {
          _id: null,
          total: { $sum: '$total' }, noWebsite: { $sum: '$noWebsite' }, hot: { $sum: '$hot' }, email: { $sum: '$email' },
          reviews: { $sum: '$reviews' }, reviewsSum: { $sum: '$reviewsSum' }, ai: { $sum: '$ai' }, oppSum: { $sum: '$oppSum' },
        } },
      ]),
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
