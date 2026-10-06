// One row per email sent, in `outreachsends`. Server code.
//
// The lead holds only its last send (`emailSentAt`, `emailSentTo`) and the
// activity log is append-only, but what happened to an email changes
// afterwards: sent, then bounced or replied, days later. That needs a row that
// can be updated, and the report counts from these rows only, never from `leads`.
//
// This comes beside the lead fields and the `outreach.sent` activity event, not
// instead of them: the lead panel and the Changelog are built on those.
import { dbConnect } from '@/lib/db';
import { OutreachSend } from '@/lib/models';
import { normalizeEmail } from '@/lib/inboxClassify.mjs';
import { domainOf } from '@/lib/suppressionRules.mjs';
import { dayStart } from '@/lib/warmup.mjs';
import { BLOCKING_OUTCOMES, staleBefore } from '@/lib/sendGuard.mjs';

export interface SendRecord {
  project: string;
  dedupKey: string;
  to: string;
  sequenceId?: string;  // '' for an email sent by hand from the lead panel
  stepId?: string;      // the variant that really went out
  senderId?: string;
  messageId?: string;   // as the SMTP library returned it; Gmail may rewrite it on the way out
  language?: string;
  isSeed?: boolean;
  offer?: string;       // the lead's second-round offer, for the report
  sentAt?: string;      // ISO; now when left out
}

// Record an email that went out. Returns the stored send time.
export async function recordSend(s: SendRecord): Promise<string> {
  await dbConnect();
  const to = normalizeEmail(s.to);
  const sentAt = s.sentAt || new Date().toISOString();
  await OutreachSend.create({
    project: String(s.project), dedupKey: String(s.dedupKey),
    sequenceId: String(s.sequenceId || ''), stepId: String(s.stepId || ''), senderId: String(s.senderId || ''),
    messageId: String(s.messageId || ''),
    to, toDomain: domainOf(to), language: String(s.language || ''),
    isSeed: !!s.isSeed, offer: String(s.offer || ''), sentAt,
  });
  return sentAt;
}

// ── The ledger around one send (lib/sendGuard.mjs) ─────────────────────────
// The intent is written down BEFORE the email is handed to the mail server.
// If the process dies after the hand-over and before the bookkeeping, the
// database would otherwise say "not sent" about an email that went out, and
// the next round would send it again.

// Write the `sending` row. Returns its id, for finishSend or failSend.
export async function beginSend(s: SendRecord): Promise<string> {
  await dbConnect();
  const to = normalizeEmail(s.to);
  const doc = await OutreachSend.create({
    project: String(s.project), dedupKey: String(s.dedupKey),
    sequenceId: String(s.sequenceId || ''), stepId: String(s.stepId || ''), senderId: String(s.senderId || ''),
    messageId: '', to, toDomain: domainOf(to), language: String(s.language || ''),
    isSeed: !!s.isSeed, offer: String(s.offer || ''), sentAt: s.sentAt || new Date().toISOString(), outcome: 'sending',
  });
  return String(doc._id);
}

// The mail server took the email: the row becomes `sent`.
export async function finishSend(id: string, messageId: string, now = new Date()): Promise<void> {
  await dbConnect();
  await OutreachSend.updateOne({ _id: id, outcome: 'sending' }, { $set: { outcome: 'sent', messageId: String(messageId || ''), sentAt: now.toISOString() } });
}

// The mail server refused it, so nothing went out: the row becomes `failed`
// and the step may be tried again.
export async function failSend(id: string, now = new Date()): Promise<void> {
  await dbConnect();
  await OutreachSend.updateOne({ _id: id }, { $set: { outcome: 'failed', outcomeAt: now.toISOString() } });
}

// Is there already a row saying this step went out to this lead, or may have?
// Checked after the claim and before the send. `wordingIds` are the step and
// its variants.
export async function priorSendExists(sequenceId: string, dedupKey: string, wordingIds: string[]): Promise<boolean> {
  await dbConnect();
  return !!(await OutreachSend.exists({ dedupKey: String(dedupKey), sequenceId: String(sequenceId), stepId: { $in: wordingIds.map(String) }, outcome: { $in: BLOCKING_OUTCOMES } }));
}

