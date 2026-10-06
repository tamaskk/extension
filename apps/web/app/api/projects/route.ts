import { after } from 'next/server';
import { createHash } from 'crypto';
import { gzip as gzipCb } from 'zlib';
import { promisify } from 'util';
import { dbConnect } from '@/lib/db';
import { readCache, readCacheMeta, writeCache, claimRebuild, finishRebuild } from '@/lib/cache';
import { encodeProjects } from '@/lib/projectsPayload.mjs';
import { Project, Lead, ProjectStat, CORS, json, descendantFolderIds } from '@/lib/models';
import { invalidateProjectsCache } from '@/lib/projectStats';
import { computeProjects, withCounters } from '@/lib/sidebar';
import { projectIndex, projectFilter } from '@/lib/projectScope';
import { logActivity, type ActivityInput } from '@/lib/activity';
import { Folder } from '@/lib/models';

const gzip = promisify(gzipCb);

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Mongo-backed cache of the final gzipped payload, so EVERY serverless instance
// serves it in ~100ms — an in-memory cache is useless here because Vercel
// spreads requests across cold instances. Lead-count recomputes do NOT drop
// this doc (during scraping that happens every few seconds and killed both the
// cache and the browser's 304s). After TTL_MS the stored payload is still
// served at once and rebuilt after the response; the ETag is a hash of the
// content, so an unchanged rebuild keeps the browser's copy valid. Structural
// edits (rename/move/delete/organize/Recount) drop the doc, and the next GET
// rebuilds it inside the request so the edit shows immediately.
const CACHE_KEY = 'projects';
const TTL_MS = 120_000;

function toBuf(gz: unknown): Buffer {
  const b = (gz as { buffer?: Buffer })?.buffer ?? gz; // native driver Binary → .buffer
  return Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array);
}

async function buildProjects(): Promise<{ gz: Buffer; hash: string }> {
  const body = JSON.stringify(encodeProjects(await computeProjects())); // compact rows, see lib/projectsPayload.mjs
  return { gz: await gzip(body), hash: createHash('sha1').update(body).digest('base64url') };
}

// Runs after the response (see getProjectsGz). An unchanged payload only gets
// a new timestamp: no multi-MB write, and the ETag stays the same.
async function rebuildProjectsCache() {
  try {
    const claim = await claimRebuild(CACHE_KEY);
    if (claim === null) return; // another request is already rebuilding
    const prev = await readCacheMeta(CACHE_KEY);
    const built = await buildProjects();
    const at = Date.now();
    await finishRebuild(CACHE_KEY, claim, prev?.hash === built.hash ? { at } : { ...built, at });
  } catch (e) {
    // the claim expires on its own and a later request retries
    console.error('projects cache rebuild failed', e);
  }
}

// Returns the gzipped JSON bytes. Serving them with Content-Encoding: gzip keeps
// the payload under Vercel's 4.5MB response limit — the raw JSON exceeds it and
// 500s, which is why the sidebar stopped loading as the project count grew.
async function getProjectsGz(): Promise<{ gz: Buffer; hash: string }> {
  const doc = await readCache(CACHE_KEY);
  if (doc?.gz && doc.hash) { // a doc without a hash is from before the content ETag: rebuild it below
    if (Date.now() - (doc.at || 0) >= TTL_MS) after(rebuildProjectsCache);
    return { gz: toBuf(doc.gz), hash: doc.hash };
  }
  const built = await buildProjects();
  await writeCache(CACHE_KEY, { ...built, at: Date.now() });
  return built;
}

// ?folder=<id> → the projects directly in that folder (`__root__`: the ones in no
//   folder); &deep=1&fields=names → [query, name] of the folder's whole subtree
// ?search=&ptype=&pregion=&country= → the projects that pass the sidebar filters,
//   wherever they are; &fields=query → only their queries (for "select all")
// The lazy sidebar asks for these instead of the full list. Live, not cached:
// each is a few hundred rows read through an index.
async function scopedProjects(u: URLSearchParams) {
  await dbConnect();
  if (u.has('folder')) {
    const folder = String(u.get('folder') || '');
    let q: Record<string, unknown>;
    if (folder === '__root__') {
      const ids = ((await Folder.find().select('folderId -_id').lean()) as { folderId: string }[]).map((f) => f.folderId);
      q = { folderId: { $nin: ids } }; // no folder, or a folder that no longer exists
    } else {
      q = { folderId: u.get('deep') === '1' ? { $in: await descendantFolderIds(folder) } : folder };
    }
    const projs = (await Project.find(q).select('query name createdAt folderId -_id').lean()) as { query: string; name?: string; createdAt?: string; folderId?: string | null }[];
    if (u.get('fields') === 'names') return json({ ok: true, names: projs.map((p) => [p.query, !p.name || p.name === p.query ? 0 : p.name]) });
    return json({ ok: true, ...encodeProjects(await joinCounters(projs)) });
  }

  // filter over the cached project index (query, name, folder) in memory
  const text = String(u.get('search') || '').trim().toLowerCase();
  const { test } = projectFilter(u.getAll('ptype').filter(Boolean), u.getAll('pregion').filter(Boolean), String(u.get('country') || ''));
  const hits = (await projectIndex()).filter((p) => (!text || p.query.toLowerCase().includes(text) || p.name.toLowerCase().includes(text)) && (!test || test(p.query)));
  const byFolder: Record<string, number> = {};
  for (const h of hits) { const k = h.folderId || ''; byFolder[k] = (byFolder[k] || 0) + 1; }
  if (u.get('fields') === 'query') {
    const limit = Math.min(5000, Math.max(1, parseInt(u.get('limit') || '5000', 10) || 5000));
    return json({ ok: true, queries: hits.slice(0, limit).map((h) => h.query), total: hits.length });
  }
  const limit = Math.min(2000, Math.max(1, parseInt(u.get('limit') || '500', 10) || 500));
  const page = hits.slice(0, limit).map((h) => h.query);
  const projs = (await Project.find({ query: { $in: page } }).select('query name createdAt folderId -_id').lean()) as { query: string; name?: string; createdAt?: string; folderId?: string | null }[];
  return json({ ok: true, ...encodeProjects(await joinCounters(projs)), total: hits.length, byFolder });
}

