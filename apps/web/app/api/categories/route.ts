import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/categories?project=&folder=  → distinct categories (with counts) in scope
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';

    const match: Record<string, unknown> = {};
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }

    const rows = await Lead.aggregate([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).allowDiskUse(true);

    const categories = (rows as { _id: string | null; count: number }[])
      .filter((r) => r._id) // drop empty/null category
      .map((r) => ({ category: r._id as string, count: r.count }));
    return json({ categories });
  } catch (e: any) {
    return json({ categories: [], error: e?.message || 'categories query failed' }, { status: 500 });
  }
}
