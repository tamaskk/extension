// Scheduling ahead: putting the leads of a selection into their sequences on
// future days, every sender's days filled up to the limit. Server code.
//
// The days and the senders are chosen by the pure rules of lib/schedulePlan.mjs
// and who may go in at all by the rules of lib/enrollPlan.mjs; this file reads
// what they need and writes the result. Two steps, like enrolment: `planSchedule`
// writes nothing and answers the whole plan, lead by lead; `applySchedule` gets
// that plan back in chunks and writes it, checking every lead and every day
// again, because minutes may have passed since the operator saw it.
import { randomBytes } from 'node:crypto';
import { dbConnect } from '@/lib/db';
import { Lead, OutreachSequence } from '@/lib/models';
import { activityColl } from '@/lib/activity';
import { listSenders } from '@/lib/outreachSenders';
import { lastSentBeforeToday } from '@/lib/outreachSends';
import { activeCompanyDomains } from '@/lib/companyDomains';
import { CHUNK, RULE_FIELDS, countryOf, logEnrollChunk, mailedAmong, nextCandidates, sourceMatch, suppressedAmong } from '@/lib/enroll';
import type { Candidate, EnrollSource } from '@/lib/enroll';
import { SKIP_REASONS, addSkipped, eligibleSenders, enrolmentBlock, pickEmail, screenCandidates, seqFor } from '@/lib/enrollPlan.mjs';
import { nextEnabledStep } from '@/lib/outreachSequence.mjs';
import { companyDomainOf } from '@/lib/dispatchPlan.mjs';
import { mxLookup } from '@/lib/mxCheck';
import { dayKey } from '@/lib/warmup.mjs';
import { HORIZON_DAYS, capacityPlan, daysAhead, fillSchedule, roomFor } from '@/lib/schedulePlan.mjs';
import type { OutreachSenderRow } from '@/lib/types';

// One plan holds at most this many leads: it travels to the browser and back.
// A larger selection is scheduled in several runs; each goes on where the last one ended.
export const MAX_PLACED = 3000;
// One call of the write takes this many leads of the plan.
export const APPLY_CHUNK = 200;
// A plan stops reading after this many candidates or this long; it says so.
const PLAN_SCAN = 20_000;
const BUDGET_MS = 40_000;

type Skipped = Record<string, number>;
interface SequenceDoc { sequenceId: string; name?: string; language: string; senderIds?: string[]; steps?: unknown[] }
interface DayRow { day: string; start: number; end: number; cap: number; booked: number; free: number; open: boolean }
interface Passed { c: { project: string; key: string; name?: string }; to: string; language: string; tz: string }
type PlanSender = OutreachSenderRow & { lastSentBeforeToday: string };

export interface ScheduleRequest {
  source: EnrollSource;
  sequences: Record<string, string>;  // language → the sequence its leads go into
  mode: 'range' | 'all';              // range: only the days from `from` to `to` · all: as many days as the selection needs
  from: string; to: string;           // 'YYYY-MM-DD', for `range`
}
export interface Placement { project: string; key: string; name: string; to: string; senderId: string; day: string; at: string }
export interface SchedulePlanAnswer {
  ok: boolean; error?: string;
  mode?: 'range' | 'all'; fromDay?: string; toDay?: string;
  matched?: number;     // leads the selection holds
  examined?: number;    // candidates read
  complete?: boolean;   // false when reading stopped before the end of the selection
  stopped?: '' | 'full' | 'max' | 'budget';  // why it stopped: no room left in the days · the plan's size · the time
  left?: number;        // leads that pass every rule and found no day
  lastDay?: string;     // the last day that gets a lead
  skipped?: Skipped;
  notes?: string[];     // a language that cannot be scheduled, and why
  senders?: { senderId: string; label: string; fromEmail: string; language: string; sequenceId: string; sequence: string }[];
  days?: { day: string; rows: { senderId: string; cap: number; booked: number; free: number; placed: number; open: boolean }[] }[];
  placements?: Placement[];
}
export interface ScheduleApplyRequest { sequences: Record<string, string>; items: { project: string; key: string; senderId: string; at: string }[]; runId: string }
export interface ScheduleApplyAnswer {
  ok: boolean; error?: string;
  written?: number;
  // leads of the chunk that were not written: by the enrolment rule that now fails, `full` when the day got full, `gone` when the lead is not there
  dropped?: Skipped;
  runId?: string;
}

