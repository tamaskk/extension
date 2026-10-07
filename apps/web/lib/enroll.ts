// Putting leads into a sequence, and taking them out. Server code.
//
// Who goes in is decided by the pure rules of lib/enrollPlan.mjs; this file
// reads what those rules need and writes the result. It writes `seq` on many
// leads at once, on live data, so it never runs without a preview first: the
// same function produces the preview (dryRun) and the real run, chunk by chunk.
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { dbConnect } from '@/lib/db';
import { Lead, LeadGroup, OutreachSend, OutreachSequence, ProjectStat, Suppression } from '@/lib/models';
import { activityColl, logActivity } from '@/lib/activity';
import { leadMatch, HAS_EMAIL } from '@/lib/leadMatch';
import { parseProjectGeo } from '@/lib/projectGeo';
import { listSenders } from '@/lib/outreachSenders';
import { activeCompanyDomains } from '@/lib/companyDomains';
import { SKIP_REASONS, addSkipped, enrolmentBlock, pickEmail, planEnrollment } from '@/lib/enrollPlan.mjs';
import { planContinue } from '@/lib/outreachSequence.mjs';
import { companyDomainOf } from '@/lib/dispatchPlan.mjs';
import { lookupKeys } from '@/lib/suppressionRules.mjs';
import { mxLookup } from '@/lib/mxCheck';

// One request handles this many candidates: a function has 60 seconds, so a
// long run is driven by the client, one chunk per call (ARCHITECTURE §04).
export const CHUNK = 500;
export const MAX_LIMIT = 10_000;
// A preview stops reading after this many candidates or this long; it says so.
const PREVIEW_SCAN = 20_000;
const BUDGET_MS = 40_000;

// The three ways to pick leads, all existing notions of the dashboard: the lead
// table's current filter (its query string, as GET /api/leads gets it), the
// checked leads, or a saved group.
// Which of these addresses, and of their company domains, got a sequence email
// before: one query for the chunk, on the `to` and `toDomain` indexes of
// `outreachsends`. Seed emails and refused sends do not count.
async function mailedAmong(leads: Candidate[]): Promise<(email: string, domain: string) => boolean> {
  const emails = new Set<string>(), domains = new Set<string>();
  for (const l of leads) {
    const e = pickEmail(l);
    if (!e) continue;
    emails.add(e);
    const d = companyDomainOf(e);
    if (d) domains.add(d);
  }
  if (!emails.size) return () => false;
  const rows = await OutreachSend.find({ $or: [{ to: { $in: [...emails] } }, { toDomain: { $in: [...domains] } }], isSeed: { $ne: true }, outcome: { $ne: 'failed' } }).select('to toDomain -_id').lean() as { to?: string; toDomain?: string }[];
  const hitEmails = new Set(rows.map((r) => r.to || ''));
  const hitDomains = new Set(rows.map((r) => r.toDomain || '').filter((d) => domains.has(d)));
  return (email, domain) => hitEmails.has(email) || (!!domain && hitDomains.has(domain));
}

// `keys` is the fourth: leads named one by one, as the Campaign tab's suggestions are.
export type EnrollSource = { kind: 'filter'; query: string } | { kind: 'checked' } | { kind: 'group'; groupId: string } | { kind: 'keys'; keys: string[] };
export const MAX_KEYS = 200;

export interface EnrollRequest {
  action: 'enroll' | 'unenroll' | 'continue';
  dryRun: boolean;
  sequenceId: string;
  source: EnrollSource;
  limit: number;
  ignoreLanguage: boolean;
  cursor: string;   // '' on the first call; the `cursor` of the previous answer after that
  runId: string;    // '' on the first call of a real run
  taken: number;    // leads written so far in this run
}

type Skipped = Record<string, number>;
export interface EnrollAnswer {
  ok: boolean; error?: string;
  dryRun?: boolean;
  matched?: number;      // leads the selection holds (the lead table's total for the same filter)
  examined?: number;     // candidates read so far
  complete?: boolean;    // preview only: false when it stopped before reading every candidate
  wouldTake?: number;    // preview: leads that would go in
  enrolled?: number;     // real run: leads written by this call
  taken?: number;        // real run: leads written so far
  skipped?: Skipped;
  byLanguage?: Record<string, number>;
  bySender?: { senderId: string; label: string; n: number }[];
  samples?: { name: string; to: string; project: string; sender: string }[];
  done?: boolean;
  cursor?: string;
  runId?: string;
}

