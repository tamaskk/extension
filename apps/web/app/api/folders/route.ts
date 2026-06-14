import { dbConnect } from '@/lib/db';
import { Folder, Project, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET() {
  await dbConnect();
  const folders = await Folder.find().lean();
  return json(folders.map((f: any) => ({ id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: !!f.collapsed })));
}

export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const id = b.id || ('f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  await Folder.updateOne({ folderId: id }, { $set: { folderId: id, name: (b.name || 'New folder').trim(), createdAt: b.createdAt || new Date().toISOString(), collapsed: b.collapsed ?? true } }, { upsert: true });
  return json({ ok: true, id });
}

export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  const set: Record<string, unknown> = {};
  if (typeof b.name === 'string') set.name = b.name;
  if (typeof b.collapsed === 'boolean') set.collapsed = b.collapsed;
  if (Object.keys(set).length) await Folder.updateOne({ folderId: b.id }, { $set: set });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  await Folder.deleteOne({ folderId: b.id });
  await Project.updateMany({ folderId: b.id }, { $set: { folderId: null } }); // projects fall back to ungrouped
  return json({ ok: true });
}
