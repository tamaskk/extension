import { dbConnect } from '@/lib/db';
import { Lead, Project, NO_SITE, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Map the dashboard sort key → a Mongo sort spec (using computed helper fields).
function sortSpec(sortKey: string, dir: 1 | -1): Record<string, 1 | -1> {
  switch (sortKey) {
    case 'leadTemperature': return { _tempOrder: dir };
    case 'phone': return { _hasPhone: dir, phone: dir };
    case 'email': return { _hasEmail: dir, email: dir };
    case 'checked': return { _hasChecked: dir };
    case 'name': case 'category': case 'address': case 'websiteStatus':
      return { [sortKey]: dir };
    default: return { [sortKey]: dir }; // numeric: rating, reviewCount, opportunityScore, leadScore
  }
}

// GET /api/leads?project=&filter=&search=&sort=&dir=&page=&pageSize=
export async function GET(req: Request) {
  await dbConnect();
  const u = new URL(req.url).searchParams;
  const project = u.get('project') || '';
  const filter = u.get('filter') || 'all';
  const search = (u.get('search') || '').trim();
  const sort = u.get('sort') || 'opportunityScore';
  const dir = (parseInt(u.get('dir') || '-1', 10) === 1 ? 1 : -1) as 1 | -1;
  const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
  const pageSize = Math.min(2000, Math.max(1, parseInt(u.get('pageSize') || '50', 10) || 50));

  const match: Record<string, unknown> = {};
  if (project) match.project = project;
  if (filter === 'nowebsite') match.websiteStatus = { $in: NO_SITE };
  else if (filter === 'haswebsite') match.websiteStatus = 'HAS_WEBSITE';
  else if (filter === 'hot') match.leadTemperature = 'HOT';
  else if (filter === 'email') match.email = { $nin: ['', null] };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    match.$or = [{ name: rx }, { category: rx }, { address: rx }, { phone: rx }, { email: rx }];
  }

  const pipeline: any[] = [
    { $match: match },
    { $addFields: {
      _tempOrder: { $switch: { branches: [
        { case: { $eq: ['$leadTemperature', 'HOT'] }, then: 2 },
        { case: { $eq: ['$leadTemperature', 'WARM'] }, then: 1 },
      ], default: 0 } },
      _hasPhone: { $cond: [{ $and: [{ $ne: ['$phone', ''] }, { $ne: ['$phone', null] }] }, 1, 0] },
      _hasEmail: { $cond: [{ $and: [{ $ne: ['$email', ''] }, { $ne: ['$email', null] }] }, 1, 0] },
      _hasChecked: { $cond: ['$checked', 1, 0] },
    } },
    { $sort: sortSpec(sort, dir) },
    { $facet: {
      rows: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      total: [{ $count: 'n' }],
    } },
  ];

  const res = await Lead.aggregate(pipeline);
  const facet = res[0] || { rows: [], total: [] };
  const rows = (facet.rows as Record<string, unknown>[]).map((d) => {
    const { _id, _tempOrder, _hasPhone, _hasEmail, _hasChecked, ...rest } = d;
    return rest;
  });
  const total = facet.total[0]?.n || 0;
  return json({ rows, total });
}

// Add a single lead (one-by-one from the extension): { project:{query,name}, lead }
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const proj = b.project; const lead = b.lead;
  if (!proj?.query || !lead?.dedupKey) return json({ ok: false, error: 'project.query and lead.dedupKey required' }, { status: 400 });
  // cross-project dedup: skip if this business already exists in another project
  const existing = await Lead.findOne({ dedupKey: lead.dedupKey }).select('project').lean() as { project?: string } | null;
  if (existing && existing.project !== proj.query) return json({ ok: true, skippedDuplicate: true, existingProject: existing.project });
  await Project.updateOne({ query: proj.query }, { $set: { query: proj.query, name: proj.name || proj.query, createdAt: proj.createdAt || new Date().toISOString() } }, { upsert: true });
  const { _id, ...rest } = lead;
  await Lead.updateOne({ project: proj.query, dedupKey: lead.dedupKey }, { $set: { ...rest, project: proj.query, dedupKey: lead.dedupKey } }, { upsert: true });
  return json({ ok: true });
}

// Update "checked": { project, dedupKey, checked }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: { checked: !!b.checked } });
  return json({ ok: true });
}

// Delete leads: { items: [{ query, key }] }
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  const items: { query: string; key: string }[] = b.items || [];
  if (items.length) await Lead.bulkWrite(items.map((it) => ({ deleteOne: { filter: { project: it.query, dedupKey: it.key } } })), { ordered: false });
  return json({ ok: true });
}
