import mongoose from 'mongoose';
import { gzip as gzipCb } from 'zlib';
import { promisify } from 'util';
import { dbConnect } from '@/lib/db';
import { Project, Lead, NO_SITE, CORS, json } from '@/lib/models';

const gzip = promisify(gzipCb);

export const runtime = 'nodejs';
export const maxDuration = 60; // cold recompute over 1.2M leads can take ~6s
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Mongo-backed cache: the payload (143k projects + a group-by-project scan over
// 1.2M leads) is expensive but changes only on sync/edits. Stored gzipped in a
// `caches` doc so EVERY serverless instance reads it in ~100ms — an in-memory
// cache is useless here because Vercel spreads requests across cold instances.
// TTL 60s; a structural edit deletes the doc to force an immediate recompute.
const CACHE_KEY = 'projects';
const TTL_MS = 60_000;

async function cacheColl() {
  await dbConnect();
  return mongoose.connection.db!.collection('caches');
}

function toBuf(gz: unknown): Buffer {
  const b = (gz as { buffer?: Buffer })?.buffer ?? gz; // native driver Binary → .buffer
  return Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array);
}

// Returns the gzipped JSON bytes. Serving them with Content-Encoding: gzip keeps
// the 15MB / 143k-project payload under Vercel's 4.5MB response limit (~1.4MB
// compressed) — the raw JSON exceeds it and 500s, which is why the sidebar
// stopped loading as the project count grew.
async function getProjectsGz(): Promise<Buffer> {
  const coll = await cacheColl();
  const doc = await coll.findOne({ key: CACHE_KEY });
  if (doc && Date.now() - (doc.at as number) < TTL_MS && doc.gz) {
    return toBuf(doc.gz);
  }
  const out = await computeProjects();
  const gz = await gzip(JSON.stringify(out));
  await coll.updateOne({ key: CACHE_KEY }, { $set: { key: CACHE_KEY, gz, at: Date.now() } }, { upsert: true });
  return gz;
}

async function invalidate() {
  const coll = await cacheColl();
  await coll.deleteOne({ key: CACHE_KEY });
}

const GROUP_STAGE = {
  $group: {
    _id: '$project',
    total: { $sum: 1 },
    noWebsite: { $sum: { $cond: [{ $in: ['$websiteStatus', NO_SITE] }, 1, 0] } },
    hot: { $sum: { $cond: [{ $eq: ['$leadTemperature', 'HOT'] }, 1, 0] } },
    email: { $sum: { $cond: [{ $and: [{ $ne: ['$email', ''] }, { $ne: ['$email', null] }] }, 1, 0] } },
    reviews: { $sum: { $cond: [{ $gt: ['$reviewsCount', 0] }, 1, 0] } },
    reviewsSum: { $sum: { $ifNull: ['$reviewsCount', 0] } },
    ai: { $sum: { $cond: [{ $gt: ['$aiAt', ''] }, 1, 0] } },
    oppSum: { $sum: { $ifNull: ['$opportunityScore', 0] } },
  },
} as const;

export async function computeProjects() {
  await dbConnect();
  const leadsColl = mongoose.connection.db!.collection('leads');
  const projects = await Project.find().select('query name createdAt folderId -_id').lean();

  // A single $group over 1.2M leads → 96k buckets exceeds the 100MB limit, and
  // this shared Atlas tier cannot spill to disk (allowDiskUse is ignored). So
  // partition the project-key space into N contiguous ranges (few groups each,
  // well under 100MB) and merge — 8 ranges run concurrently to bound cluster load.
  const names = (projects as { query: string }[]).map((p) => p.query).filter(Boolean).sort();
  const N = 40;
  const bounds: string[] = [];
  for (let i = 1; i < N; i++) bounds.push(names[Math.floor((i * names.length) / N)]);
  const ranges: [string | null, string | null][] = [];
  let lo: string | null = null;
  for (const b of bounds) { ranges.push([lo, b]); lo = b; }
  ranges.push([lo, null]); // last range → project >= final bound

  const counts: Record<string, any> = {};
  let idx = 0;
  const worker = async () => {
    while (idx < ranges.length) {
      const [a, b] = ranges[idx++];
      const range: Record<string, string> = {};
      if (a !== null) range.$gte = a;
      if (b !== null) range.$lt = b;
      const match = Object.keys(range).length ? { project: range } : {};
      const rows = await leadsColl.aggregate([{ $match: match }, GROUP_STAGE]).toArray();
      for (const r of rows) counts[r._id] = r;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  return (projects as any[]).map((p) => {
    const c = counts[p.query] || { total: 0, noWebsite: 0, hot: 0, email: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };
    return { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || null, total: c.total, noWebsite: c.noWebsite, hot: c.hot, email: c.email, reviews: c.reviews || 0, reviewsSum: c.reviewsSum || 0, ai: c.ai || 0, oppSum: c.oppSum };
  });
}

// Project summaries with lead counts (folderId, total, noWebsite, hot, email).
export async function GET() {
  try {
    const gz = await getProjectsGz();
    // Buffer is a valid response body at runtime; cast past the strict lib type.
    return new Response(gz as unknown as BodyInit, {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' },
    });
  } catch (e: any) {
    return json({ error: e?.message || 'projects failed' }, { status: 500 });
  }
}

// Rename / move — single or bulk: { query?, queries?, name?, folderId? (null = root) }
export async function PATCH(req: Request) {
  await dbConnect();
  const b = await req.json();
  const queries: string[] = b.queries || (b.query ? [b.query] : []);
  const set: Record<string, unknown> = {};
  if (typeof b.name === 'string') set.name = b.name;
  if (b.folderId !== undefined) set.folderId = b.folderId || null;
  if (queries.length && Object.keys(set).length) await Project.updateMany({ query: { $in: queries } }, { $set: set });
  await invalidate(); // rename/move must show immediately in the sidebar
  return json({ ok: true });
}

// Delete projects + their leads: { query? | queries? }
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  const queries: string[] = b.queries || (b.query ? [b.query] : []);
  if (queries.length) {
    await Project.deleteMany({ query: { $in: queries } });
    await Lead.deleteMany({ project: { $in: queries } });
    await invalidate();
  }
  return json({ ok: true });
}
