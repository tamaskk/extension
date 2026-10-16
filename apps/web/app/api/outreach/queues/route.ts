import { CORS, Lead, OutreachSender, OutreachSequence, json } from '@/lib/models';
import { dbConnect } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { dayKey } from '@/lib/warmup.mjs';
import { parseDay } from '@/lib/schedulePlan.mjs';
import { staleBefore } from '@/lib/sendGuard.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The page lists every lead, so the answer is cut here; `capped` says when it was.
const MAX_ROWS = 5000;

interface DueLead { project: string; dedupKey: string; name?: string; seq?: { senderId?: string; sequenceId?: string; stepId?: string; nextStepAt?: string; to?: string } }
interface SequenceDoc { sequenceId: string; name?: string; steps?: { id: string; variantOf?: string }[] }

// The day a due time is listed on: its Budapest day; today when it is overdue.
const queueDay = (at: number, now: Date, today: string) => (at <= now.getTime() ? today : dayKey(new Date(at)) as string);

// GET /api/outreach/queues
// The Queues tab: the leads that are due in a sequence, by day and sender
// account. A day is a Budapest day, like the daily limit; a lead that is
// overdue counts on today. Only the next email of a lead is known: a
// follow-up gets its day when the email before it has gone out.
// → { ok, today, capped, days: [{ day, total, senders: [{ senderId, label, rows: [{ project, key, name, to, at, sequence, step }] }] }] }
// Read-only.
export async function GET() {
  try {
    await dbConnect();
    const now = new Date();
    const today = dayKey(now) as string;
    const [senders, sequences] = await Promise.all([
      OutreachSender.find().select('senderId label fromEmail -_id').lean() as unknown as Promise<{ senderId: string; label?: string; fromEmail?: string }[]>,
      OutreachSequence.find().select('sequenceId name steps.id steps.variantOf -_id').lean() as unknown as Promise<SequenceDoc[]>,
    ]);
    // the sender ids are named so the query can use gl_seq_due, as lib/schedule.ts does
    const leads = senders.length ? await Lead.find({ 'seq.senderId': { $in: senders.map((s) => s.senderId) }, 'seq.status': 'active' }).hint('gl_seq_due')
      .sort({ 'seq.nextStepAt': 1 }).limit(MAX_ROWS + 1)
      .select('project dedupKey name seq.senderId seq.sequenceId seq.stepId seq.nextStepAt seq.to -_id').lean() as unknown as DueLead[] : [];

    const sequenceOf = new Map(sequences.map((q) => [q.sequenceId, q]));
    // "Email 2 of 4": variants are other wordings of a step, not steps of their own
    const stepLabel = (sequenceId: string, stepId: string) => {
      const steps = (sequenceOf.get(sequenceId)?.steps || []).filter((x) => !x.variantOf);
      const at = steps.findIndex((x) => x.id === stepId);
      return at < 0 ? '' : `Email ${at + 1} of ${steps.length}`;
    };
    const days = new Map<string, Map<string, { project: string; key: string; name: string; to: string; at: string; sequence: string; step: string }[]>>();
    for (const l of leads.slice(0, MAX_ROWS)) {
      const at = Date.parse(l.seq?.nextStepAt || '');
      if (!Number.isFinite(at)) continue;
      const day = queueDay(at, now, today);
      const senderId = l.seq?.senderId || '';
      const sequenceId = l.seq?.sequenceId || '';
      if (!days.has(day)) days.set(day, new Map());
      const bySender = days.get(day) as Map<string, { project: string; key: string; name: string; to: string; at: string; sequence: string; step: string }[]>;
      if (!bySender.has(senderId)) bySender.set(senderId, []);
      (bySender.get(senderId) as { project: string; key: string; name: string; to: string; at: string; sequence: string; step: string }[]).push({
        project: l.project, key: l.dedupKey, name: l.name || l.dedupKey, to: l.seq?.to || '', at: new Date(at).toISOString(),
        sequence: sequenceOf.get(sequenceId)?.name || sequenceId, step: stepLabel(sequenceId, l.seq?.stepId || ''),
      });
    }
    const labelOf = new Map(senders.map((s) => [s.senderId, s.label || s.fromEmail || s.senderId]));
    return json({
      ok: true, today, capped: leads.length > MAX_ROWS,
      days: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, bySender]) => ({
        day,
        total: [...bySender.values()].reduce((n, rows) => n + rows.length, 0),
        senders: [...bySender.entries()].map(([senderId, rows]) => ({ senderId, label: labelOf.get(senderId) || senderId, rows }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      })),
    });
  } catch (e) {
    console.error('outreach queues failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The queues could not be loaded. If this repeats, check that the gl_seq_due index exists.' }, { status: 500 });
  }
}