async function sourceMatch(source: EnrollSource): Promise<Record<string, unknown>> {
  if (source.kind === 'checked') return { checked: true };
  if (source.kind === 'keys') return { dedupKey: { $in: source.keys } };
  if (source.kind === 'group') {
    const g = await LeadGroup.findOne({ groupId: source.groupId }).select('keys -_id').lean() as { keys?: string[] } | null;
    return { dedupKey: { $in: g?.keys || [] } };
  }
  return leadMatch(new URLSearchParams(source.query));
}

const and = (...parts: Record<string, unknown>[]) => ({ $and: parts.filter((p) => Object.keys(p).length) });
const after = (cursor: string) => (cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {});

interface Candidate { _id: mongoose.Types.ObjectId; project: string; dedupKey: string; name?: string; email?: string; emails?: string[]; lat?: number | null; lng?: number | null; address?: string; seq?: { status?: string }; [field: string]: unknown }
// what the address ranking and the offer routing read, beside the fields above
const RULE_FIELDS = ['website', 'websiteStatus', 'category', 'rating', 'reviewCount', 'phone', 'hasBookingHint', 'aiPainPoints', 'aiSummary', 'sig'];

// The next candidates of a selection, in _id order: stable, so a run can go on
// where the previous call stopped. Leads without an email are left out by the
// query itself; of a million leads only a few percent have one.
async function nextCandidates(match: Record<string, unknown>, cursor: string): Promise<Candidate[]> {
  return Lead.find(and(match, { email: HAS_EMAIL }, after(cursor))).sort({ _id: 1 }).limit(CHUNK)
    .select(['project', 'dedupKey', 'name', 'email', 'emails', 'lat', 'lng', 'address', 'seq.status', ...RULE_FIELDS].join(' ')).lean() as unknown as Candidate[];
}

// Which of these addresses, or their company domains, are on the suppression
// list: one query for the chunk. A failure is thrown and stops the run: without
// the answer nobody may be enrolled.
async function suppressedAmong(leads: Candidate[]): Promise<(email: string, domain: string) => boolean> {
  const emails = new Set<string>(), domains = new Set<string>();
  for (const l of leads) {
    const k = lookupKeys(pickEmail(l));
    if (k.email) emails.add(k.email);
    if (k.domain) domains.add(k.domain);
  }
  if (!emails.size) return () => false;
  const rows = await Suppression.find({ $or: [{ email: { $in: [...emails] } }, { domain: { $in: [...domains] } }] }).select('email domain -_id').lean() as { email: string; domain?: string }[];
  const hitEmails = new Set(rows.filter((r) => !r.domain).map((r) => r.email));
  const hitDomains = new Set(rows.filter((r) => r.domain).map((r) => r.domain as string));
  return (email, domain) => hitEmails.has(email) || (!!domain && hitDomains.has(domain));
}

const countryCache = new Map<string, string>();
function countryOf(project: string): string {
  let c = countryCache.get(project);
  if (c === undefined) { c = parseProjectGeo(project)?.country || ''; countryCache.set(project, c); }
  return c;
}

// One event per run in the Changelog, growing with every chunk: `n` is the
// number of leads enrolled and `keys` their ids, so the event also shows up in
// each lead's own history. Never throws, like logActivity.
async function logEnrollChunk(runId: string, sequence: { sequenceId: string; name?: string }, keys: string[], total: number) {
  try {
    const title = `${total.toLocaleString()} ${total === 1 ? 'lead' : 'leads'} enrolled in "${sequence.name || sequence.sequenceId}"`;
    await (await activityColl()).updateOne(
      { type: 'outreach.enroll', 'data.runId': runId },
      // the cast: the events are free-form documents, so the driver's types do not know that `keys` is an array
      { $set: { ts: new Date(), title, source: 'web', text: title.toLowerCase(), 'data.sequenceId': sequence.sequenceId }, $inc: { n: keys.length }, $push: { keys: { $each: keys } } as never },
      { upsert: true },
    );
  } catch (e) {
    console.warn('[activity] enrol log failed:', e instanceof Error ? e.message : '');
  }
}

