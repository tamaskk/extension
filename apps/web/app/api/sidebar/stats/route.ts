import { dbConnect } from '@/lib/db';
import { Project, ProjectStat, CORS, json, descendantFolderIds } from '@/lib/models';
import { applyProjectScope } from '@/lib/projectScope';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/sidebar/stats?folder=&project=&ptype=&pregion=&country=
//   → { ok, stats } — the stat tiles for a scope, summed from the per-project
//   counters (the same numbers the tiles always showed, without the project list
//   in the browser).
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const folder = String(u.get('folder') || '');
    const project = String(u.get('project') || '');
    const match: Record<string, unknown> = {};
    if (folder) {
      const ids = await descendantFolderIds(folder); // include nested sub-folders
      const projs = await Project.find({ folderId: { $in: ids } }).select('query -_id').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }
    await applyProjectScope(match, u.getAll('ptype').filter(Boolean), u.getAll('pregion').filter(Boolean), String(u.get('country') || ''));
    const [s] = await ProjectStat.aggregate([
      { $match: match },
      { $group: {
        _id: null, projects: { $sum: 1 },
        total: { $sum: '$total' }, noWebsite: { $sum: '$noWebsite' }, hot: { $sum: '$hot' }, email: { $sum: '$email' },
        emailMiss: { $sum: '$emailMiss' }, emailTodo: { $sum: { $ifNull: ['$emailTodo', 0] } },
        reviews: { $sum: '$reviews' }, reviewsSum: { $sum: '$reviewsSum' }, ai: { $sum: '$ai' }, oppSum: { $sum: '$oppSum' },
      } },
    ]);
    const { _id, ...stats } = s || { _id: null, projects: 0, total: 0, noWebsite: 0, hot: 0, email: 0, emailMiss: 0, emailTodo: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };
    return json({ ok: true, stats });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'stats failed' }, { status: 500 });
  }
}