export interface UnknownSend { id: string; project: string; dedupKey: string; sequenceId: string; stepId: string; senderId: string; to: string; sentAt: string; messageId: string }
const asUnknown = (r: Record<string, unknown>): UnknownSend => ({
  id: String(r._id), project: String(r.project || ''), dedupKey: String(r.dedupKey || ''), sequenceId: String(r.sequenceId || ''),
  stepId: String(r.stepId || ''), senderId: String(r.senderId || ''), to: String(r.to || ''), sentAt: String(r.sentAt || ''), messageId: String(r.messageId || ''),
});

// `sending` rows older than ten minutes: their round died somewhere around the
// send. They become `unknown` and are returned, so the caller can park their
// leads. They are never sent again by a machine.
export async function sweepStaleSending(now = new Date()): Promise<UnknownSend[]> {
  await dbConnect();
  const rows = await OutreachSend.find({ outcome: 'sending', sentAt: { $lt: staleBefore(now) } }).limit(200).lean() as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  await OutreachSend.updateMany({ _id: { $in: rows.map((r) => r._id) }, outcome: 'sending' }, { $set: { outcome: 'unknown', outcomeAt: now.toISOString() } });
  return rows.map(asUnknown);
}

// The sends waiting for the operator's decision, oldest first.
export async function listUnknownSends(): Promise<UnknownSend[]> {
  await dbConnect();
  const rows = await OutreachSend.find({ outcome: 'unknown' }).sort({ sentAt: 1 }).limit(200).lean() as unknown as Record<string, unknown>[];
  return rows.map(asUnknown);
}

// Settle one `unknown` row as `sent` or `failed`. Returns the row, or null when
// it was not waiting any more (settled in another tab).
export async function settleUnknownSend(id: string, outcome: 'sent' | 'failed', now = new Date()): Promise<UnknownSend | null> {
  await dbConnect();
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const row = await OutreachSend.findOneAndUpdate({ _id: id, outcome: 'unknown' }, { $set: { outcome, outcomeAt: now.toISOString() } }).lean() as unknown as Record<string, unknown> | null;
  return row ? asUnknown(row) : null;
}

// "Sent today" is always counted from the rows, on the { senderId, sentAt }
// index. There is no counter field and nothing kept in memory: every call of a
// serverless function can be a new instance. The day starts at midnight in the
// warm-up zone, the same moment the daily limit turns over. A refused send
// (`failed`) does not count; one that is being sent, or whose fate is unknown, does.

// Emails each sender sent today: Map(senderId → count). Senders that sent
// nothing are not in it.
export async function sentTodayBySender(now = new Date()): Promise<Map<string, number>> {
  await dbConnect();
  const rows = await OutreachSend.aggregate([
    { $match: { sentAt: { $gte: dayStart(now).toISOString() }, outcome: { $ne: 'failed' } } },
    { $group: { _id: '$senderId', n: { $sum: 1 } } },
  ]) as { _id: string; n: number }[];
  return new Map(rows.map((r) => [r._id, r.n]));
}

// What went out in the last `days` days and what became of it, for the report
// and for the gate: { sent, bounced, blocked, softBounces, replied }. `sent` is
// every email handed to a mail server, the bounced ones among them. There is no
// "delivered" here: an email the server took and that did not come back is
// assumed to have arrived, it was not measured.
export async function outcomeCounts(days = 7, now = new Date()): Promise<{ sent: number; bounced: number; blocked: number; softBounces: number; replied: number }> {
  await dbConnect();
  const rows = await OutreachSend.aggregate([
    // seed emails go to our own test mailboxes: they would only dilute the rates
    { $match: { sentAt: { $gte: new Date(now.getTime() - days * 86_400_000).toISOString() }, outcome: { $nin: ['failed', 'sending'] }, isSeed: { $ne: true } } },
    { $group: { _id: { outcome: '$outcome', bounceKind: '$bounceKind' }, n: { $sum: 1 } } },
  ]) as { _id: { outcome: string; bounceKind?: string }; n: number }[];
  const out = { sent: 0, bounced: 0, blocked: 0, softBounces: 0, replied: 0 };
  for (const r of rows) {
    out.sent += r.n;
    if (r._id.outcome === 'bounced') out.bounced += r.n;
    if (r._id.outcome === 'blocked') out.blocked += r.n;
    if (r._id.outcome === 'replied') out.replied += r.n;
    if (r._id.bounceKind === 'soft') out.softBounces += r.n;
  }
  return out;
}

