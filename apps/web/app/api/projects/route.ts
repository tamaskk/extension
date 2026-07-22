import mongoose from 'mongoose';
import { gzip as gzipCb } from 'zlib';
import { promisify } from 'util';
import { dbConnect } from '@/lib/db';
import { Project, Lead, ProjectStat, CORS, json } from '@/lib/models';
import { invalidateProjectsCache, recomputeAllProjectStats } from '@/lib/projectStats';

const gzip = promisify(gzipCb);

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Mongo-backed cache of the final gzipped payload, so EVERY serverless instance
// serves it in ~100ms — an in-memory cache is useless here because Vercel
// spreads requests across cold instances. Short TTL: lead-count recomputes do
// NOT drop this doc (during scraping that happens every few seconds and killed
// both the cache and the browser's 304s); the payload just expires and is
// rebuilt from ProjectStat (cheap join, no lead scan). Structural edits
// (rename/move/delete/organize/Recount) still invalidate instantly.
const CACHE_KEY = 'projects';
const TTL_MS = 120_000;

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
async function getProjectsGz(): Promise<{ gz: Buffer; at: number }> {
  const coll = await cacheColl();
  const doc = await coll.findOne({ key: CACHE_KEY });
  if (doc?.gz && Date.now() - ((doc.at as number) || 0) < TTL_MS) return { gz: toBuf(doc.gz), at: (doc.at as number) || 0 };
  const out = await computeProjects();
  const gz = await gzip(JSON.stringify(out));
  const at = Date.now();
  await coll.updateOne({ key: CACHE_KEY }, { $set: { key: CACHE_KEY, gz, at } }, { upsert: true });
  return { gz, at };
}

// Join Project docs with their precomputed ProjectStat counters — no lead scan.
// First run (empty ProjectStat collection) bootstraps with a full recompute.
export async function computeProjects() {
  await dbConnect();
  if (!(await ProjectStat.estimatedDocumentCount())) await recomputeAllProjectStats();
  const [projects, stats] = await Promise.all([
    Project.find().select('query name createdAt folderId -_id').lean(),
    ProjectStat.find().select('-_id -updatedAt').lean(),
  ]);
  const by = new Map((stats as any[]).map((s) => [s.project, s]));
  return (projects as any[]).map((p) => {
    const c = by.get(p.query) || {};
    return {
      query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || null,
      total: c.total || 0, noWebsite: c.noWebsite || 0, hot: c.hot || 0, email: c.email || 0,
      reviews: c.reviews || 0, reviewsSum: c.reviewsSum || 0, ai: c.ai || 0, oppSum: c.oppSum || 0,
    };
  });
}

// Project summaries with lead counts (folderId, total, noWebsite, hot, email).
// ETag'd: the browser revalidates each load and gets a body-less 304 while the
// cached payload is unchanged — the ~1.4MB gz only transfers after a rebuild.
// This payload was eating the Fast Origin Transfer quota (every dashboard
// load/refresh re-downloaded it).
export async function GET(req: Request) {
  try {
    const { gz, at } = await getProjectsGz();
    const etag = `"p${at}"`;
    const headers = {
      ...CORS,
      ETag: etag,
      'Cache-Control': 'private, no-cache', // always revalidate, never serve stale without asking
    };
    // tolerate weak validators — Vercel's edge may transform the body and mark the ETag W/
    const inm = (req.headers.get('if-none-match') || '').replace(/^W\//, '');
    if (inm === etag) return new Response(null, { status: 304, headers });
    // Buffer is a valid response body at runtime; cast past the strict lib type.
    return new Response(gz as unknown as BodyInit, {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' },
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
  await invalidateProjectsCache(); // rename/move must show immediately in the sidebar
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
    await ProjectStat.deleteMany({ project: { $in: queries } });
    await invalidateProjectsCache();
  }
  return json({ ok: true });
}
