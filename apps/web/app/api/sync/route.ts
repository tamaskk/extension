import { gunzipSync } from 'zlib';
import { dbConnect } from '@/lib/db';
import { Folder, Project, Lead, CORS, json } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';
import { refreshSearchTokens } from '@/lib/searchIndex';
import { logActivity, diffFields, type ActivityInput, type Diff } from '@/lib/activity';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

const KEEP_IF_EMPTY = ['email', 'emails', 'emailSource', 'emailStatus', 'emailCheckedAt', 'emailError', 'phone'];
const EMAIL_FIELDS = ['email', 'emails', 'emailSource', 'emailStatus', 'emailCheckedAt'];
// fields whose change on a re-sync is worth a Changelog line (old → new)
const TRACKED = ['name', 'category', 'rating', 'reviewCount', 'phone', 'website', 'websiteStatus', 'address', 'email'];

// Upsert a GridLeads bundle { folders, projects(with records) }. Works for any
// scope the extension sends: a single project, a folder's projects, or everything.
export async function POST(req: Request) {
  try {
    await dbConnect();
    // The extension gzips sync payloads (x-gl-gzip: 1) — inbound JSON was the
    // main Fast Origin Transfer cost, and it compresses ~5-8×.
    let body: any;
    if (req.headers.get('x-gl-gzip') === '1') {
      body = JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer())).toString('utf8'));
    } else {
      body = await req.json();
    }
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
    const newProjects: string[] = [];
    const incoming: { project: string; dedupKey: string; fields: Record<string, unknown> }[] = [];
    for (const p of Object.values(projects) as any[]) {
      if (!p || !p.query) continue;
      const pset: Record<string, unknown> = { query: p.query, name: p.name || p.query, createdAt: p.createdAt || new Date().toISOString(), folderId: p.folderId || null };
      if (p.population != null && p.population !== '' && !isNaN(Number(p.population))) pset.population = Number(p.population);
      const pres = await Project.updateOne({ query: p.query }, { $set: pset }, { upsert: true });
      if (pres.upsertedCount) newProjects.push(p.query);
      projectCount++;
      for (const [k, r] of Object.entries(p.records || {}) as [string, any][]) {
        // `seq` is the server's own sequence state: a bundle (an old export, for
        // one) must never bring it back, or steps already sent would go out again.
        const { _id, seq, sig, ...rest } = r || {};
        // also by a dotted key ("seq.to") or an operator: only plain top-level fields are synced
        for (const k of Object.keys(rest)) if (k.includes('.') || k.startsWith('$')) delete rest[k];
        // The scraper has no email of its own (Maps doesn't return one), so a
        // re-sync used to $set email:'' over an address found earlier. Empty
        // contact fields are "unknown", never "erase".
        for (const f of KEEP_IF_EMPTY) if (rest[f] === '' || rest[f] == null || (Array.isArray(rest[f]) && !rest[f].length)) delete rest[f];
        incoming.push({ project: p.query, dedupKey: k, fields: { ...rest, dedupKey: k } });
      }
    }

    // Cross-project dedup: a business (dedupKey = its Google CID/place id) lives
    // in only ONE project. If it already exists in another project, skip it
    // (the existing copy stays where it is). First project to hold it wins.
    const keys = [...new Set(incoming.map((i) => i.dedupKey))];
    const owner = new Map<string, string>(); // dedupKey -> project that owns it
    const before = new Map<string, Record<string, unknown>>(); // dedupKey -> stored lead (for the old → new diff)
    for (let i = 0; i < keys.length; i += 50000) {
      const found = await Lead.find({ dedupKey: { $in: keys.slice(i, i + 50000) } }).select('dedupKey project ' + TRACKED.join(' ')).lean();
      for (const e of found as any[]) if (!owner.has(e.dedupKey)) { owner.set(e.dedupKey, e.project); before.set(e.dedupKey, e); }
    }

    const ops: any[] = [];
    const touched = new Set<string>(); // projects whose counters must be recomputed
    let added = 0, updated = 0, skipped = 0;
    // per-project Changelog detail
    const log = new Map<string, { fresh: Record<string, unknown>[]; changes: { key: string; name: unknown; diff: Diff }[]; skipped: { key: string; name: unknown; in: string }[] }>();
    const logFor = (p: string) => { let l = log.get(p); if (!l) { l = { fresh: [], changes: [], skipped: [] }; log.set(p, l); } return l; };
    for (const it of incoming) {
      const ownerProject = owner.get(it.dedupKey);
      const f = it.fields;
      if (ownerProject === undefined) logFor(it.project).fresh.push({ key: it.dedupKey, name: f.name, category: f.category, phone: f.phone, website: f.website, websiteStatus: f.websiteStatus, email: f.email });
      else if (ownerProject === it.project) { const diff = diffFields(before.get(it.dedupKey), f, TRACKED); if (Object.keys(diff).length) logFor(it.project).changes.push({ key: it.dedupKey, name: f.name, diff }); }
      else logFor(it.project).skipped.push({ key: it.dedupKey, name: f.name, in: ownerProject });
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
        // …but an email the extension found for it is still worth keeping: put it
        // on the existing copy if that one has none.
        if (it.fields.email) {
          const set: Record<string, unknown> = {};
          for (const f of EMAIL_FIELDS) if (it.fields[f] !== undefined) set[f] = it.fields[f];
          ops.push({ updateOne: { filter: { project: ownerProject, dedupKey: it.dedupKey, email: { $in: ['', null] } }, update: { $set: set } } });
          touched.add(ownerProject);
        }
      }
    }

    for (let i = 0; i < ops.length; i += 1000) await Lead.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    if (ops.length) await refreshSearchTokens(keys); // from the stored values: an empty incoming contact field did not overwrite them

    if (touched.size) await recomputeProjectStats([...touched]); // payload cache TTL picks the new counts up

    const events: ActivityInput[] = [];
    for (const q of newProjects) events.push({ type: 'project.create', project: q, source: 'extension', n: 1, title: `New project: ${q}` });
    for (const [project, l] of log) {
      if (l.fresh.length) {
        const emails = l.fresh.filter((x) => x.email).length;
        events.push({ type: 'leads.new', project, source: 'extension', n: l.fresh.length, keys: l.fresh.map((x) => String(x.key)),
          title: `+${l.fresh.length} new lead${l.fresh.length === 1 ? '' : 's'}${emails ? ` (${emails} with email)` : ''}`, data: { leads: l.fresh } });
      }
      if (l.changes.length) events.push({ type: 'leads.change', project, source: 'extension', n: l.changes.length, keys: l.changes.map((x) => x.key),
        title: `${l.changes.length} lead${l.changes.length === 1 ? '' : 's'} changed on re-sync`, data: { changes: l.changes } });
      if (l.skipped.length) events.push({ type: 'leads.skip', project, source: 'extension', n: l.skipped.length, keys: l.skipped.map((x) => x.key),
        title: `${l.skipped.length} duplicate${l.skipped.length === 1 ? '' : 's'} skipped (already in another project)`, data: { leads: l.skipped } });
    }
    await logActivity(events);

    return json({ ok: true, folders: folderOps.length, projects: projectCount, added, updated, skippedDuplicates: skipped });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}
