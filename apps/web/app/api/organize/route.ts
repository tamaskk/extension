import { dbConnect } from '@/lib/db';
import { Folder, Project, CORS, json } from '@/lib/models';
import { invalidateProjectsCache } from '@/lib/projectStats';
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
//   "<country> <vertical>", creating folders as needed and reparenting misplaced
//   ones. NEVER deletes anything — no folder is removed (even if it ends up
//   empty) and no project is removed. Pass { cleanup:true } to also delete
//   folders left empty by the reorg (off by default).
//   Existing folders are matched case/accent-insensitively so correctly-named
//   folders are reused (no churn); genuine typos/dupes get consolidated.
//   Projects whose region can't be resolved are left exactly where they are.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = !!body?.dryRun;
    const cleanup = body?.cleanup === true; // default: keep every folder, delete nothing

    // 1) region index — US states → USA, every country's cities → that country
    const entries: { name: string; country: string }[] = [];
    for (const s of STATE_REGIONS) entries.push({ name: s, country: 'USA' });
    for (const [country, cities] of Object.entries(COUNTRY_CITIES)) for (const c of cities) entries.push({ name: c, country });
    const idx = buildRegionIndex(entries);

    // 2) current state
    const folders = (await Folder.find().lean()) as any[];
    const projects = (await Project.find().select('query folderId createdAt').lean()) as { query: string; folderId: string | null; createdAt?: string }[];

    // folder name + original parent by id (for the inspectable plan tree)
    const nameById = new Map<string, string>();
    const origParentById = new Map<string, string | null>();
    for (const f of folders) { nameById.set(f.folderId, f.name); origParentById.set(f.folderId, f.parentId || null); }
    const folderName = (id: string | null | undefined) => (id && nameById.get(id)) || '(ungrouped)';

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
        nameById.set(f.folderId, name);
      }
      return f;
    };

    // 3) plan
    const projMoves: { query: string; folderId: string; from: string; createdAt: string }[] = [];
    const reparents = new Map<string, string | null>(); // folderId → new parentId
    const subToRoot = new Map<string, string>(); // sub folderId → its root folderId
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
      subToRoot.set(sub.folderId, root.folderId);
      if ((p.folderId || null) !== sub.folderId) projMoves.push({ query: p.query, folderId: sub.folderId, from: folderName(p.folderId), createdAt: p.createdAt || '' });
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

    // 4b) inspectable plan tree: root → sub → moved projects (only what changes)
    const createdIds = new Set(created.map((c) => c.folderId));
    const iconById = new Map<string, string>();
    for (const f of folders) iconById.set(f.folderId, f.icon || '');
    for (const c of created) iconById.set(c.folderId, c.icon || '');
    const movedBySub = new Map<string, { query: string; from: string; createdAt: string }[]>();
    for (const m of projMoves) (movedBySub.get(m.folderId) || movedBySub.set(m.folderId, []).get(m.folderId)!).push({ query: m.query, from: m.from, createdAt: m.createdAt });

    // a sub is "involved" if it's created, reparented, or receives moved projects
    const involvedSubs = [...subToRoot.keys()].filter((sid) => createdIds.has(sid) || reparents.has(sid) || movedBySub.has(sid));
    const subsByRoot = new Map<string, string[]>();
    for (const sid of involvedSubs) { const r = subToRoot.get(sid)!; (subsByRoot.get(r) || subsByRoot.set(r, []).get(r)!).push(sid); }

    const planRoots = [...subsByRoot.keys()].map((rid) => {
      const subs = subsByRoot.get(rid)!.map((sid) => {
        const moved = (movedBySub.get(sid) || []).slice().sort((a, b) => a.query.localeCompare(b.query));
        const status = createdIds.has(sid) ? 'created' : reparents.has(sid) ? 'reparented' : 'existing';
        return {
          name: folderName(sid),
          status,
          fromParent: status === 'reparented' ? (origParentById.get(sid) ? folderName(origParentById.get(sid)) : '(top level)') : undefined,
          movedCount: moved.length,
          alreadyHere: Math.max(0, (afterProj.get(sid) || 0) - moved.length),
          moved,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return {
        name: folderName(rid),
        icon: iconById.get(rid) || '',
        created: createdIds.has(rid),
        movedCount: subs.reduce((s, x) => s + x.movedCount, 0),
        subs,
      };
    }).sort((a, b) => (Number(b.created) - Number(a.created)) || a.name.localeCompare(b.name));

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
      plan: { roots: planRoots },
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
    await invalidateProjectsCache(); // folderId moves must show in the sidebar

    return json(summary);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'organize failed' }, { status: 500 });
  }
}
