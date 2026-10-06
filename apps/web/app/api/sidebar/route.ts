import { createHash } from 'crypto';
import { dbConnect } from '@/lib/db';
import { Folder, CORS, json } from '@/lib/models';
import { getSidebarAggregates } from '@/lib/sidebar';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/sidebar → everything the sidebar shows before a folder is opened:
//   { ok, folders: [{ id, name, …, own }], ungrouped, all, facets }
// Folders are read live (a rename or move shows at once); the per-folder sums
// come from the cache. ETag'd so an unchanged sidebar is a body-less 304.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const [docs, agg] = await Promise.all([
      Folder.find().sort({ order: 1, createdAt: 1 }).lean() as Promise<Record<string, any>[]>,
      getSidebarAggregates(),
    ]);
    const folders = docs.map((f) => ({
      id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: !!f.collapsed, order: f.order ?? 0, parentId: f.parentId || null, icon: f.icon || '',
      own: agg.folders[f.folderId] || null, // null: no projects directly in it
      missing: agg.missing?.[f.folderId] ?? null, // accurate coverage gap, where the folder has a reference list
    }));
    const body = JSON.stringify({ ok: true, folders, ungrouped: agg.ungrouped, all: agg.all, facets: agg.facets });
    const etag = `"s${createHash('sha1').update(body).digest('base64url')}"`;
    const headers = { ...CORS, ETag: etag, 'Cache-Control': 'private, no-cache' };
    const inm = (req.headers.get('if-none-match') || '').replace(/^W\//, '');
    if (inm === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'sidebar failed' }, { status: 500 });
  }
}
