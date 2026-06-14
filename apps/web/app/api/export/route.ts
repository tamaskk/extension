import { dbConnect } from '@/lib/db';
import { Folder, Project, Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Build a portable bundle for a scope: { queries? } | { folderId? } | {} (all).
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  let queries: string[] | undefined = b.queries;
  if (b.folderId) queries = (await Project.find({ folderId: b.folderId }).lean()).map((p: any) => p.query);

  const projDocs = queries
    ? await Project.find({ query: { $in: queries } }).lean()
    : await Project.find().lean();

  const outProjects: Record<string, unknown> = {};
  const folderIds = new Set<string>();
  for (const p of projDocs as any[]) {
    const leads = await Lead.find({ project: p.query }).lean();
    const records: Record<string, unknown> = {};
    for (const l of leads as any[]) { const { _id, ...r } = l; records[l.dedupKey] = r; }
    outProjects[p.query] = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || undefined, records };
    if (p.folderId) folderIds.add(p.folderId);
  }
  if (b.folderId) folderIds.add(b.folderId);

  const outFolders: Record<string, unknown> = {};
  const folders = await Folder.find().lean();
  for (const f of folders as any[]) if (folderIds.has(f.folderId)) outFolders[f.folderId] = { id: f.folderId, name: f.name, createdAt: f.createdAt, collapsed: f.collapsed };

  return json({ gridleads: 1, exportedAt: new Date().toISOString(), folders: outFolders, projects: outProjects });
}