// What both steps start from: the sequence and the senders of each language
// that can be scheduled, and what every sender can still take on every day.
async function setup(sequences: Record<string, string>, now: Date) {
  const ids = Object.values(sequences).filter(Boolean);
  const [docs, all, lastBefore] = await Promise.all([
    OutreachSequence.find({ sequenceId: { $in: ids } }).select('-_id').lean() as unknown as Promise<SequenceDoc[]>,
    listSenders(now),
    lastSentBeforeToday(now),
  ]);
  const notes: string[] = [];
  const byLanguage = new Map<string, { sequence: SequenceDoc; stepId: string }>();
  const senders: PlanSender[] = [];
  for (const [language, sequenceId] of Object.entries(sequences)) {
    if (!sequenceId) continue;
    const sequence = docs.find((d) => d.sequenceId === sequenceId);
    const name = language === 'hu' ? 'Hungarian' : language === 'en' ? 'English' : language;
    const block = sequence && sequence.language !== language ? 'The chosen sequence is in another language.' : enrolmentBlock(sequence, all) as string;
    const first = sequence ? nextEnabledStep(sequence, '') as { step: { id: string } } | null : null;
    if (block || !sequence || !first) { notes.push(`${name} leads are left out. ${block || 'The sequence has no step to send.'}`); continue; }
    byLanguage.set(language, { sequence, stepId: first.step.id });
    for (const s of eligibleSenders(sequence, all) as OutreachSenderRow[]) senders.push({ ...s, lastSentBeforeToday: lastBefore.get(s.senderId) || '' });
  }
  const days = daysAhead(now, HORIZON_DAYS) as { day: string; start: number; end: number }[];
  const capacity = capacityPlan(senders, days, { booked: await bookedDays(senders.map((s) => s.senderId), now), sentToday: new Map(senders.map((s) => [s.senderId, s.sentToday])) }) as Map<string, DayRow[]>;
  return { byLanguage, senders, days, capacity, notes };
}

// The leads already due, per sender and day: Map(senderId → Map(day → count)).
// A lead that is overdue counts on today. Read through `gl_seq_due`, which
// holds all three fields, so no lead document is fetched.
async function bookedDays(senderIds: string[], now: Date): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!senderIds.length) return out;
  const rows = await Lead.find({ 'seq.senderId': { $in: senderIds }, 'seq.status': 'active' }).hint('gl_seq_due')
    .select('seq.senderId seq.nextStepAt -_id').lean() as unknown as { seq?: { senderId?: string; nextStepAt?: string } }[];
  const today = dayKey(now) as string;
  for (const r of rows) {
    const at = Date.parse(r.seq?.nextStepAt || '');
    if (!Number.isFinite(at)) continue;
    const day = at <= now.getTime() ? today : dayKey(new Date(at)) as string;
    const id = r.seq?.senderId || '';
    if (!out.has(id)) out.set(id, new Map());
    const mine = out.get(id) as Map<string, number>;
    mine.set(day, (mine.get(day) || 0) + 1);
  }
  return out;
}

const candidateOf = (l: Candidate) => ({
  ...Object.fromEntries(RULE_FIELDS.map((f) => [f, l[f]])),
  project: l.project, key: l.dedupKey, name: l.name, email: l.email, emails: l.emails, seqStatus: l.seq?.status || '', country: countryOf(l.project), lat: l.lat, lng: l.lng, address: l.address,
});

// Who of these leads may go in right now, by the rules of enrolment.
async function screen(leads: Candidate[], languages: string[], anySequence: SequenceDoc, busy: Map<string, string[]>, now: Date) {
  const candidates = leads.map(candidateOf);
  const hasMx = await mxLookup(candidates.map((c) => { const e = pickEmail(c) as string; return e.slice(e.lastIndexOf('@') + 1); }));
  return screenCandidates(candidates, {
    sequence: anySequence, languages, isSuppressed: await suppressedAmong(leads), wasMailed: await mailedAmong(leads), hasMx, busyDomains: busy, ignoreLanguage: false, now,
  }) as unknown as { passed: Passed[]; skipped: Skipped; byLanguage: Record<string, number> };
}

