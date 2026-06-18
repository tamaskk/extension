import { dbConnect } from '@/lib/db';
import { Folder, Project, Lead, CORS, json, descendantFolderIds } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 300; // big exports can take a while
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Build a portable bundle for a scope: { queries? } | { folderId? } | {} (all).
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  let queries: string[] | undefined = b.queries;
  if (b.folderId) {
    const ids = await descendantFolderIds(b.folderId); // include nested sub-folders
    queries = (await Project.find({ folderId: { $in: ids } }).lean()).map((p: any) => p.query);
  }

  const projDocs = (queries
    ? await Project.find({ query: { $in: queries } }).lean()
    : await Project.find().lean()) as any[];

  // Seed the output with each project (empty records), then fill from ONE lead
  // query streamed via a cursor — avoids one round-trip per project (which 504'd
  // on large scopes) and keeps peak memory bounded.
  const outProjects: Record<string, { query: string; name: string; createdAt: string; folderId?: string; records: Record<string, unknown> }> = {};
  const folderIds = new Set<string>();
  for (const p of projDocs) {
    outProjects[p.query] = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || undefined, records: {} };
    if (p.folderId) folderIds.add(p.folderId);
  }
  if (b.folderId) folderIds.add(b.folderId);

  const projectSet = projDocs.map((p) => p.query);
  if (projectSet.length) {
    const cursor = Lead.find({ project: { $in: projectSet } }).lean().cursor();
    for (let l = await cursor.next(); l != null; l = await cursor.next()) {
      const bucket = outProjects[(l as any).project];
      if (!bucket) continue;
      const { _id, ...r } = l as any;
      bucket.records[(l as any).dedupKey] = r;
    }
  }

  // also carry every ancestor folder so the nested hierarchy round-trips
  const folders = await Folder.find().lean() as any[];
  const byId: Record<string, any> = {}; folders.forEach((f) => { byId[f.folderId] = f; });
  for (const id of [...folderIds]) { let cur = byId[id]; while (cur && cur.parentId) { folderIds.add(cur.parentId); cur = byId[cur.parentId]; } }

  const outFolders: Record<string, unknown> = {};
  for (const f of folders) if (folderIds.has(f.folderId)) outFolders[f.folderId] = { id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: f.collapsed, parentId: f.parentId || null, icon: f.icon || '' };

  return json({ gridleads: 1, exportedAt: new Date().toISOString(), folders: outFolders, projects: outProjects });
}
