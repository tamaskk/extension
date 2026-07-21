import { dbConnect } from '@/lib/db';
import { CORS, json, ProjectStat, mongoose } from '@/lib/models';
import { GROUP_STAGE, invalidateProjectsCache } from '@/lib/projectStats';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/projects/refresh  { after?, at? } — one chunk of the full counter
// rebuild (the Σ Recount button). A complete rebuild takes 70s+ on the shared
// Atlas tier — over Vercel's 60s limit — so the client loops: each request
// counts+writes a contiguous slice of the project-key space entirely inside
// Mongo ($merge), then returns the cursor for the next call. The final call
// sweeps stale docs and drops the cached sidebar payload.
const SUB_RANGES = 4;       // $merge pipelines per request (run concurrently)
const NAMES_PER_SUB = 6000; // project names per pipeline

export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const after: string | null = typeof b?.after === 'string' && b.after ? b.after : null;
    const at: string = typeof b?.at === 'string' && b.at ? b.at : new Date().toISOString();
    const db = mongoose.connection.db!;
    await db.collection('projectstats').createIndex({ project: 1 }, { unique: true }); // $merge join key

    // Upper bounds via index-only skip queries — no 190k-name fetch per request.
    const bounds: (string | null)[] = [];
    let cur: string | null = after;
    for (let i = 0; i < SUB_RANGES; i++) {
      const q: Record<string, unknown> = cur ? { query: { $gt: cur } } : {};
      const next = await db.collection('projects').find(q).sort({ query: 1 })
        .skip(NAMES_PER_SUB - 1).limit(1).project({ query: 1, _id: 0 }).toArray();
      const upper: string | null = next.length ? (next[0].query as string) : null;
      bounds.push(upper);
      cur = upper;
      if (upper === null) break; // past the last project name — final span is open-ended
    }

    const spans: [string | null, string | null][] = [];
    let lo: string | null = after;
    for (const up of bounds) { spans.push([lo, up]); lo = up; }

    await Promise.all(spans.map(([a, up]) => {
      const range: Record<string, string> = {};
      if (a !== null) range.$gt = a;    // cursor was the previous span's inclusive upper bound
      if (up !== null) range.$lte = up;
      const match = Object.keys(range).length ? { project: range } : {};
      return db.collection('leads').aggregate([
        { $match: match },
        GROUP_STAGE,
        { $project: { _id: 0, project: '$_id', total: 1, noWebsite: 1, hot: 1, email: 1, reviews: 1, reviewsSum: 1, ai: 1, oppSum: 1, updatedAt: { $literal: at } } },
        { $merge: { into: 'projectstats', on: 'project', whenMatched: 'replace', whenNotMatched: 'insert' } },
      ]).toArray(); // toArray() drives the pipeline; $merge emits no rows
    }));

    if (bounds[bounds.length - 1] === null) { // covered through the end of the keyspace
      await ProjectStat.deleteMany({ updatedAt: { $lt: at } }); // projects whose leads are gone
      await invalidateProjectsCache();
      return json({ ok: true, done: true, at, projects: await ProjectStat.estimatedDocumentCount() });
    }
    return json({ ok: true, done: false, at, after: bounds[bounds.length - 1] });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'refresh failed' }, { status: 500 });
  }
}