async function joinCounters(projs: { query: string; name?: string; createdAt?: string; folderId?: string | null }[]) {
  const stats = (await ProjectStat.find({ project: { $in: projs.map((p) => p.query) } }).select('-_id -updatedAt').lean()) as unknown as (Record<string, number> & { project: string })[];
  const by = new Map(stats.map((st) => [st.project, st]));
  return projs.map((p) => withCounters(p, by.get(p.query)));
}

// Project summaries with lead counts (folderId, total, noWebsite, hot, email).
// ETag'd: the browser revalidates each load and gets a body-less 304 while the
// content is unchanged — the multi-MB gz only transfers when a name, a folder
// or a counter actually changed. This payload was eating the Fast Origin
// Transfer quota (every dashboard load/refresh re-downloaded it).
export async function GET(req: Request) {
  const started = performance.now();
  try {
    const u = new URL(req.url).searchParams;
    if (['folder', 'search', 'ptype', 'pregion', 'country'].some((k) => u.has(k))) return await scopedProjects(u);
    // tolerate weak validators — Vercel's edge may transform the body and mark the ETag W/
    const inm = (req.headers.get('if-none-match') || '').replace(/^W\//, '');
    const base = { ...CORS, 'Cache-Control': 'private, no-cache' }; // always revalidate, never serve stale without asking
    const timing = () => `total;dur=${(performance.now() - started).toFixed(1)}`;
    // Revalidation: compare against the stored hash alone. The usual answer is
    // 304, and it should not cost reading the multi-MB body out of MongoDB.
    if (inm) {
      const meta = await readCacheMeta(CACHE_KEY);
      if (meta?.hash && inm === `"p${meta.hash}"`) {
        if (Date.now() - (meta.at || 0) >= TTL_MS) after(rebuildProjectsCache);
        return new Response(null, { status: 304, headers: { ...base, ETag: inm, 'Server-Timing': timing() } });
      }
    }
    const { gz, hash } = await getProjectsGz();
    const etag = `"p${hash}"`;
    const headers = { ...base, ETag: etag, 'Server-Timing': timing() };
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
  try {
    await dbConnect();
    const b = await req.json();
    const queries: string[] = b.queries || (b.query ? [b.query] : []);
    const set: Record<string, unknown> = {};
    if (typeof b.name === 'string') set.name = b.name;
    if (b.folderId !== undefined) set.folderId = b.folderId || null;
    if (queries.length && Object.keys(set).length) {
      const prev = await Project.find({ query: { $in: queries } }).select('query name folderId -_id').lean() as { query: string; name?: string; folderId?: string | null }[];
      await Project.updateMany({ query: { $in: queries } }, { $set: set });
      const events: ActivityInput[] = [];
      const one = queries.length === 1 ? queries[0] : undefined;
      if ('name' in set) events.push({ type: 'project.rename', project: one, n: queries.length,
        title: one ? `Project renamed: “${prev[0]?.name || one}” → “${set.name}”` : `${queries.length} projects renamed to “${set.name}”`,
        data: { to: set.name, projects: prev.map((p) => ({ query: p.query, from: p.name })) } });
      if ('folderId' in set) {
        const ids = [...new Set([set.folderId, ...prev.map((p) => p.folderId)].filter(Boolean))] as string[];
        const names = new Map((await Folder.find({ folderId: { $in: ids } }).select('folderId name -_id').lean() as { folderId: string; name: string }[]).map((f) => [f.folderId, f.name]));
        const dest = set.folderId ? `📁 ${names.get(set.folderId as string) || set.folderId}` : 'root (no folder)';
        events.push({ type: 'project.move', project: one, n: queries.length,
          title: `${queries.length} project${queries.length === 1 ? '' : 's'} moved to ${dest}`,
          data: { to: dest, projects: prev.map((p) => ({ query: p.query, from: p.folderId ? names.get(p.folderId) || p.folderId : 'root' })) } });
      }
      await logActivity(events);
    }
    await invalidateProjectsCache(); // rename/move must show immediately in the sidebar
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'project update failed' }, { status: 500 });
  }
}

// Delete projects + their leads: { query? | queries? }
export async function DELETE(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const queries: string[] = b.queries || (b.query ? [b.query] : []);
    if (queries.length) {
      const counts = await ProjectStat.find({ project: { $in: queries } }).select('project total email -_id').lean() as { project: string; total: number; email: number }[];
      await Project.deleteMany({ query: { $in: queries } });
      const r = await Lead.deleteMany({ project: { $in: queries } });
      await logActivity({ type: 'project.delete', project: queries.length === 1 ? queries[0] : undefined, n: queries.length,
        title: `${queries.length} project${queries.length === 1 ? '' : 's'} deleted with ${r.deletedCount || 0} lead(s)`,
        data: { leadsDeleted: r.deletedCount || 0, projects: queries.map((q) => { const c = counts.find((x) => x.project === q); return { query: q, leads: c?.total ?? null, emails: c?.email ?? null }; }) } });
      await ProjectStat.deleteMany({ project: { $in: queries } });
      await invalidateProjectsCache();
    }
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'project delete failed' }, { status: 500 });
  }
}
