import { dbConnect } from '@/lib/db';
import { Lead, Project, NO_SITE, CORS, json, descendantFolderIds } from '@/lib/models';
import { applyProjectScope } from '@/lib/projectScope';
import { applySearch } from '@/lib/searchIndex';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const CAP = 200000; // max markers plotted

// GET /api/geo?project=&folder=&filter=&search=&ptype=&pregion=&country=
//   → { cols, points: [[lat, lng, noSite, dedupKey]], total, capped }
// `total` is the number of points sent; `capped` says more exist than the cap.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';
    const filter = u.get('filter') || 'all';
    const search = (u.get('search') || '').trim();

    // Number ranges, not `$ne: null`: a null test makes MongoDB read the document,
    // and then the gl_geo index could not answer the query on its own.
    const match: Record<string, unknown> = { lat: { $gte: -90, $lte: 90 }, lng: { $gte: -180, $lte: 180 } };
    if (folder) {
      const ids = await descendantFolderIds(folder); // include nested sub-folders
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }
    const cats = u.getAll('cat').filter(Boolean);
    if (cats.length) match.category = { $in: cats };
    // exact project-name lists instead of a pattern over 1.6M leads (see lib/projectScope.ts)
    await applyProjectScope(match, u.getAll('ptype').filter(Boolean), u.getAll('pregion').filter(Boolean), u.get('country') || '');
    if (filter === 'nowebsite') match.websiteStatus = { $in: NO_SITE };
    else if (filter === 'haswebsite') match.websiteStatus = 'HAS_WEBSITE';
    else if (filter === 'hot') match.leadTemperature = 'HOT';
    else if (filter === 'email') match.email = { $nin: ['', null] };
    await applySearch(match, search);

    // A marker only needs a position, a colour and a key. The popup's fields are
    // fetched when a marker is clicked (GET /api/leads?key=): sending all twelve
    // fields for every point was 359 bytes each, 72 MB for a full map.
    // One read, no count: counting walked the same documents a second time. One
    // row past the cap tells whether there is more; the exact total is only
    // known when everything fits.
    const docs = await Lead.find(match).select('lat lng websiteStatus dedupKey -_id').limit(CAP + 1).lean() as { lat: number; lng: number; websiteStatus?: string; dedupKey: string }[];
    const capped = docs.length > CAP;
    if (capped) docs.length = CAP;
    const noSite = new Set<string>(NO_SITE);
    const r5 = (n: number) => Math.round(n * 1e5) / 1e5; // ~1 m
    const points = docs.filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number')
      .map((d) => [r5(d.lat), r5(d.lng), noSite.has(d.websiteStatus || '') ? 1 : 0, d.dedupKey]);
    return json({ cols: ['lat', 'lng', 'noSite', 'key'], points, total: points.length, capped });
  } catch (e: any) {
    return json({ points: [], total: 0, capped: false, error: e?.message || 'geo query failed' }, { status: 500 });
  }
}