// DELETE /api/outreach/queues  { day: 'YYYY-MM-DD', senderId, leads: [{ project, key, at }] }
// Deletes one queue: the leads of that sender account are taken out of their
// sequence, as unenrolment does (`seq.status` becomes 'stopped'). No lead is
// deleted, and they can be scheduled again. Only the leads the page showed are
// touched, and only while their due time is still the one it showed: a page
// left open past midnight, or a lead that went out and moved on to its next
// step in the meantime, must not stop more than the operator confirmed. A lead
// a live send round holds is left alone: its email may be on its way.
// → { ok, removed }
export async function DELETE(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => null);
    const day = parseDay(b?.day) as string;
    const senderId = typeof b?.senderId === 'string' ? b.senderId.slice(0, 80) : '';
    // what the page listed, by `project|key` → the due time it showed
    const shown = new Map<string, number>();
    for (const x of (Array.isArray(b?.leads) ? b.leads : []).slice(0, MAX_ROWS)) {
      const at = Date.parse(typeof x?.at === 'string' ? x.at : '');
      if (typeof x?.project === 'string' && typeof x?.key === 'string' && Number.isFinite(at)) shown.set(`${x.project}|${x.key}`, at);
    }
    if (!day || !senderId || !shown.size) return json({ ok: false, error: 'Name the day, the sender account and the leads of the queue.' }, { status: 400 });
    await dbConnect();
    const now = new Date();
    const free = [{ 'seq.claimedAt': { $in: ['', null] } }, { 'seq.claimedAt': { $lt: staleBefore(now) } }];
    const leads = await Lead.find({ 'seq.senderId': senderId, 'seq.status': 'active', $or: free }).hint('gl_seq_due')
      .select('project dedupKey seq.nextStepAt').lean() as unknown as { _id: unknown; project: string; dedupKey: string; seq?: { nextStepAt?: string } }[];
    const mine = leads.filter((l) => shown.get(`${l.project}|${l.dedupKey}`) === Date.parse(l.seq?.nextStepAt || ''));
    let removed = 0;
    if (mine.length) {
      // one update per lead, each on the due time it had when it was read, so a lead a round moved on since is not stopped
      const r = await Lead.bulkWrite(mine.map((l) => ({
        updateOne: {
          filter: { _id: l._id, 'seq.senderId': senderId, 'seq.status': 'active', 'seq.nextStepAt': l.seq?.nextStepAt, $or: free },
          update: { $set: { 'seq.status': 'stopped', 'seq.nextStepAt': '' } },
        },
      })), { ordered: false });
      removed = r.modifiedCount || 0;
      if (removed) await logActivity({ type: 'outreach.stopped', n: removed, keys: mine.map((l) => l.dedupKey), title: `${removed.toLocaleString()} ${removed === 1 ? 'lead' : 'leads'} taken out of ${removed === 1 ? 'its' : 'their'} sequence: the queue of ${day} was deleted`, data: { reason: 'manual', senderId, day } });
    }
    return json({ ok: true, removed });
  } catch (e) {
    console.error('outreach queue delete failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The queue could not be deleted.' }, { status: 500 });
  }
}
