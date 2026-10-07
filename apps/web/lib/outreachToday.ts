// The day at a glance, for the Campaign tab: whether sending is allowed, who is
// in line for today and what will become of each, and what went out already.
// Read-only. The send round (lib/dispatcher.ts) decides on its own at every
// call; this only shows what it will find, by the same rules.
import { dbConnect } from '@/lib/db';
import { Lead, OutreachSend, OutreachSender, OutreachSequence } from '@/lib/models';
import { campaignState } from '@/lib/campaignState';
import type { CampaignState } from '@/lib/campaignState';
import { readHeartbeat } from '@/lib/dispatcher';
import { dayStart } from '@/lib/warmup.mjs';
import { isInsideWindow, nextOpening, windowOf } from '@/lib/sendWindow.mjs';
import { minGapMs } from '@/lib/dispatchPlan.mjs';

// Per sender. A day's limit is 100 at most, so this is the whole day and more.
const QUEUE_LIMIT = 200;
const SENT_LIMIT = 300;

// today: goes out today · hours: today, once it is a sending hour where the lead is ·
// next: after midnight in Budapest, on tomorrow's limit, while it is still a sending hour where the lead is ·
// limit: the sender's limit of today is used up before its turn ·
// closed: no sending hour left today where the lead is · off: its sequence is switched off
export type QueueFate = 'today' | 'hours' | 'next' | 'limit' | 'closed' | 'off';
export interface QueueRow {
  project: string; dedupKey: string; name: string; to: string;
  sequenceId: string; sequence: string; step: number; steps: number;
  senderId: string; dueAt: string; tz: string; fate: QueueFate; opensAt: string;
  expectedAt: string; // when the send round is likely to reach it: after its due time, the sender's pause and the leads before it. '' when no time can be given
}
export interface SentRow { to: string; sentAt: string; outcome: string; sequence: string; step: number; senderId: string; seed: boolean }
export interface TodayPlan {
  gate: CampaignState['gate'];
  heartbeat: { lastTickAt: string; action: string; reason: string; sentToday: number; stale: boolean };
  senders: { senderId: string; label: string; fromEmail: string; capToday: number; sentToday: number; left: number; queued: number; more: boolean }[];
  sequences: { sequenceId: string; name: string; language: string; enabled: boolean; steps: number }[];
  queue: QueueRow[];
  sent: SentRow[];
  at: string;
}

interface SequenceDoc { sequenceId: string; name?: string; language?: string; enabled?: boolean; steps?: { id: string; variantOf?: string }[] }
interface QueueLead { project: string; dedupKey: string; name?: string; lat?: number; lng?: number; country?: string; address?: string; seq?: { to?: string; sequenceId?: string; stepId?: string; nextStepAt?: string; tz?: string } }

// "step 2 of 4": a wording variant counts as the step it is a variant of
function stepNumber(sequence: SequenceDoc | undefined, stepId: string): { step: number; steps: number } {
  const all = sequence?.steps || [];
  const main = all.filter((s) => !s.variantOf);
  const hit = all.find((s) => s.id === stepId);
  return { step: main.findIndex((s) => s.id === (hit?.variantOf || stepId)) + 1, steps: main.length };
}

