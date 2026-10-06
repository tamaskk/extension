import { createHash } from 'crypto';
import { dbConnect } from '@/lib/db';
import { Folder, Project, CORS, json } from '@/lib/models';
import { invalidateProjectsCache } from '@/lib/projectStats';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Bare array on success (the store depends on it). ETag'd like /api/projects:
// the store shows the browser's cached copy first and revalidates, and an
// unchanged folder list comes back as a body-less 304.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const folders = await Folder.find().sort({ order: 1, createdAt: 1 }).lean();
    const body = JSON.stringify((folders as any[]).map((f) => ({ id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: !!f.collapsed, order: f.order ?? 0, parentId: f.parentId || null, icon: f.icon || '' })));
    const etag = `"f${createHash('sha1').update(body).digest('base64url')}"`;
    const headers = { ...CORS, ETag: etag, 'Cache-Control': 'private, no-cache' };
    const inm = (req.headers.get('if-none-match') || '').replace(/^W\//, '');
    if (inm === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'folders query failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const id = b.id || ('f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const order = await Folder.countDocuments(); // new folders go to the end
    await Folder.updateOne({ folderId: id }, { $set: { folderId: id, name: (b.name || 'New folder').trim(), createdAt: b.createdAt || new Date().toISOString(), collapsed: b.collapsed ?? true, order, parentId: b.parentId || null } }, { upsert: true });
    await logActivity({ type: 'folder.create', n: 1, title: `Folder created: ${(b.name || 'New folder').trim()}`, data: { id, parentId: b.parentId || null } });
    return json({ ok: true, id });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'folder create failed' }, { status: 500 });
  }
}

// Single edit { id, name?, collapsed?, parentId? } OR reorder { order: [id1, id2, ...] }
export async function PATCH(req: Request) {
  try {
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
      if (Object.keys(bset).length) {
        const prev = await Folder.find({ folderId: { $in: [...b.ids, bset.parentId].filter(Boolean) } }).select('folderId name parentId icon -_id').lean() as { folderId: string; name: string }[];
        await Folder.updateMany({ folderId: { $in: b.ids } }, { $set: bset });
        const nm = (id: unknown) => prev.find((f) => f.folderId === id)?.name || String(id);
        await logActivity({ type: 'folder.edit', n: b.ids.length,
          title: `${b.ids.length} folder(s): ${'parentId' in bset ? `moved to ${bset.parentId ? '📁 ' + nm(bset.parentId) : 'root'}` : ''}${'parentId' in bset && 'icon' in bset ? ', ' : ''}${'icon' in bset ? `icon → ${bset.icon || 'none'}` : ''}`,
          data: { folders: b.ids.map(nm), ...bset } });
      }
      return json({ ok: true });
    }
    const set: Record<string, unknown> = {};
    if (typeof b.name === 'string') set.name = b.name;
    if (typeof b.collapsed === 'boolean') set.collapsed = b.collapsed;
    if (Object.prototype.hasOwnProperty.call(b, 'parentId')) set.parentId = b.parentId || null;
    if (typeof b.icon === 'string') set.icon = b.icon;
    if (Object.keys(set).length) {
      const prev = await Folder.findOne({ folderId: b.id }).select('name parentId icon -_id').lean() as Record<string, unknown> | null;
      await Folder.updateOne({ folderId: b.id }, { $set: set });
      // open/close is view state, not a change worth recording
      const fields = Object.keys(set).filter((f) => f !== 'collapsed' && prev && JSON.stringify(prev[f] ?? null) !== JSON.stringify(set[f] ?? null));
      if (prev && fields.length) {
        const parentName = async (id: unknown) => (id ? ((await Folder.findOne({ folderId: id }).select('name -_id').lean()) as { name?: string } | null)?.name || String(id) : 'root');
        const parts: string[] = [];
        if (fields.includes('name')) parts.push(`renamed “${prev.name}” → “${set.name}”`);
        if (fields.includes('parentId')) parts.push(`moved ${await parentName(prev.parentId)} → ${await parentName(set.parentId)}`);
        if (fields.includes('icon')) parts.push(`icon ${prev.icon || 'none'} → ${set.icon || 'none'}`);
        await logActivity({ type: 'folder.edit', n: 1, title: `Folder ${prev.name}: ${parts.join(', ')}`, data: { id: b.id, diff: Object.fromEntries(fields.map((f) => [f, [prev[f] ?? '', set[f] ?? '']])) } });
      }
    }
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'folder update failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    // move this folder's sub-folders up to its parent, and its projects to ungrouped
    const folder = await Folder.findOne({ folderId: b.id }).select('parentId name').lean() as { parentId?: string | null; name?: string } | null;
    const newParent = folder?.parentId || null;
    await Folder.updateMany({ parentId: b.id }, { $set: { parentId: newParent } });
    await Folder.deleteOne({ folderId: b.id });
    const moved = await Project.updateMany({ folderId: b.id }, { $set: { folderId: null } });
    if (folder) await logActivity({ type: 'folder.delete', n: 1, title: `Folder deleted: ${folder.name || b.id} (${moved.modifiedCount || 0} project(s) moved to root, leads kept)`, data: { id: b.id, projectsUngrouped: moved.modifiedCount || 0 } });
    await invalidateProjectsCache(); // projects moved to root → sidebar payload changed
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'folder delete failed' }, { status: 500 });
  }
}