export async function planSchedule(req: ScheduleRequest): Promise<SchedulePlanAnswer> {
  await dbConnect();
  const started = Date.now();
  const now = new Date();
  const { byLanguage, senders, days, capacity, notes } = await setup(req.sequences, now);
  if (!byLanguage.size) return { ok: false, error: notes.join(' ') || 'Choose a sequence for at least one language.' };
  const today = days[0].day, horizon = days[days.length - 1].day;
  const fromDay = req.mode === 'range' && req.from > today ? req.from : today;
  const toDay = req.mode === 'range' && req.to < horizon ? req.to : horizon;
  if (req.mode === 'range' && (!req.from || !req.to)) return { ok: false, error: 'Choose the first and the last day.' };
  if (fromDay > toDay) return { ok: false, error: req.to < today ? 'The last day is in the past.' : `The first day is after the last one, or more than ${HORIZON_DAYS} days away.` };

  const languages = [...byLanguage.keys()];
  const anySequence = (byLanguage.get(languages[0]) as { sequence: SequenceDoc }).sequence;
  const room = new Map(languages.map((l) => [l, roomFor(l, senders, capacity, fromDay, toDay) as number]));
  const match = await sourceMatch(req.source);
  const busy = await activeCompanyDomains();

  const kept: Passed[] = [];
  let skipped: Skipped = Object.fromEntries(SKIP_REASONS.map((r: string) => [r, 0]));
  let cursor = '', examined = 0, complete = false, overflow = 0;
  let stopped: SchedulePlanAnswer['stopped'] = '';
  while (true) {
    const leads = await nextCandidates(match, cursor);
    if (!leads.length) { complete = true; break; }
    examined += leads.length;
    cursor = String(leads[leads.length - 1]._id);
    const r = await screen(leads, languages, anySequence, busy, now);
    skipped = addSkipped(skipped, r.skipped);
    for (const p of r.passed) {
      const left = room.get(p.language) || 0;
      if (left <= 0 || kept.length >= MAX_PLACED) { overflow++; continue; }
      room.set(p.language, left - 1);
      kept.push(p);
      // the domains taken here hold for the chunks that follow
      const domain = companyDomainOf(p.to) as string;
      if (domain) busy.set(domain, [...(busy.get(domain) || []), p.c.key]);
    }
    if (leads.length < CHUNK) { complete = true; break; }
    if (kept.length >= MAX_PLACED) { stopped = 'max'; break; }
    if (languages.every((l) => (room.get(l) || 0) <= 0)) { stopped = 'full'; break; }
    if (examined >= PLAN_SCAN || Date.now() - started > BUDGET_MS) { stopped = 'budget'; break; }
  }

  const fill = fillSchedule(kept.map((p) => ({ key: p.c.key, language: p.language, tz: p.tz })), senders, capacity, { fromDay, toDay, now }) as unknown as
    { placed: { key: string; senderId: string; day: string; at: string }[]; left: string[]; filled: Map<string, Map<string, number>> };
  const byKey = new Map(kept.map((p) => [p.c.key, p]));
  const placements: Placement[] = fill.placed.map((x) => {
    const p = byKey.get(x.key) as Passed;
    return { project: p.c.project, key: x.key, name: p.c.name || x.key, to: p.to, senderId: x.senderId, day: x.day, at: x.at };
  });
  const lastDay = placements.reduce((d, p) => (p.day > d ? p.day : d), '');
  // the table shows the range that was asked for, or the days the selection needs
  const shownTo = req.mode === 'range' ? toDay : lastDay || fromDay;
  return {
    ok: true, mode: req.mode, fromDay, toDay,
    matched: await Lead.countDocuments(match), examined, complete, stopped,
    left: fill.left.length + overflow, lastDay, skipped, notes,
    senders: senders.map((s) => {
      const sequence = (byLanguage.get(s.language) as { sequence: SequenceDoc }).sequence;
      return { senderId: s.senderId, label: s.label || s.fromEmail, fromEmail: s.fromEmail, language: s.language, sequenceId: sequence.sequenceId, sequence: sequence.name || sequence.sequenceId };
    }),
    days: days.filter((d) => d.day >= fromDay && d.day <= shownTo).map((d) => ({
      day: d.day,
      rows: senders.map((s) => {
        const row = (capacity.get(s.senderId) as DayRow[]).find((x) => x.day === d.day) as DayRow;
        return { senderId: s.senderId, cap: row.cap, booked: row.booked, free: row.free, placed: fill.filled.get(s.senderId)?.get(d.day) || 0, open: row.open };
      }),
    })),
    placements,
  };
}

