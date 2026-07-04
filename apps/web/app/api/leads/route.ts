import { dbConnect } from '@/lib/db';
import { Lead, Project, NO_SITE, CORS, json, descendantFolderIds, applyProjectFacets } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Map a dashboard sort key → a real document field. leadTemperature is derived
// from leadScore (COLD<40<WARM<70<HOT), so sorting by leadScore matches it.
function sortField(key: string): string {
  if (key === 'leadTemperature') return 'opportunityScore'; // temperature now follows opportunity
  return key; // name, category, address, websiteStatus, rating, reviewCount, opportunityScore, leadScore, checked, phone, email
}

// GET /api/leads?project=&folder=&filter=&search=&sort=&dir=&page=&pageSize=
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    if (u.get('countChecked')) return json({ total: await Lead.countDocuments({ checked: true }) });
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';
    const filter = u.get('filter') || 'all';
    const search = (u.get('search') || '').trim();
    const sort = u.get('sort') || 'opportunityScore';
    const dir = (parseInt(u.get('dir') || '-1', 10) === 1 ? 1 : -1) as 1 | -1;
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(u.get('pageSize') || '50', 10) || 50));

    const match: Record<string, unknown> = {};
    if (folder) {
      const ids = await descendantFolderIds(folder); // include nested sub-folders
      const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }
    if (filter === 'nowebsite') match.websiteStatus = { $in: NO_SITE };
    else if (filter === 'haswebsite') match.websiteStatus = 'HAS_WEBSITE';
    else if (filter === 'hot') match.leadTemperature = 'HOT';
    else if (filter === 'email') match.email = { $nin: ['', null] };
    else if (filter === 'hasreviews') match.reviewsCount = { $gt: 0 };
    else if (filter === 'hasai') match.aiAt = { $gt: '' };
    const cats = u.getAll('cat').filter(Boolean);
    if (cats.length) match.category = { $in: cats };
    applyProjectFacets(match, u.getAll('ptype').filter(Boolean), u.getAll('pregion').filter(Boolean));
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      match.$or = [{ name: rx }, { category: rx }, { address: rx }, { phone: rx }, { email: rx }];
    }

    const field = sortField(sort);
    const [docs, total] = await Promise.all([
      Lead.find(match).sort({ [field]: dir, _id: 1 }).allowDiskUse(true).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Lead.countDocuments(match),
    ]);
    const rows = (docs as Record<string, unknown>[]).map(({ _id, ...r }) => r);
    return json({ rows, total });
  } catch (e: any) {
    return json({ rows: [], total: 0, error: e?.message || 'leads query failed' }, { status: 500 });
  }
}

// Add a single lead (one-by-one from the extension): { project:{query,name}, lead }
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const proj = b.project; const lead = b.lead;
  if (!proj?.query || !lead?.dedupKey) return json({ ok: false, error: 'project.query and lead.dedupKey required' }, { status: 400 });
  const existing = await Lead.findOne({ dedupKey: lead.dedupKey }).select('project').lean() as { project?: string } | null;
  if (existing && existing.project !== proj.query) return json({ ok: true, skippedDuplicate: true, existingProject: existing.project });
  await Project.updateOne({ query: proj.query }, { $set: { query: proj.query, name: proj.name || proj.query, createdAt: proj.createdAt || new Date().toISOString() } }, { upsert: true });
  const { _id, ...rest } = lead;
  await Lead.updateOne({ project: proj.query, dedupKey: lead.dedupKey }, { $set: { ...rest, project: proj.query, dedupKey: lead.dedupKey } }, { upsert: true });
  return json({ ok: true });
}

// Update a lead: { project, dedupKey, checked?, tags?, websiteStatus?, opportunityScore? }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  if (b.uncheckAll) { const r = await Lead.updateMany({ checked: true }, { $set: { checked: false } }); return json({ ok: true, updated: r.modifiedCount || 0 }); }
  const set: Record<string, unknown> = {};
  if ('checked' in b) set.checked = !!b.checked;
  if ('call' in b) set.call = !!b.call;
  if ('tags' in b && Array.isArray(b.tags)) set.tags = b.tags.map((t: unknown) => String(t));
  if (typeof b.websiteStatus === 'string' && b.websiteStatus) set.websiteStatus = b.websiteStatus;
  if (b.opportunityScore != null && b.opportunityScore !== '' && !isNaN(Number(b.opportunityScore))) {
    const v = Math.max(0, Math.min(100, Math.round(Number(b.opportunityScore))));
    set.opportunityScore = v;
    set.leadTemperature = v >= 70 ? 'HOT' : v >= 40 ? 'WARM' : 'COLD'; // temperature follows opportunity
  }
  // generic single-field edit { field, value } from the detail modal
  if (typeof b.field === 'string') {
    const f = b.field; const val = b.value;
    const STR = new Set(['name', 'category', 'phone', 'email', 'website', 'address', 'mapsUrl', 'topPitch', 'placeId', 'cid', 'salesStatus', 'salesDate']);
    const NUM = new Set(['rating', 'reviewCount', 'lat', 'lng', 'leadScore']);
    const WS = new Set(['HAS_WEBSITE', 'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION', 'NOT_WORKING', 'REDIRECTS']);
    const TEMP = new Set(['COLD', 'WARM', 'HOT']);
    if (STR.has(f)) set[f] = val == null ? '' : String(val);
    else if (NUM.has(f)) set[f] = (val === '' || val == null) ? null : (isNaN(Number(val)) ? undefined : Number(val));
    else if (f === 'websiteStatus' && WS.has(val)) set.websiteStatus = val;
    else if (f === 'leadTemperature' && TEMP.has(val)) set.leadTemperature = val;
    else if (f === 'checked') set.checked = !!val;
    else if (f === 'opportunityScore') { const v = Math.max(0, Math.min(100, Math.round(Number(val) || 0))); set.opportunityScore = v; set.leadTemperature = v >= 70 ? 'HOT' : v >= 40 ? 'WARM' : 'COLD'; }
    if (set[f] === undefined) delete set[f];
  }
  if (Object.keys(set).length) await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: set });
  return json({ ok: true });
}

// Delete leads: { items: [{ query, key }] } OR { allChecked: true } (every checked lead)
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  if (b.allChecked) { const r = await Lead.deleteMany({ checked: true }); return json({ ok: true, deleted: r.deletedCount || 0 }); }
  const items: { query: string; key: string }[] = b.items || [];
  if (items.length) await Lead.bulkWrite(items.map((it) => ({ deleteOne: { filter: { project: it.query, dedupKey: it.key } } })), { ordered: false });
  return json({ ok: true });
}
