import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 120;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/fix-suffix  { from: 'alamaba', to: 'Alabama', dryRun?: boolean }
//   Repairs a typo'd trailing region word in project queries: every project
//   whose query ends with " <from>" is renamed to end with " <to>", and all of
//   that project's leads have their `project` field updated to match.
//   When the renamed query already exists, the two are merged (non-duplicate
//   leads moved, duplicate leads dropped, old empty project removed).
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const from = String(b?.from || 'alamaba').trim();
    const to = String(b?.to || 'Alabama').trim();
    const dryRun = !!b?.dryRun;
    if (!from || !to) return json({ ok: false, error: 'from/to required' }, { status: 400 });

    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endRe = new RegExp(`\\s${esc}$`, 'i'); // " alamaba" at the end

    const projects = (await Project.find({ query: { $regex: endRe } }).select('query').lean()) as { query: string }[];
    const existing = new Set((await Project.find().select('query -_id').lean() as { query: string }[]).map((p) => p.query));

    const rename: { from: string; to: string }[] = [];
    const merge: { from: string; to: string }[] = [];
    for (const p of projects) {
      const newQuery = p.query.slice(0, p.query.length - from.length) + to; // replace trailing token, keep the space
      if (newQuery === p.query) continue;
      (existing.has(newQuery) ? merge : rename).push({ from: p.query, to: newQuery });
    }

    const summary = {
      ok: true, dryRun, from, to,
      matched: projects.length,
      willRename: rename.length,
      willMerge: merge.length,
      sample: rename.slice(0, 5).map((r) => `${r.from}  →  ${r.to}`),
      mergeSample: merge.slice(0, 5).map((r) => `${r.from}  →  ${r.to}`),
    };
    if (dryRun) return json(summary);

    let leadsUpdated = 0, leadsDropped = 0;

    // simple renames (target query does not exist yet)
    for (let i = 0; i < rename.length; i += 500) {
      const chunk = rename.slice(i, i + 500);
      await Project.bulkWrite(chunk.map((r) => ({ updateOne: { filter: { query: r.from }, update: { $set: { query: r.to } } } })));
      for (const r of chunk) {
        const res = await Lead.updateMany({ project: r.from }, { $set: { project: r.to } });
        leadsUpdated += (res as any).modifiedCount || 0;
      }
    }

    // merges (target query already exists) — move non-duplicate leads, drop dupes
    for (const m of merge) {
      const targetKeys = new Set((await Lead.find({ project: m.to }).select('dedupKey -_id').lean() as { dedupKey: string }[]).map((l) => l.dedupKey));
      const oldLeads = (await Lead.find({ project: m.from }).select('dedupKey -_id').lean()) as { dedupKey: string }[];
      const dupKeys = oldLeads.filter((l) => targetKeys.has(l.dedupKey)).map((l) => l.dedupKey);
      if (dupKeys.length) { const r = await Lead.deleteMany({ project: m.from, dedupKey: { $in: dupKeys } }); leadsDropped += (r as any).deletedCount || 0; }
      const r2 = await Lead.updateMany({ project: m.from }, { $set: { project: m.to } });
      leadsUpdated += (r2 as any).modifiedCount || 0;
      await Project.deleteOne({ query: m.from });
    }

    return json({ ...summary, leadsUpdated, leadsDropped });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'fix-suffix failed' }, { status: 500 });
  }
}
