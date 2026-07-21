import { randomUUID } from 'crypto';
import { dbConnect } from '@/lib/db';
import { Lead, LeadGroup, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/groups                     → list of groups with member counts
// GET /api/groups?id=&page=&pageSize= → one group's leads, paged in saved order
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const id = u.get('id') || '';
    if (!id) {
      const groups = await LeadGroup.aggregate([
        { $project: { _id: 0, groupId: 1, name: 1, createdAt: 1, count: { $size: '$keys' } } },
        { $sort: { createdAt: -1 } },
      ]);
      return json({ ok: true, groups });
    }
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(u.get('pageSize') || '100', 10) || 100));
    const g = await LeadGroup.findOne({ groupId: id }).lean() as { name?: string; keys?: string[] } | null;
    if (!g) return json({ ok: false, error: 'group not found' }, { status: 404 });
    const keys = g.keys || [];
    const pageKeys = keys.slice((page - 1) * pageSize, page * pageSize);
    const docs = await Lead.find({ dedupKey: { $in: pageKeys } }).lean();
    // keep the saved member order (an $in fetch returns arbitrary order)
    const byKey = new Map((docs as any[]).map(({ _id, ...r }) => [r.dedupKey, r]));
    const rows = pageKeys.map((k) => byKey.get(k)).filter(Boolean);
    return json({ ok: true, name: g.name, rows, total: keys.length });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'groups failed' }, { status: 500 });
  }
}

// POST { name, keys?: string[], fromChecked?: true } → create a group
//   fromChecked → members are all currently-checked leads
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const name = String(b?.name || '').trim();
    if (!name) return json({ ok: false, error: 'name required' }, { status: 400 });
    let keys: string[] = Array.isArray(b?.keys) ? b.keys.map((k: unknown) => String(k)).filter(Boolean) : [];
    if (b?.fromChecked) keys = (await Lead.distinct('dedupKey', { checked: true })) as string[];
    keys = [...new Set(keys)];
    if (!keys.length) return json({ ok: false, error: 'no leads selected' }, { status: 400 });
    const groupId = randomUUID();
    await LeadGroup.create({ groupId, name, createdAt: new Date().toISOString(), keys });
    return json({ ok: true, groupId, count: keys.length });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'create failed' }, { status: 500 });
  }
}

// PATCH { id, name?, add?: string[], remove?: string[] } → rename / edit members
export async function PATCH(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const id = String(b?.id || '');
    if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
    const upd: Record<string, unknown> = {};
    if (typeof b?.name === 'string' && b.name.trim()) upd.$set = { name: b.name.trim() };
    if (Array.isArray(b?.add) && b.add.length) upd.$addToSet = { keys: { $each: b.add.map(String) } };
    if (Array.isArray(b?.remove) && b.remove.length) upd.$pull = { keys: { $in: b.remove.map(String) } };
    if (Object.keys(upd).length) await LeadGroup.updateOne({ groupId: id }, upd);
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'update failed' }, { status: 500 });
  }
}

// DELETE { id } → delete the group (leads themselves are untouched)
export async function DELETE(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    if (b?.id) await LeadGroup.deleteOne({ groupId: String(b.id) });
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'delete failed' }, { status: 500 });
  }
}
