import { dbConnect } from '@/lib/db';
import { Folder, Project, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET() {
  await dbConnect();
  const folders = await Folder.find().sort({ order: 1, createdAt: 1 }).lean();
  return json((folders as any[]).map((f) => ({ id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: !!f.collapsed, order: f.order ?? 0, parentId: f.parentId || null, icon: f.icon || '' })));
}

export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const id = b.id || ('f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const order = await Folder.countDocuments(); // new folders go to the end
  await Folder.updateOne({ folderId: id }, { $set: { folderId: id, name: (b.name || 'New folder').trim(), createdAt: b.createdAt || new Date().toISOString(), collapsed: b.collapsed ?? true, order, parentId: b.parentId || null } }, { upsert: true });
  return json({ ok: true, id });
}

// Single edit { id, name?, collapsed?, parentId? } OR reorder { order: [id1, id2, ...] }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  if (Array.isArray(b.order)) {
    const ops = b.order.map((id: string, i: number) => ({ updateOne: { filter: { folderId: id }, update: { $set: { order: i } } } }));
    if (ops.length) await Folder.bulkWrite(ops);
    return json({ ok: true });
  }
  if (Array.isArray(b.ids)) { // bulk edit: move into a parent and/or set an icon
    const bset: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(b, 'parentId')) bset.parentId = b.parentId || null;
    if (typeof b.icon === 'string') bset.icon = b.icon;
    if (Object.keys(bset).length) await Folder.updateMany({ folderId: { $in: b.ids } }, { $set: bset });
    return json({ ok: true });
  }
  const set: Record<string, unknown> = {};
  if (typeof b.name === 'string') set.name = b.name;
  if (typeof b.collapsed === 'boolean') set.collapsed = b.collapsed;
  if (Object.prototype.hasOwnProperty.call(b, 'parentId')) set.parentId = b.parentId || null;
  if (typeof b.icon === 'string') set.icon = b.icon;
  if (Object.keys(set).length) await Folder.updateOne({ folderId: b.id }, { $set: set });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  // move this folder's sub-folders up to its parent, and its projects to ungrouped
  const folder = await Folder.findOne({ folderId: b.id }).select('parentId').lean() as { parentId?: string | null } | null;
  const newParent = folder?.parentId || null;
  await Folder.updateMany({ parentId: b.id }, { $set: { parentId: newParent } });
  await Folder.deleteOne({ folderId: b.id });
  await Project.updateMany({ folderId: b.id }, { $set: { folderId: null } });
  return json({ ok: true });
}
