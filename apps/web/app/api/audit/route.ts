// Email audit — the database side of the extension's "Email audit" page.
// The extension does the actual website lookups (in the user's browser); this
// route tells it what is missing where, hands out the per-project work queue
// and stores what it found.
//
// NOT in the middleware's OPEN_API list on purpose: it reads lead data and
// writes emails, so it needs the gl_auth session. The extension calls it with
// credentials (you must be logged in to the web app in the same browser).
//
//   POST { action: 'list', q?, limit?, skip? }      → projects, most open work first
//   POST { action: 'queue', project, retry? }       → that project's leads to look up
//   POST { action: 'results', project, results[] }  → save lookups, return fresh counts
import { dbConnect } from '@/lib/db';
import { Lead, ProjectStat, CORS, json } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const empty = (f: string) => ({ $in: [{ $ifNull: [f, ''] }, ['']] });
const sumIf = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });
const HAS_SITE = { $eq: ['$websiteStatus', 'HAS_WEBSITE'] };

// What is missing, per project. Every lead without an email falls into exactly
// one of: todo (has a site, never checked) / checkedNone / checkedError / noSite.
const AUDIT_GROUP = {
  $group: {
    _id: '$project',
    total: { $sum: 1 },
    email: sumIf({ $not: [empty('$email')] }),
    todo: sumIf({ $and: [empty('$email'), HAS_SITE, empty('$emailCheckedAt')] }),
    checkedNone: sumIf({ $and: [empty('$email'), HAS_SITE, { $not: [empty('$emailCheckedAt')] }, { $ne: ['$emailStatus', 'error'] }] }),
    checkedError: sumIf({ $and: [empty('$email'), HAS_SITE, { $not: [empty('$emailCheckedAt')] }, { $eq: ['$emailStatus', 'error'] }] }),
    noSite: sumIf({ $and: [empty('$email'), { $not: [HAS_SITE] }] }),
    noPhone: sumIf(empty('$phone')),
    noAddress: sumIf(empty('$address')),
    noCategory: sumIf(empty('$category')),
    noRating: sumIf({ $eq: [{ $ifNull: ['$rating', null] }, null] }),
  },
};

async function auditRows(projects: string[]) {
  if (!projects.length) return [];
  const rows = await Lead.aggregate([{ $match: { project: { $in: projects } } }, AUDIT_GROUP]);
  const by = new Map((rows as any[]).map((r) => [r._id, r]));
  // keep the caller's order; a project with no leads still gets a (zero) row
  return projects.map((p) => {
    const r = by.get(p) || {};
    return {
      query: p, name: p, total: r.total || 0, email: r.email || 0, todo: r.todo || 0,
      checkedNone: r.checkedNone || 0, checkedError: r.checkedError || 0, noSite: r.noSite || 0,
      noPhone: r.noPhone || 0, noAddress: r.noAddress || 0, noCategory: r.noCategory || 0, noRating: r.noRating || 0,
    };
  });
}

// Open email work per project from the precomputed counters. Projects counted
// before emailTodo existed fall back to an upper bound (site, no email).
const TODO_EXPR = { $ifNull: ['$emailTodo', { $max: [0, { $subtract: ['$total', { $add: ['$noWebsite', '$email'] }] }] }] };

