import { dbConnect } from '@/lib/db';
import { Folder, Project, CORS, json } from '@/lib/models';
import { COUNTRY_CITIES } from '@/lib/countries';
import { STATE_REGIONS } from '@/lib/regionNames';
import { buildRegionIndex, planFor, norm } from '@/lib/organize.mjs';

export const runtime = 'nodejs';
export const maxDuration = 120;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Country flag for nicely iconed root folders we create.
const FLAG: Record<string, string> = {
  USA: '🇺🇸', Hungary: '🇭🇺', Canada: '🇨🇦', Austria: '🇦🇹', Belgium: '🇧🇪',
  France: '🇫🇷', Greece: '🇬🇷', 'Hong Kong': '🇭🇰', Italy: '🇮🇹', Netherlands: '🇳🇱',
  Portugal: '🇵🇹', Spain: '🇪🇸', Switzerland: '🇨🇭', Taipei: '🇹🇼', UK: '🇬🇧',
};

type F = { folderId: string; name: string; parentId: string | null; order: number; icon: string; _new?: boolean };

// POST /api/organize  { dryRun?: boolean, cleanup?: boolean }
//   Re-files every project into  "<region> <vertical>"  and nests that under
//   "<country> <vertical>", creating folders as needed, reparenting misplaced
//   ones, and (cleanup, default on) deleting folders left empty by the reorg.
//   Existing folders are matched case/accent-insensitively so correctly-named
//   folders are reused (no churn); genuine typos/dupes get consolidated.
//   Projects whose region can't be resolved are left exactly where they are.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = !!body?.dryRun;
    const cleanup = body?.cleanup !== false;

    // 1) region index — US states → USA, every country's cities → that country
    const entries: { name: string; country: string }[] = [];
    for (const s of STATE_REGIONS) entries.push({ name: s, country: 'USA' });
    for (const [country, cities] of Object.entries(COUNTRY_CITIES)) for (const c of cities) entries.push({ name: c, country });
    const idx = buildRegionIndex(entries);

    // 2) current state
    const folders = (await Folder.find().lean()) as any[];
    const projects = (await Project.find().select('query folderId').lean()) as { query: string; folderId: string | null }[];

    // existing folders keyed by NORMALIZED name (lowest order wins on dupes)
    const byName = new Map<string, F>();
    for (const f of folders) {
      const k = norm(f.name);
      const doc: F = { folderId: f.folderId, name: f.name, parentId: f.parentId || null, order: f.order ?? 0, icon: f.icon || '' };
      const cur = byName.get(k);
      if (!cur || doc.order < cur.order) byName.set(k, doc);
    }

    let seq = 0;
    const genId = () => 'f_' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
    const created: F[] = [];
    const ensure = (name: string, country: string | null): F => {
      const k = norm(name);
      let f = byName.get(k);
      if (!f) {
        f = { folderId: genId(), name, parentId: null, order: 10000 + created.length, icon: country && FLAG[country] ? FLAG[country] : '', _new: true };
        byName.set(k, f);
        created.push(f);
      }
      return f;
    };

    // 3) plan
    const projMoves: { query: string; folderId: string }[] = [];
    const reparents = new Map<string, string | null>(); // folderId → new parentId
    let unmatched = 0;
    const sampleUnmatched: string[] = [];

    for (const p of projects) {
      const plan = planFor(p.query, idx);
      if (!plan) { unmatched++; if (sampleUnmatched.length < 12) sampleUnmatched.push(p.query); continue; }
      const root = ensure(plan.rootName, plan.country);
      if (root.parentId !== null && !root._new) reparents.set(root.folderId, null);
      root.parentId = null;
      const sub = ensure(plan.subName, plan.country);
      if (sub.folderId !== root.folderId && sub.parentId !== root.folderId) {
        sub.parentId = root.folderId;
        if (!sub._new) reparents.set(sub.folderId, root.folderId);
      }
      if ((p.folderId || null) !== sub.folderId) projMoves.push({ query: p.query, folderId: sub.folderId });
    }

    // 4) folders emptied by the reorg (had projects/children before, none after)
    const beforeProj = new Map<string, number>();
    for (const p of projects) { const k = p.folderId || ''; if (k) beforeProj.set(k, (beforeProj.get(k) || 0) + 1); }
    const beforeChild = new Map<string, number>();
    for (const f of folders) { const k = f.parentId || ''; if (k) beforeChild.set(k, (beforeChild.get(k) || 0) + 1); }
    const newFolderOf = new Map<string, string | null>();
    for (const p of projects) newFolderOf.set(p.query, p.folderId || null);
    for (const m of projMoves) newFolderOf.set(m.query, m.folderId);
    const afterProj = new Map<string, number>();
    for (const fid of newFolderOf.values()) if (fid) afterProj.set(fid, (afterProj.get(fid) || 0) + 1);
    const parentOf = new Map<string, string | null>();
    for (const f of folders) parentOf.set(f.folderId, f.parentId || null);
    for (const c of created) parentOf.set(c.folderId, c.parentId || null);
    for (const [fid, pid] of reparents) parentOf.set(fid, pid);
    const afterChild = new Map<string, number>();
    for (const pid of parentOf.values()) if (pid) afterChild.set(pid, (afterChild.get(pid) || 0) + 1);

    const toDelete: { folderId: string; name: string }[] = [];
    if (cleanup) {
      for (const f of folders) {
        const had = (beforeProj.get(f.folderId) || 0) + (beforeChild.get(f.folderId) || 0);
        const has = (afterProj.get(f.folderId) || 0) + (afterChild.get(f.folderId) || 0);
        if (had > 0 && has === 0) toDelete.push({ folderId: f.folderId, name: f.name });
      }
    }

    const summary = {
      ok: true,
      dryRun,
      totalProjects: projects.length,
      foldersCreated: created.map((c) => c.name),
      foldersReparented: reparents.size,
      projectsMoved: projMoves.length,
      foldersDeleted: toDelete.map((d) => d.name),
      unmatched,
      sampleUnmatched,
    };

    if (dryRun) return json(summary);

    // 5) apply
    if (created.length) {
      await Folder.insertMany(created.map((c) => ({
        folderId: c.folderId, name: c.name, createdAt: new Date().toISOString(),
        collapsed: true, order: c.order, parentId: c.parentId, icon: c.icon || '',
      })));
    }
    if (reparents.size) {
      await Folder.bulkWrite([...reparents].map(([folderId, parentId]) => ({ updateOne: { filter: { folderId }, update: { $set: { parentId } } } })));
    }
    for (let i = 0; i < projMoves.length; i += 1000) {
      const chunk = projMoves.slice(i, i + 1000);
      await Project.bulkWrite(chunk.map((m) => ({ updateOne: { filter: { query: m.query }, update: { $set: { folderId: m.folderId } } } })));
    }
    if (toDelete.length) {
      await Folder.deleteMany({ folderId: { $in: toDelete.map((d) => d.folderId) } });
    }

    return json(summary);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'organize failed' }, { status: 500 });
  }
}
