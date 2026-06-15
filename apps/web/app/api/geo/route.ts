import { dbConnect } from '@/lib/db';
import { Lead, Project, NO_SITE, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const CAP = 200000; // max markers plotted

// GET /api/geo?project=&folder=&filter=&search=  → [{lat,lng,name,websiteStatus}]
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';
    const filter = u.get('filter') || 'all';
    const search = (u.get('search') || '').trim();

    const match: Record<string, unknown> = { lat: { $ne: null }, lng: { $ne: null } };
    if (folder) {
      const projs = await Project.find({ folderId: folder }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }
    if (filter === 'nowebsite') match.websiteStatus = { $in: NO_SITE };
    else if (filter === 'haswebsite') match.websiteStatus = 'HAS_WEBSITE';
    else if (filter === 'hot') match.leadTemperature = 'HOT';
    else if (filter === 'email') match.email = { $nin: ['', null] };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      match.$or = [{ name: rx }, { category: rx }, { address: rx }, { phone: rx }, { email: rx }];
    }

    const total = await Lead.countDocuments(match);
    const docs = await Lead.find(match)
      .select('lat lng name category rating reviewCount phone website websiteStatus mapsUrl opportunityScore leadTemperature -_id')
      .limit(CAP).lean();
    const points = (docs as { lat: number; lng: number }[]).filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number');
    return json({ points, total, capped: total > CAP });
  } catch (e: any) {
    return json({ points: [], total: 0, capped: false, error: e?.message || 'geo query failed' }, { status: 500 });
  }
}