export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();

    if (b.action === 'list') {
      const limit = Math.max(1, Math.min(200, Number(b.limit) || 100));
      const skip = Math.max(0, Number(b.skip) || 0);
      const words = String(b.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = words.length ? [{ $match: { $and: words.map((w) => ({ project: new RegExp(esc(w), 'i') })) } }] : [];

      const [page, totals] = await Promise.all([
        ProjectStat.aggregate([
          ...match,
          { $addFields: { todo: TODO_EXPR } },
          { $sort: { todo: -1, project: 1 } },
          { $skip: skip }, { $limit: limit },
          { $project: { _id: 0, project: 1 } },
        ]),
        ProjectStat.aggregate([
          ...match,
          { $group: { _id: null, projects: { $sum: 1 }, total: { $sum: '$total' }, email: { $sum: '$email' }, noWebsite: { $sum: '$noWebsite' }, todo: { $sum: TODO_EXPR } } },
        ]),
      ]);
      const rows = await auditRows((page as { project: string }[]).map((p) => p.project));
      const t = (totals as any[])[0] || { projects: 0, total: 0, email: 0, noWebsite: 0, todo: 0 };
      return json({ ok: true, rows, totals: { projects: t.projects, total: t.total, email: t.email, noWebsite: t.noWebsite, todo: t.todo }, more: skip + rows.length < t.projects });
    }

    if (b.action === 'queue') {
      if (!b.project) return json({ ok: false, error: 'project required' }, { status: 400 });
      const match: Record<string, unknown> = { project: b.project, email: { $in: ['', null] }, websiteStatus: 'HAS_WEBSITE' };
      if (!b.retry) match.emailCheckedAt = { $in: ['', null] };
      const docs = await Lead.find(match).sort({ opportunityScore: -1, _id: 1 }).limit(5000)
        .select('dedupKey name website -_id').lean();
      return json({ ok: true, rows: (docs as any[]).map((d) => ({ key: d.dedupKey, name: d.name, website: d.website })) });
    }

    if (b.action === 'results') {
      const results: any[] = Array.isArray(b.results) ? b.results.slice(0, 1000) : [];
      if (!b.project || !results.length) return json({ ok: false, error: 'project and results required' }, { status: 400 });
      const keys = results.map((r) => String(r.key || ''));
      const cur = await Lead.find({ project: b.project, dedupKey: { $in: keys } }).select('dedupKey name website email phone -_id').lean();
      const have = new Map((cur as any[]).map((d) => [d.dedupKey, d]));
      const at = new Date().toISOString();
      const ops: any[] = [];
      const saved: string[] = [];
      const detail: Record<string, unknown>[] = []; // one line per checked lead, for the Changelog
      for (const r of results) {
        const lead = have.get(String(r.key || ''));
        if (!lead) continue; // moved/deleted since the queue was handed out
        const status = ['found', 'none', 'error', 'social', 'no_site'].includes(r.status) ? r.status : 'none';
        const set: Record<string, unknown> = { emailCheckedAt: at, emailStatus: status, emailError: status === 'error' ? String(r.error || '').slice(0, 120) : '' };
        const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
        // never overwrite an address that is already there (e.g. from the AI lead search)
        if (status === 'found' && !lead.email && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
          set.email = email;
          set.emails = (Array.isArray(r.emails) ? r.emails : [email]).filter((e: unknown) => typeof e === 'string').slice(0, 5);
          set.emailSource = String(r.source || '').slice(0, 500);
          saved.push(lead.dedupKey);
        }
        if (!lead.phone && typeof r.phone === 'string' && r.phone.trim()) set.phone = r.phone.trim().slice(0, 40);
        detail.push({
          key: lead.dedupKey, name: lead.name, website: lead.website, status,
          ...(set.email ? { email: set.email, source: set.emailSource, emails: set.emails } : {}),
          ...(status === 'found' && !set.email ? { note: 'not saved — lead already had ' + lead.email } : {}),
          ...(status === 'error' ? { error: set.emailError } : {}),
          ...(set.phone ? { phone: set.phone } : {}),
        });
        ops.push({ updateOne: { filter: { project: b.project, dedupKey: lead.dedupKey }, update: { $set: set } } });
      }
      // Native driver on purpose: every value above is already validated, and a
      // dev server that hot-reloaded this file keeps the OLD Lead schema cached,
      // whose strict mode silently strips the new email* fields.
      if (ops.length) await Lead.collection.bulkWrite(ops, { ordered: false });
      await recomputeProjectStats([b.project]); // email + emailTodo counters changed
      const [row] = await auditRows([b.project]);
      if (detail.length) {
        const none = detail.filter((d) => d.status !== 'found' && d.status !== 'error').length;
        const failed = detail.filter((d) => d.status === 'error').length;
        const had = detail.filter((d) => d.status === 'found').length - saved.length;
        await logActivity({
          type: 'email.audit', project: b.project, source: 'extension', n: saved.length, keys: detail.map((d) => String(d.key)),
          title: `Email audit: ${detail.length} website${detail.length === 1 ? '' : 's'} checked → ${saved.length} email${saved.length === 1 ? '' : 's'} saved, ${none} none, ${failed} failed${had ? `, ${had} already had one` : ''}`,
          data: { checked: detail.length, found: saved.length, none, failed, alreadyHadEmail: had, leads: detail },
        });
      }
      return json({ ok: true, updated: ops.length, saved, row });
    }

    return json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'audit failed' }, { status: 500 });
  }
}
