import { dbConnect } from '@/lib/db';
import { Project, CORS, json, descendantFolderIds } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// region names that are more than one word (so the suffix is detected correctly)
const MULTI = ['New York', 'New Jersey', 'New Mexico', 'New Hampshire', 'North Carolina', 'North Dakota', 'South Carolina', 'South Dakota', 'Rhode Island', 'West Virginia', 'District of Columbia', 'Hong Kong', 'Costa Rica', 'Puerto Rico', 'New Orleans'];
const MULTI_LC = MULTI.map((m) => m.toLowerCase());

// project query = "<business type> near <city...> <state/country>"
export function parseProject(q: string): { type: string; region: string } | null {
  const s = String(q || '').trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  let type: string;
  const ni = lc.indexOf(' near ');
  if (ni >= 0) type = s.slice(0, ni + 5); // "<type...> near"
  else type = s.split(/\s+/).slice(0, 2).join(' ');
  let region = '';
  for (let i = 0; i < MULTI_LC.length; i++) { if (lc === MULTI_LC[i] || lc.endsWith(' ' + MULTI_LC[i])) { region = MULTI[i]; break; } }
  if (!region) { const w = s.split(/\s+/); region = w[w.length - 1]; }
  return { type: type.trim(), region: region.trim() };
}

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