// The rows of the report, counted: one group per sequence, step, sender, offer
// and outcome, for lib/outreachReport.mjs to fold. `days` 0 = all time. Counted
// from `outreachsends` only, never from `leads`; seed emails are left out and
// counted apart. On the { sentAt } index.
export interface ReportGroup { sequenceId: string; stepId: string; senderId: string; offer: string; outcome: string; bounceKind: string; n: number }
export async function reportGroups(days: number, now = new Date()): Promise<{ groups: ReportGroup[]; seeds: number }> {
  await dbConnect();
  const since = days > 0 ? { sentAt: { $gte: new Date(now.getTime() - days * 86_400_000).toISOString() } } : {};
  const match = { ...since, outcome: { $nin: ['failed', 'sending'] } };
  const [rows, seeds] = await Promise.all([
    OutreachSend.aggregate([
      { $match: { ...match, isSeed: { $ne: true } } },
      { $group: { _id: { sequenceId: '$sequenceId', stepId: '$stepId', senderId: '$senderId', offer: '$offer', outcome: '$outcome', bounceKind: '$bounceKind' }, n: { $sum: 1 } } },
    ]) as Promise<{ _id: Partial<ReportGroup>; n: number }[]>,
    OutreachSend.countDocuments({ ...match, isSeed: true }),
  ]);
  return {
    seeds,
    groups: rows.map((r) => ({ sequenceId: r._id.sequenceId || '', stepId: r._id.stepId || '', senderId: r._id.senderId || '', offer: r._id.offer || '', outcome: r._id.outcome || '', bounceKind: r._id.bounceKind || '', n: r.n })),
  };
}

// Each sender's last email on a day before today: Map(senderId → ISO). The
// warm-up needs it to see an account that fell silent (lib/warmup.mjs). Looks
// back 90 days; an account silent for longer is on its first tiers again anyway.
export async function lastSentBeforeToday(now = new Date()): Promise<Map<string, string>> {
  await dbConnect();
  const rows = await OutreachSend.aggregate([
    { $match: { sentAt: { $lt: dayStart(now).toISOString(), $gte: new Date(now.getTime() - 90 * 86_400_000).toISOString() }, outcome: { $ne: 'failed' } } },
    { $group: { _id: '$senderId', last: { $max: '$sentAt' } } },
  ]) as { _id: string; last: string }[];
  return new Map(rows.map((r) => [r._id, r.last]));
}

// Emails sent in the last seven days, per sequence: Map(sequenceId → count).
// For the sequence list. Counted from the rows, on the { sentAt } index.
export async function sentLast7BySequence(now = new Date()): Promise<Map<string, number>> {
  await dbConnect();
  const rows = await OutreachSend.aggregate([
    { $match: { sentAt: { $gte: new Date(now.getTime() - 7 * 86_400_000).toISOString() }, outcome: { $nin: ['failed', 'sending'] } } },
    { $group: { _id: '$sequenceId', n: { $sum: 1 } } },
  ]) as { _id: string; n: number }[];
  return new Map(rows.map((r) => [r._id, r.n]));
}

// Emails sent so far per step of every sequence: Map(sequenceId → { stepId: count }).
// A wording variant is a step id of its own here, which is what lets the
// editor and the report tell the wordings of one step apart.
export async function sentByStep(): Promise<Map<string, Record<string, number>>> {
  await dbConnect();
  const rows = await OutreachSend.aggregate([
    { $match: { sequenceId: { $gt: '' }, outcome: { $nin: ['failed', 'sending'] } } },
    { $group: { _id: { sequenceId: '$sequenceId', stepId: '$stepId' }, n: { $sum: 1 } } },
  ]) as { _id: { sequenceId: string; stepId: string }; n: number }[];
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const steps = out.get(r._id.sequenceId) || {};
    steps[r._id.stepId] = r.n;
    out.set(r._id.sequenceId, steps);
  }
  return out;
}

// The same for one sender, for the moment right before a send.
export async function countSentToday(senderId: string, now = new Date()): Promise<number> {
  await dbConnect();
  return OutreachSend.countDocuments({ senderId: String(senderId), sentAt: { $gte: dayStart(now).toISOString() }, outcome: { $ne: 'failed' } });
}
