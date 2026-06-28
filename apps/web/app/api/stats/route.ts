import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds } from '@/lib/models';

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

    const match: Record<string, unknown> = { scrapedAt: { $nin: [null, ''] } };
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }

    const idExpr = gran === 'hour' ? { $substrBytes: ['$scrapedAt', 11, 2] } : { $substrBytes: ['$scrapedAt', 0, 10] };
    const rows = await Lead.aggregate([
      { $match: match },
      { $group: { _id: idExpr, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).allowDiskUse(true);

    const valid = gran === 'hour' ? /^\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
    const buckets = (rows as { _id: string; count: number }[])
      .filter((r) => r._id && valid.test(r._id))
      .map((r) => ({ key: r._id, count: r.count }));
    const total = buckets.reduce((s, b) => s + b.count, 0);
    return json({ buckets, gran, total });
  } catch (e: any) {
    return json({ buckets: [], total: 0, error: e?.message || 'stats failed' }, { status: 500 });
  }
}