export async function todayPlan(now = new Date()): Promise<TodayPlan> {
  await dbConnect();
  const heartbeat = await readHeartbeat(now);
  const start = dayStart(now) as Date;
  const endOfDay = new Date(start.getTime() + 24 * 3_600_000);
  const [state, senderDocs, sequenceDocs, sentDocs] = await Promise.all([
    campaignState(heartbeat.lastTickAt, now),
    OutreachSender.find({ active: true }).select('senderId sendDays windowFrom windowTo -_id').lean() as unknown as Promise<{ senderId: string }[]>,
    OutreachSequence.find().select('sequenceId name language enabled steps.id steps.variantOf -_id').lean() as unknown as Promise<SequenceDoc[]>,
    OutreachSend.find({ sentAt: { $gte: start.toISOString() } }).sort({ sentAt: -1 }).limit(SENT_LIMIT)
      .select('to sentAt outcome sequenceId stepId senderId isSeed -_id').lean() as unknown as Promise<{ to?: string; sentAt?: string; outcome?: string; sequenceId?: string; stepId?: string; senderId?: string; isSeed?: boolean }[]>,
  ]);
  const sequenceOf = new Map(sequenceDocs.map((s) => [s.sequenceId, s]));
  const windowOfSender = new Map(senderDocs.map((s) => [s.senderId, s]));

  const queue: QueueRow[] = [];
  const senders: TodayPlan['senders'] = [];
  for (const s of state.senders) {
    const window = windowOfSender.get(s.senderId);
    const left = Math.max(0, s.capToday - s.sentToday);
    // through the partial index, a projection, in the order the send round takes them
    const leads = !window ? [] : await Lead.find({ 'seq.senderId': s.senderId, 'seq.status': 'active', 'seq.nextStepAt': { $lte: endOfDay.toISOString() } })
      .hint('gl_seq_due').sort({ 'seq.nextStepAt': 1 }).limit(QUEUE_LIMIT + 1)
      .select('project dedupKey name lat lng country address seq.to seq.sequenceId seq.stepId seq.nextStepAt seq.tz -_id').lean() as unknown as QueueLead[];
    const more = leads.length > QUEUE_LIMIT;
    if (more) leads.length = QUEUE_LIMIT;
    let turn = 0; // its place among the leads that can go at all
    // A sender pauses between two emails (lib/dispatchPlan.mjs), so "due" is not
    // "goes now": each lead's turn comes one pause after the one before it.
    const w = windowOf(window) as { from: number; to: number };
    const gap = minGapMs(s.capToday, w.to - w.from) as number;
    const last = !window ? null : await OutreachSend.findOne({ senderId: s.senderId, outcome: { $ne: 'failed' } }).sort({ sentAt: -1 }).select('sentAt -_id').lean() as { sentAt?: string } | null;
    const lastAt = Date.parse(last?.sentAt || '');
    let free = Math.max(now.getTime(), Number.isFinite(lastAt) ? lastAt + gap : 0); // when the sender may send again
    // "Today" is the sender's calendar day in Budapest, because the daily limit
    // turns over at Budapest midnight. A lead in California still has sending
    // hours left when that day ends; it goes out after midnight, on tomorrow's limit.
    const gapTomorrow = minGapMs(s.capTomorrow, w.to - w.from) as number;
    const endOfTomorrow = endOfDay.getTime() + 24 * 3_600_000;
    let turnTomorrow = 0;
    for (const lead of leads) {
      const sequence = sequenceOf.get(lead.seq?.sequenceId || '');
      const opens = nextOpening(lead, window, now) as Date | null;
      const due = Date.parse(lead.seq?.nextStepAt || '') || 0;
      let fate: QueueFate = 'closed';
      let expectedAt = '';
      if (!sequence?.enabled) fate = 'off';
      else if (opens) {
        // its turn today: after the sender's pause, its own due time and the opening of its window
        const at = Math.max(free, due, opens.getTime());
        if (turn < left && at < endOfDay.getTime() && isInsideWindow(lead, window, new Date(at))) {
          fate = isInsideWindow(lead, window, now) ? 'today' : 'hours';
          expectedAt = new Date(at).toISOString(); free = at + gap; turn++;
        } else {
          // not today: the first sending hour where it is, after midnight here
          const later = nextOpening(lead, window, new Date(Math.max(free, due, endOfDay.getTime()))) as Date | null;
          if (later && later.getTime() < endOfTomorrow && turnTomorrow < s.capTomorrow) {
            fate = 'next'; expectedAt = later.toISOString(); free = later.getTime() + gapTomorrow; turnTomorrow++;
          } else fate = turn >= left ? 'limit' : 'closed';
        }
      }
      queue.push({
        project: lead.project, dedupKey: lead.dedupKey, name: lead.name || lead.dedupKey, to: lead.seq?.to || '',
        sequenceId: lead.seq?.sequenceId || '', sequence: sequence?.name || 'A deleted sequence', ...stepNumber(sequence, lead.seq?.stepId || ''),
        senderId: s.senderId, dueAt: lead.seq?.nextStepAt || '', tz: lead.seq?.tz || '', fate, opensAt: opens ? opens.toISOString() : '', expectedAt,
      });
    }
    senders.push({ senderId: s.senderId, label: s.label, fromEmail: s.fromEmail, capToday: s.capToday, sentToday: s.sentToday, left, queued: leads.length, more });
  }

  return {
    gate: state.gate, heartbeat, senders, queue,
    sequences: sequenceDocs.map((s) => ({ sequenceId: s.sequenceId, name: s.name || s.sequenceId, language: s.language || 'en', enabled: !!s.enabled, steps: (s.steps || []).filter((x) => !x.variantOf).length })),
    sent: sentDocs.map((r) => ({
      to: r.to || '', sentAt: r.sentAt || '', outcome: r.outcome || '', senderId: r.senderId || '', seed: !!r.isSeed,
      sequence: sequenceOf.get(r.sequenceId || '')?.name || '', step: stepNumber(sequenceOf.get(r.sequenceId || ''), r.stepId || '').step,
    })),
    at: now.toISOString(),
  };
}