export async function runEnrollment(req: EnrollRequest): Promise<EnrollAnswer> {
  await dbConnect();
  const started = Date.now();
  const sequence = await OutreachSequence.findOne({ sequenceId: req.sequenceId }).select('-_id').lean() as unknown as { sequenceId: string; name?: string; language: string; senderIds?: string[]; steps?: unknown[] } | null;
  const senders = await listSenders();
  const block = enrolmentBlock(sequence, senders);
  if (block || !sequence) return { ok: false, error: block || 'The sequence was not found.' };

  const match = await sourceMatch(req.source);
  // Read once per call. It reads through `gl_seq_due` and fails without that
  // index, which stops the run: the one-per-company rule cannot be skipped.
  const busy = await activeCompanyDomains();
  const labelOf = new Map(senders.map((s) => [s.senderId, s.label || s.fromEmail]));

  let cursor = req.cursor, taken = req.taken, examined = 0, exhausted = false;
  let skipped: Skipped = Object.fromEntries(SKIP_REASONS.map((r: string) => [r, 0]));
  const byLanguage: Record<string, number> = {}, bySender: Record<string, number> = {};
  const samples: NonNullable<EnrollAnswer['samples']> = [];
  let enrolled = 0;
  const runId = req.dryRun ? '' : req.runId || randomBytes(6).toString('hex');

  // A real run handles one chunk per call. A preview reads on until it has seen
  // enough leads to fill the limit, or every candidate, or its time is up.
  while (true) {
    const leads = await nextCandidates(match, cursor);
    if (!leads.length) { exhausted = true; break; }
    examined += leads.length;
    cursor = String(leads[leads.length - 1]._id);
    const candidates = leads.map((l) => ({
      ...Object.fromEntries(RULE_FIELDS.map((f) => [f, l[f]])),
      project: l.project, key: l.dedupKey, name: l.name, email: l.email, emails: l.emails, seqStatus: l.seq?.status || '', country: countryOf(l.project), lat: l.lat, lng: l.lng, address: l.address,
    }));
    // Does each address's domain take mail at all? Asked here, once per domain,
    // before the send: the send round has no time to wait for DNS.
    const hasMx = await mxLookup(candidates.map((c) => { const e = pickEmail(c); return e.slice(e.lastIndexOf('@') + 1); }));
    const plan = planEnrollment(
      candidates,
      { sequence, senders, isSuppressed: await suppressedAmong(leads), wasMailed: await mailedAmong(leads), hasMx, busyDomains: busy, ignoreLanguage: req.ignoreLanguage, room: req.limit - taken, now: new Date() },
    ) as unknown as { take: { project: string; key: string; name: string; seq: { to: string; senderId: string } }[]; skipped: Skipped; bySender: Record<string, number>; byLanguage: Record<string, number> };
    skipped = addSkipped(skipped, plan.skipped);
    for (const [k, n] of Object.entries(plan.byLanguage)) byLanguage[k] = (byLanguage[k] || 0) + n;

    let written = plan.take;
    if (!req.dryRun && plan.take.length) {
      // The filter repeats the "not in a sequence" check at write time: a lead
      // that another run enrolled a moment ago is left as it is.
      const r = await Lead.bulkWrite(plan.take.map((t) => ({
        updateOne: { filter: { project: t.project, dedupKey: t.key, 'seq.status': { $ne: 'active' } }, update: { $set: { seq: t.seq } } },
      })), { ordered: false });
      enrolled += r.modifiedCount || 0;
      if ((r.modifiedCount || 0) !== plan.take.length) {
        // Another run got to some of them first. Which ones were written is read
        // back, by the due time this run gave them, so the event names only those.
        const mine = await Lead.find({ dedupKey: { $in: plan.take.map((t) => t.key) }, 'seq.sequenceId': sequence.sequenceId, 'seq.status': 'active', 'seq.nextStepAt': { $in: plan.take.map((t) => (t.seq as { nextStepAt?: string }).nextStepAt || '') } }).select('dedupKey -_id').lean() as { dedupKey: string }[];
        const keys = new Set(mine.map((l) => l.dedupKey));
        written = plan.take.filter((t) => keys.has(t.key));
      }
      await logEnrollChunk(runId, sequence, written.map((t) => t.key), taken + written.length);
    }
    taken += req.dryRun ? plan.take.length : written.length;
    for (const t of plan.take) {
      bySender[t.seq.senderId] = (bySender[t.seq.senderId] || 0) + 1;
      // the domains taken in this call hold for the chunks that follow in it
      const domain = companyDomainOf(t.seq.to);
      if (domain) busy.set(domain, [...(busy.get(domain) || []), t.key]);
      if (samples.length < 10) samples.push({ name: t.name, to: t.seq.to, project: t.project, sender: labelOf.get(t.seq.senderId) || t.seq.senderId });
    }

    if (leads.length < CHUNK) { exhausted = true; break; }
    if (taken >= req.limit) break;
    if (!req.dryRun) break;
    if (examined >= PREVIEW_SCAN || Date.now() - started > BUDGET_MS) break;
  }

  const answer: EnrollAnswer = {
    ok: true, dryRun: req.dryRun, examined, skipped, byLanguage,
    bySender: Object.entries(bySender).map(([senderId, n]) => ({ senderId, label: labelOf.get(senderId) || senderId, n })),
    samples,
  };
  if (req.dryRun) {
    return { ...answer, matched: await Lead.countDocuments(match), wouldTake: taken, complete: exhausted || taken >= req.limit };
  }
  return { ...answer, enrolled, taken, done: exhausted || taken >= req.limit, cursor, runId };
}

