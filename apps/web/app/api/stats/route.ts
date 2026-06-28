import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/stats?folder=&project=  → leads scraped per day { days:[{date,count}], total }
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const folder = u.get('folder') || '';
    const project = u.get('project') || '';

    const match: Record<string, unknown> = { scrapedAt: { $nin: [null, ''] } };
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }

    const rows = await Lead.aggregate([
      { $match: match },
      { $group: { _id: { $substrBytes: ['$scrapedAt', 0, 10] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).allowDiskUse(true);

    const days = (rows as { _id: string; count: number }[])
      .filter((r) => r._id && /^\d{4}-\d{2}-\d{2}$/.test(r._id))
      .map((r) => ({ date: r._id, count: r.count }));
    const total = days.reduce((s, d) => s + d.count, 0);
    return json({ days, total });
  } catch (e: any) {
    return json({ days: [], total: 0, error: e?.message || 'stats failed' }, { status: 500 });
  }
}
