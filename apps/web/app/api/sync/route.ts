import { dbConnect } from '@/lib/db';
import { Folder, Project, Lead, CORS, json } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

// Upsert a GridLeads bundle { folders, projects(with records) }. Works for any
// scope the extension sends: a single project, a folder's projects, or everything.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    const folders = body?.folders || {};
    const projects = body?.projects || {};

    // folders
    const folderOps = Object.values(folders).map((f: any) => ({
      updateOne: {
        filter: { folderId: f.id },
        update: { $set: { folderId: f.id, name: f.name, createdAt: f.createdAt, collapsed: !!f.collapsed, parentId: f.parentId || null, icon: f.icon || '' } },
        upsert: true,
      },
    }));
    if (folderOps.length) await Folder.bulkWrite(folderOps);

    // projects (upsert by query — never duplicated)
    let projectCount = 0;
    const incoming: { project: string; dedupKey: string; fields: Record<string, unknown> }[] = [];
    for (const p of Object.values(projects) as any[]) {
      if (!p || !p.query) continue;
      const pset: Record<string, unknown> = { query: p.query, name: p.name || p.query, createdAt: p.createdAt || new Date().toISOString(), folderId: p.folderId || null };
      if (p.population != null && p.population !== '' && !isNaN(Number(p.population))) pset.population = Number(p.population);
      await Project.updateOne({ query: p.query }, { $set: pset }, { upsert: true });
      projectCount++;
      for (const [k, r] of Object.entries(p.records || {}) as [string, any][]) {
        const { _id, ...rest } = r || {};
        incoming.push({ project: p.query, dedupKey: k, fields: { ...rest, dedupKey: k } });
      }
    }

    // Cross-project dedup: a business (dedupKey = its Google CID/place id) lives
    // in only ONE project. If it already exists in another project, skip it
    // (the existing copy stays where it is). First project to hold it wins.
    const keys = [...new Set(incoming.map((i) => i.dedupKey))];
    const owner = new Map<string, string>(); // dedupKey -> project that owns it
    for (let i = 0; i < keys.length; i += 50000) {
      const found = await Lead.find({ dedupKey: { $in: keys.slice(i, i + 50000) } }).select('dedupKey project').lean();
      for (const e of found as any[]) if (!owner.has(e.dedupKey)) owner.set(e.dedupKey, e.project);
    }

    const ops: any[] = [];
    const touched = new Set<string>(); // projects whose counters must be recomputed
    let added = 0, updated = 0, skipped = 0;
    for (const it of incoming) {
      const ownerProject = owner.get(it.dedupKey);
      if (ownerProject === undefined) {
        ops.push({ updateOne: { filter: { project: it.project, dedupKey: it.dedupKey }, update: { $set: { ...it.fields, project: it.project } }, upsert: true } });
        owner.set(it.dedupKey, it.project); // now owned (also dedupes within this batch)
        touched.add(it.project);
        added++;
      } else if (ownerProject === it.project) {
        ops.push({ updateOne: { filter: { project: it.project, dedupKey: it.dedupKey }, update: { $set: { ...it.fields, project: it.project } }, upsert: true } });
        touched.add(it.project);
        updated++;
      } else {
        skipped++; // already in a different project → don't duplicate
      }
    }

    for (let i = 0; i < ops.length; i += 1000) await Lead.bulkWrite(ops.slice(i, i + 1000), { ordered: false });

    if (touched.size) await recomputeProjectStats([...touched]); // payload cache TTL picks the new counts up

    return json({ ok: true, folders: folderOps.length, projects: projectCount, added, updated, skippedDuplicates: skipped });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}