// Leads to start with, picked for the operator: the best-scored leads of one
// country that would pass every enrolment rule right now, by the same rules as
// the enrolment itself (planEnrollment), so what is shown is what goes in.
// Writes nothing. `exclude` are leads already shown or turned down.
//
// Read project by project group, not over the whole country: "every lead of
// Hungary with an email, best score first" has no index that answers it, and
// MongoDB sorted tens of thousands of documents in memory (the request never
// came back). The projects with the most emails are read first, a hundred at a
// time, each through gl_project_opp, which is already in score order.
const SUGGEST_PROJECTS = 100; // below the 200 index ranges MongoDB can still merge in sorted order
const SUGGEST_LEADS = 100;
const SUGGEST_GROUPS = 6;
const SUGGEST_QUERY_MS = 15_000;
export interface Suggestion { project: string; key: string; name: string; to: string; sender: string; category: string; score: number | null }
// `region` narrows the country to one of its regions (a US state, or a city of another country: what a project query ends with);
// `place` to the projects whose query names that place (a town of the state, an area of the city). Both optional.
export async function suggestLeads(sequenceId: string, country: string, n: number, exclude: string[], region = '', place = ''): Promise<{ ok: boolean; error?: string; picks?: Suggestion[]; examined?: number; skipped?: Skipped }> {
  await dbConnect();
  const sequence = await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as { sequenceId: string; name?: string; language: string; senderIds?: string[]; steps?: unknown[] } | null;
  const senders = await listSenders();
  const block = enrolmentBlock(sequence, senders);
  if (block || !sequence) return { ok: false, error: block || 'The sequence was not found.' };

  const where = new URLSearchParams({ country });
  if (region) where.append('pregion', region);
  const scope = (await leadMatch(where)).project as { $in?: string[] } | undefined;
  if (!scope || !Array.isArray(scope.$in)) return { ok: false, error: `The projects of ${region || country} could not be listed.` };
  // "<type> near <place…> <region>": the place sits between "near" and the region, as whole words
  const wanted = place.trim().toLowerCase().replace(/\s+/g, ' ');
  const names = wanted ? scope.$in.filter((q) => { const lc = ` ${q.toLowerCase().replace(/\s+/g, ' ')} `; const near = lc.indexOf(' near '); return near >= 0 && lc.indexOf(` ${wanted} `, near + 5) >= 0; }) : scope.$in;
  const withEmail = await ProjectStat.find({ project: { $in: names }, email: { $gt: 0 } }).sort({ email: -1 }).limit(SUGGEST_PROJECTS * SUGGEST_GROUPS).select('project -_id').lean() as { project: string }[];
  const busy = await activeCompanyDomains();
  const labelOf = new Map(senders.map((s) => [s.senderId, s.label || s.fromEmail]));
  const picks: Suggestion[] = [];
  let skipped: Skipped = Object.fromEntries(SKIP_REASONS.map((r: string) => [r, 0]));
  let examined = 0;
  for (let g = 0; g < withEmail.length && picks.length < n; g += SUGGEST_PROJECTS) {
    const projects = withEmail.slice(g, g + SUGGEST_PROJECTS).map((p) => p.project);
    const leads = await Lead.find(and({ project: { $in: projects }, email: HAS_EMAIL }, exclude.length ? { dedupKey: { $nin: exclude } } : {}))
      .hint('gl_project_opp').sort({ opportunityScore: -1, _id: 1 }).limit(SUGGEST_LEADS).maxTimeMS(SUGGEST_QUERY_MS)
      .select(['project', 'dedupKey', 'name', 'email', 'emails', 'lat', 'lng', 'address', 'seq.status', 'opportunityScore', ...RULE_FIELDS].join(' ')).lean() as unknown as Candidate[];
    if (!leads.length) continue;
    examined += leads.length;
    const candidates = leads.map((l) => ({
      ...Object.fromEntries(RULE_FIELDS.map((f) => [f, l[f]])),
      project: l.project, key: l.dedupKey, name: l.name, email: l.email, emails: l.emails, seqStatus: l.seq?.status || '', country: countryOf(l.project), lat: l.lat, lng: l.lng, address: l.address,
    }));
    const hasMx = await mxLookup(candidates.map((c) => { const e = pickEmail(c); return e.slice(e.lastIndexOf('@') + 1); }));
    const plan = planEnrollment(
      candidates,
      { sequence, senders, isSuppressed: await suppressedAmong(leads), wasMailed: await mailedAmong(leads), hasMx, busyDomains: busy, ignoreLanguage: false, room: n - picks.length, now: new Date() },
    ) as unknown as { take: { project: string; key: string; name: string; seq: { to: string; senderId: string } }[]; skipped: Skipped };
    skipped = addSkipped(skipped, plan.skipped);
    const byKey = new Map(leads.map((l) => [l.dedupKey, l]));
    for (const t of plan.take) {
      const domain = companyDomainOf(t.seq.to);
      if (domain) busy.set(domain, [...(busy.get(domain) || []), t.key]);
      const lead = byKey.get(t.key);
      picks.push({ project: t.project, key: t.key, name: t.name || t.key, to: t.seq.to, sender: labelOf.get(t.seq.senderId) || t.seq.senderId, category: String(lead?.category || ''), score: typeof lead?.opportunityScore === 'number' ? lead.opportunityScore : null });
    }
  }
  return { ok: true, picks, examined, skipped };
}

