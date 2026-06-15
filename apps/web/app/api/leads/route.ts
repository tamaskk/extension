import { dbConnect } from '@/lib/db';
import { Lead, Project, NO_SITE, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Map a dashboard sort key → a real document field. leadTemperature is derived
// from leadScore (COLD<40<WARM<70<HOT), so sorting by leadScore matches it.
function sortField(key: string): string {
  if (key === 'leadTemperature') return 'leadScore';
  return key; // name, category, address, websiteStatus, rating, reviewCount, opportunityScore, leadScore, checked, phone, email
}

// GET /api/leads?project=&folder=&filter=&search=&sort=&dir=&page=&pageSize=
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
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

// Update a lead: { project, dedupKey, checked?, tags? }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  const set: Record<string, unknown> = {};
  if ('checked' in b) set.checked = !!b.checked;
  if ('tags' in b && Array.isArray(b.tags)) set.tags = b.tags.map((t: unknown) => String(t));
  if (Object.keys(set).length) await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: set });
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