export async function applySchedule(req: ScheduleApplyRequest): Promise<ScheduleApplyAnswer> {
  await dbConnect();
  const now = new Date();
  const { byLanguage, senders, days, capacity } = await setup(req.sequences, now);
  if (!byLanguage.size) return { ok: false, error: 'The sequences of this plan can no longer take leads. Make a new plan.' };
  const languages = [...byLanguage.keys()];
  const anySequence = (byLanguage.get(languages[0]) as { sequence: SequenceDoc }).sequence;
  const runId = req.runId || randomBytes(6).toString('hex');
  const dropped: Skipped = { full: 0, gone: 0 };

  const leads = await Lead.find({ dedupKey: { $in: req.items.map((i) => i.key) } })
    .select(['project', 'dedupKey', 'name', 'email', 'emails', 'lat', 'lng', 'address', 'seq.status', ...RULE_FIELDS].join(' ')).lean() as unknown as Candidate[];
  const itemOf = new Map(req.items.map((i) => [`${i.project}\n${i.key}`, i]));
  // only the leads the plan names, in the plan's order
  const found = new Map(leads.filter((l) => itemOf.has(`${l.project}\n${l.dedupKey}`)).map((l) => [`${l.project}\n${l.dedupKey}`, l]));
  const ordered = req.items.map((i) => found.get(`${i.project}\n${i.key}`)).filter((l): l is Candidate => !!l);
  dropped.gone = req.items.length - ordered.length;

  const r = await screen(ordered, languages, anySequence, await activeCompanyDomains(), now);
  for (const [reason, n] of Object.entries(r.skipped)) if (n) dropped[reason] = n;

  const free = new Map(senders.map((s) => [s.senderId, new Map((capacity.get(s.senderId) as DayRow[]).map((row) => [row.day, row.free]))]));
  const horizonEnd = days[days.length - 1].end;
  const take: { project: string; key: string; language: string; seq: { nextStepAt: string } }[] = [];
  for (const p of r.passed) {
    const item = itemOf.get(`${p.c.project}\n${p.c.key}`) as ScheduleApplyRequest['items'][number];
    const sender = senders.find((s) => s.senderId === item.senderId && s.language === p.language);
    const at = Date.parse(item.at);
    // a time before today is a plan that was accepted after midnight: the lead is due at once, on today's room
    const day = at < days[0].start ? days[0].day : dayKey(new Date(at)) as string;
    const room = sender && at < horizonEnd ? free.get(sender.senderId)?.get(day) || 0 : 0;
    if (!sender || room <= 0) { dropped.full++; continue; }
    (free.get(sender.senderId) as Map<string, number>).set(day, room - 1);
    const to = byLanguage.get(p.language) as { sequence: SequenceDoc; stepId: string };
    take.push({ project: p.c.project, key: p.c.key, language: p.language, seq: seqFor(p, to.sequence, to.stepId, sender.senderId, new Date(at).toISOString()) as { nextStepAt: string } });
  }

  let written = take;
  if (take.length) {
    // The filter repeats the screening's status checks at write time: a plan can be
    // accepted minutes after it was made, and a lead that replied or was put on
    // hold since then must not get a new opening email.
    const w = await Lead.bulkWrite(take.map((t) => ({
      updateOne: { filter: { project: t.project, dedupKey: t.key, 'seq.status': { $nin: ['active', 'hold', 'waiting', 'replied'] } }, update: { $set: { seq: t.seq } } },
    })), { ordered: false });
    if ((w.modifiedCount || 0) !== take.length) {
      // another run got to some of them first: which ones are ours is read back by the due time this run gave them
      const mine = await Lead.find({ dedupKey: { $in: take.map((t) => t.key) }, 'seq.status': 'active', 'seq.nextStepAt': { $in: take.map((t) => t.seq.nextStepAt) } }).select('dedupKey -_id').lean() as { dedupKey: string }[];
      const keys = new Set(mine.map((l) => l.dedupKey));
      written = take.filter((t) => keys.has(t.key));
      dropped.active = (dropped.active || 0) + take.length - written.length;
    }
    // one Changelog event per run and language, growing with every chunk
    for (const language of languages) {
      const keys = written.filter((t) => t.language === language).map((t) => t.key);
      if (!keys.length) continue;
      const id = `${runId}-${language}`;
      const before = await (await activityColl()).findOne({ type: 'outreach.enroll', 'data.runId': id }, { projection: { n: 1 } }).catch(() => null) as { n?: number } | null;
      await logEnrollChunk(id, (byLanguage.get(language) as { sequence: SequenceDoc }).sequence, keys, (before?.n || 0) + keys.length);
    }
  }
  return { ok: true, written: written.length, dropped, runId };
}