// Take leads out of their sequence: the leads of the selection that are active,
// in `sequenceId` when one is given. Their company domains are free again the
// moment they are no longer active. One chunk per call, as above.
export async function runUnenrollment(req: EnrollRequest): Promise<EnrollAnswer> {
  await dbConnect();
  // running leads and the ones that wait for their follow-ups: both are in a sequence
  const base = and(await sourceMatch(req.source), { 'seq.status': { $in: ['active', 'waiting'] } }, req.sequenceId ? { 'seq.sequenceId': req.sequenceId } : {});
  if (req.dryRun) {
    const rows = await Lead.find(base).limit(req.limit).select('project name seq.to -_id').lean() as unknown as { project: string; name?: string; seq?: { to?: string } }[];
    return {
      ok: true, dryRun: true, wouldTake: rows.length, complete: rows.length < req.limit,
      samples: rows.slice(0, 10).map((r) => ({ name: r.name || '', to: r.seq?.to || '', project: r.project, sender: '' })),
    };
  }
  const room = Math.min(CHUNK, req.limit - req.taken);
  const rows = room > 0 ? await Lead.find(and(base, after(req.cursor))).sort({ _id: 1 }).limit(room).select('dedupKey').lean() as unknown as { _id: mongoose.Types.ObjectId; dedupKey: string }[] : [];
  let stopped = 0;
  if (rows.length) {
    const r = await Lead.updateMany({ _id: { $in: rows.map((x) => x._id) }, 'seq.status': { $in: ['active', 'waiting'] } }, { $set: { 'seq.status': 'stopped', 'seq.nextStepAt': '' } });
    stopped = r.modifiedCount || 0;
    if (stopped) await logActivity({ type: 'outreach.stopped', n: stopped, keys: rows.map((x) => x.dedupKey), title: `${stopped.toLocaleString()} ${stopped === 1 ? 'lead' : 'leads'} taken out of ${stopped === 1 ? 'its' : 'their'} sequence by hand`, data: { reason: 'manual', sequenceId: req.sequenceId } });
  }
  const taken = req.taken + stopped;
  return { ok: true, dryRun: false, enrolled: stopped, taken, done: rows.length < room || taken >= req.limit || room <= 0, cursor: rows.length ? String(rows[rows.length - 1]._id) : req.cursor };
}

