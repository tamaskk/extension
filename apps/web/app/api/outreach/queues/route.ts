import { CORS, Lead, OutreachSender, OutreachSequence, json } from '@/lib/models';
import { dbConnect } from '@/lib/db';
import { dayKey } from '@/lib/warmup.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The page lists every lead, so the answer is cut here; `capped` says when it was.
const MAX_ROWS = 5000;

interface DueLead { project: string; dedupKey: string; name?: string; seq?: { senderId?: string; sequenceId?: string; stepId?: string; nextStepAt?: string; to?: string } }
interface SequenceDoc { sequenceId: string; name?: string; steps?: { id: string; variantOf?: string }[] }

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
      const day = at <= now.getTime() ? today : dayKey(new Date(at)) as string;
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
