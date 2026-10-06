import { dbConnect } from '@/lib/db';
import { Project, CORS, json, descendantFolderIds } from '@/lib/models';
import { parseProject } from '@/lib/projectFacets';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/projectfacets?project=&folder= → { types:[{value,count}], regions:[{value,count}] }
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const folder = u.get('folder') || '';
    const project = u.get('project') || '';
    let q: Record<string, unknown> = {};
    if (folder) { const ids = await descendantFolderIds(folder); q = { folderId: { $in: ids } }; }
    else if (project) { q = { query: project }; }
    const projs = await Project.find(q).select('query -_id').lean() as { query: string }[];
    const types = new Map<string, number>(); const regions = new Map<string, number>();
    for (const p of projs) {
      const r = parseProject(p.query); if (!r) continue;
      if (r.type) types.set(r.type, (types.get(r.type) || 0) + 1);
      if (r.region) regions.set(r.region, (regions.get(r.region) || 0) + 1);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
    return json({ types: sort(types), regions: sort(regions) });
  } catch (e: any) {
    return json({ types: [], regions: [], error: e?.message || 'facets failed' }, { status: 500 });
  }
}