// Start the follow-ups: the leads of the selection that got the opening email
// and are waiting become active again on the step they waited for, at scattered
// times. From there the steps follow by their waits, and the daily limits apply
// as to every email. One chunk per call, a preview first, like enrolment.
export async function runContinue(req: EnrollRequest): Promise<EnrollAnswer> {
  await dbConnect();
  const base = and(await sourceMatch(req.source), { 'seq.status': 'waiting' }, req.sequenceId ? { 'seq.sequenceId': req.sequenceId } : {});
  if (req.dryRun) {
    const rows = await Lead.find(base).limit(req.limit).select('project name seq.to -_id').lean() as unknown as { project: string; name?: string; seq?: { to?: string } }[];
    return {
      ok: true, dryRun: true, wouldTake: rows.length, complete: rows.length < req.limit,
      samples: rows.slice(0, 10).map((r) => ({ name: r.name || '', to: r.seq?.to || '', project: r.project, sender: '' })),
    };
  }
  const room = Math.min(CHUNK, req.limit - req.taken);
  const rows = room > 0 ? await Lead.find(and(base, after(req.cursor))).sort({ _id: 1 }).limit(room).select('project dedupKey seq.sequenceId seq.stepId').lean() as unknown as { _id: mongoose.Types.ObjectId; project: string; dedupKey: string; seq?: { sequenceId?: string; stepId?: string } }[] : [];
  const sequences = new Map<string, unknown>();
  const now = new Date();
  const ops = [];
  const started: string[] = [];
  for (const r of rows) {
    const id = r.seq?.sequenceId || '';
    if (!sequences.has(id)) sequences.set(id, await OutreachSequence.findOne({ sequenceId: id }).select('-_id').lean());
    const sequence = sequences.get(id);
    // a sequence that is gone, or has nothing left to send, leaves the lead as it is: nothing is started for it
    const plan = sequence ? planContinue(sequence, r.seq?.stepId || '', now) as { stepId: string; nextStepAt: string; status: string } | null : null;
    if (!plan) continue;
    ops.push({ updateOne: { filter: { _id: r._id, 'seq.status': 'waiting' }, update: { $set: { 'seq.status': plan.status, 'seq.stepId': plan.stepId, 'seq.nextStepAt': plan.nextStepAt, 'seq.claimedAt': '' } } } });
    started.push(r.dedupKey);
  }
  let moved = 0;
  if (ops.length) {
    const w = await Lead.bulkWrite(ops, { ordered: false });
    moved = w.modifiedCount || 0;
    if (moved) await logActivity({ type: 'outreach.continue', n: moved, keys: started, title: `Follow-ups started for ${moved.toLocaleString()} ${moved === 1 ? 'lead' : 'leads'}`, data: { sequenceId: req.sequenceId } });
  }
  const taken = req.taken + moved;
  return { ok: true, dryRun: false, enrolled: moved, taken, done: rows.length < room || taken >= req.limit || room <= 0, cursor: rows.length ? String(rows[rows.length - 1]._id) : req.cursor };
}
