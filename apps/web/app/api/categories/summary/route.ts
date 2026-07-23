import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Category summary: every category with its lead count and how many projects
// (≈ cities) it appears in. A single group over 1.3M leads → category×project
// buckets exceeds the shared tier's 100MB group limit, and the whole scan
// exceeds the 60s function limit, so the client drives chunked POSTs over the
// project keyspace (same pattern as /api/projects/refresh) and the finished
// table is cached in the `caches` collection.
const KEY = 'catsummary';
const PARTIAL = 'catsummary_partial';
const SUB_RANGES = 4;
const NAMES_PER_SUB = 6000;
const STALE_MS = 10 * 60_000;

async function caches() {
  await dbConnect();
  return mongoose.connection.db!.collection('caches');
}

// GET → the cached summary (rows, at, stale)
export async function GET() {
  try {
    const coll = await caches();
    const doc = await coll.findOne({ key: KEY });
    if (!doc?.data) return json({ ok: true, rows: [], at: 0, stale: true });
    return json({ ok: true, rows: doc.data, at: doc.at || 0, stale: Date.now() - (doc.at || 0) > STALE_MS });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'summary failed' }, { status: 500 });
  }
}

// POST { after?, at? } → one chunk of the rebuild; loop until done:true.
// Partial per-category tallies accumulate in a scratch caches doc between
// requests ([category, leads, projects] triplets — categories are only a few
// thousand). Ranges partition the project keyspace, so per-category project
// counts are additive across chunks.
export async function POST(req: Request) {
  try {
    const coll = await caches();
    const db = mongoose.connection.db!;
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const after: string | null = typeof b?.after === 'string' && b.after ? b.after : null;
    const at: number = typeof b?.at === 'number' && b.at ? b.at : Date.now();
    if (!after) await coll.updateOne({ key: PARTIAL }, { $set: { key: PARTIAL, at, acc: [] } }, { upsert: true });

    // upper bounds via index-only skip queries
    const bounds: (string | null)[] = [];
    let cur: string | null = after;
    for (let i = 0; i < SUB_RANGES; i++) {
      const q: Record<string, unknown> = cur ? { query: { $gt: cur } } : {};
      const next = await db.collection('projects').find(q).sort({ query: 1 })
        .skip(NAMES_PER_SUB - 1).limit(1).project({ query: 1, _id: 0 }).toArray();
      const upper: string | null = next.length ? (next[0].query as string) : null;
      bounds.push(upper);
      cur = upper;
      if (upper === null) break;
    }
    const spans: [string | null, string | null][] = [];
    let lo: string | null = after;
    for (const up of bounds) { spans.push([lo, up]); lo = up; }

    const acc = new Map<string, [number, number]>(); // category -> [leads, projects]
    await Promise.all(spans.map(async ([a, up]) => {
      const range: Record<string, string> = {};
      if (a !== null) range.$gt = a;
      if (up !== null) range.$lte = up;
      const match = Object.keys(range).length ? { project: range } : {};
      const rows = await db.collection('leads').aggregate([
        { $match: match },
        { $group: { _id: { c: '$category', p: '$project' }, n: { $sum: 1 } } },
        { $group: { _id: '$_id.c', count: { $sum: '$n' }, projects: { $sum: 1 } } },
      ]).toArray();
      for (const r of rows) {
        const c = (r._id as string) || '';
        if (!c) continue;
        const e = acc.get(c) || [0, 0];
        acc.set(c, [e[0] + (r.count as number), e[1] + (r.projects as number)]);
      }
    }));

    // merge this chunk into the scratch doc
    const partial = await coll.findOne({ key: PARTIAL });
    const merged = new Map<string, [number, number]>((partial?.acc || []).map((t: [string, number, number]) => [t[0], [t[1], t[2]]]));
    for (const [c, [n, p]] of acc) {
      const e = merged.get(c) || [0, 0];
      merged.set(c, [e[0] + n, e[1] + p]);
    }
    const accArr = [...merged].map(([c, [n, p]]) => [c, n, p]);

    if (bounds[bounds.length - 1] === null) { // finished the keyspace
      const rows = accArr
        .map(([category, count, projects]) => ({ category, count, projects }))
        .sort((a, b) => (b.count as number) - (a.count as number));
      await coll.updateOne({ key: KEY }, { $set: { key: KEY, data: rows, at } }, { upsert: true });
      await coll.deleteOne({ key: PARTIAL });
      return json({ ok: true, done: true, at, categories: rows.length });
    }
    await coll.updateOne({ key: PARTIAL }, { $set: { acc: accArr, at } }, { upsert: true });
    return json({ ok: true, done: false, at, after: bounds[bounds.length - 1] });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'summary rebuild failed' }, { status: 500 });
  }
}
