// Writes a lead's sequence state (`seq`) when something happens to it: a step
// went out, or the sequence stopped. Server code.
//
// What the next state is, is decided in lib/outreachSequence.mjs (planAdvance,
// statusForStop). This file only writes it and logs it, and it is the only
// place that does: the dispatcher and the dashboard both come through here, so
// "what is next, and when" cannot be written twice and drift apart.
import { dbConnect } from '@/lib/db';
import { Lead } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { planAdvance, statusForStop } from '@/lib/outreachSequence.mjs';
import { VARIABLE_FIELDS } from '@/lib/outreachRender.mjs';
import { afterSendError, claimFilter, claimUpdate } from '@/lib/sendGuard.mjs';

// What these helpers need of a lead.
export interface SeqLead { project: string; dedupKey: string; name?: string; seq?: { stepId?: string; sequenceId?: string; errorCount?: number } }
export interface SeqSequence { sequenceId: string; name?: string; steps?: unknown[] }

// A step went out to this lead: record it and move the lead on.
// `sentStepId` is the step that really went out (a variant, when one was picked).
// Returns false when the lead was not waiting for that step any more, which is
// what a second, overlapping dispatcher round would find: nothing is written
// then, so a step is never advanced twice.
// `from` is the status the lead must be in: 'active' for a normal send, 'hold'
// when the operator decides that an email of unknown fate did go out.
// `also` are further lead fields of the same send (emailSentAt, emailSentTo,
// the thread's subject): written in this one update, so a round that dies right
// after it cannot leave the lead moved on but without its thread.
export async function advanceSequence(lead: SeqLead, sequence: SeqSequence, sentStepId: string, messageId: string, now = new Date(), from: 'active' | 'hold' = 'active', also: Record<string, string> = {}): Promise<boolean> {
  await dbConnect();
  const plan = planAdvance(sequence, sentStepId, now);
  const r = await Lead.updateOne(
    // still in that status and still on the step the caller read
    { project: lead.project, dedupKey: lead.dedupKey, 'seq.status': from, 'seq.stepId': String(lead.seq?.stepId || '') },
    {
      $set: {
        ...also,
        'seq.stepId': plan.stepId,
        'seq.nextStepAt': plan.nextStepAt,
        'seq.status': plan.status,
        'seq.lastSentAt': now.toISOString(),
        'seq.lastMessageId': String(messageId || ''),
        'seq.claimedAt': '',
        'seq.errorCount': 0,
      },
      $addToSet: { 'seq.sentStepIds': String(sentStepId) },
    },
  );
  if (!r.modifiedCount) return false;
  const who = lead.name || lead.dedupKey;
  await logActivity({
    type: 'outreach.step', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
    title: plan.status === 'finished'
      ? `${who}: last step of "${sequence.name || sequence.sequenceId}" sent, sequence finished`
      : plan.status === 'waiting'
      ? `${who}: opening email of "${sequence.name || sequence.sequenceId}" sent; the follow-ups wait until you start them`
      : `${who}: step sent in "${sequence.name || sequence.sequenceId}", next in ${plan.delayDays} ${plan.delayDays === 1 ? 'day' : 'days'}`,
    data: { name: lead.name, sequenceId: sequence.sequenceId, sentStepId, nextStepId: plan.stepId, nextStepAt: plan.nextStepAt, status: plan.status },
  });
  return true;
}

// A step could not be sent to this lead (a variable it uses has no value for
// the lead, say): leave the step out and move the lead on to the next one,
// which may use other variables. The sequence does not stop over one step.
// `why` are the sentences of the preflight. Nothing is added to `sentStepIds`:
// the step did not go out. Returns false when the lead was not waiting for
// that step any more.
export async function skipStep(lead: SeqLead, sequence: SeqSequence, stepId: string, why: string[], now = new Date()): Promise<boolean> {
  await dbConnect();
  const plan = planAdvance(sequence, stepId, now);
  const r = await Lead.updateOne(
    { project: lead.project, dedupKey: lead.dedupKey, 'seq.status': 'active', 'seq.stepId': String(stepId) },
    { $set: { 'seq.stepId': plan.stepId, 'seq.nextStepAt': plan.nextStepAt, 'seq.status': plan.status, 'seq.claimedAt': '' } },
  );
  if (!r.modifiedCount) return false;
  const who = lead.name || lead.dedupKey;
  await logActivity({
    type: 'outreach.skip', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
    title: `${who}: a step of "${sequence.name || sequence.sequenceId}" was not sent. ${why.join(' ')}${plan.status === 'finished' ? ' It was the last step, the sequence is finished.' : ''}`,
    data: { name: lead.name, sequenceId: sequence.sequenceId, skippedStepId: stepId, why, nextStepId: plan.stepId, nextStepAt: plan.nextStepAt, status: plan.status },
  });
  return true;
}

// A lead whose send the mail server refused is tried again after this long.
const RETRY_AFTER_MS = 10 * 60_000;

// ── The claim: one round at a time works on a lead (lib/sendGuard.mjs) ─────

// Take the lead for this round, in one atomic update. false is the normal
// answer when another round already has it, or the step is in its history:
// not an error, just "not yours".
export async function claimLead(lead: SeqLead, stepId: string, wordingIds: string[], now = new Date()): Promise<boolean> {
  await dbConnect();
  const r = await Lead.updateOne(claimFilter({ project: lead.project, dedupKey: lead.dedupKey, stepId, wordingIds }, now), claimUpdate(now));
  return r.modifiedCount === 1;
}

// Let go of a lead that was claimed but not sent to (its window closed, a
// check held it back). It stays due.
export async function releaseClaim(lead: SeqLead): Promise<void> {
  await dbConnect();
  await Lead.updateOne({ project: lead.project, dedupKey: lead.dedupKey }, { $set: { 'seq.claimedAt': '' } });
}

// The mail server refused the email, so nothing went out. The lead stays due
// and is tried again; the third failure in a row takes it out of the queue.
// Returns the status it ends in.
export async function recordSendError(lead: SeqLead, sequenceName: string): Promise<string> {
  await dbConnect();
  const next = afterSendError(lead.seq?.errorCount);
  await Lead.updateOne(
    { project: lead.project, dedupKey: lead.dedupKey, 'seq.status': 'active' },
    // tried again, but not on the very next round: a sender that is locked out would burn the three tries in two minutes
    { $set: { 'seq.errorCount': next.errorCount, 'seq.status': next.status, 'seq.claimedAt': '', 'seq.nextStepAt': next.status === 'failed' ? '' : new Date(Date.now() + RETRY_AFTER_MS).toISOString() } },
  );
  if (next.status === 'failed') {
    await logActivity({
      type: 'outreach.error', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
      title: `${lead.name || lead.dedupKey}: taken out of "${sequenceName}" after ${next.errorCount} failed sends in a row`,
      data: { name: lead.name, sequenceId: lead.seq?.sequenceId || '', errorCount: next.errorCount },
    });
  }
  return next.status;
}

// A lead on hold whose sequence is gone cannot move on to a next step: it ends here.
export async function stopHeldLead(project: string, dedupKey: string): Promise<boolean> {
  await dbConnect();
  const r = await Lead.updateOne({ project, dedupKey, 'seq.status': 'hold' }, { $set: { 'seq.status': 'stopped', 'seq.claimedAt': '', 'seq.nextStepAt': '' } });
  return r.modifiedCount === 1;
}

// An email to this lead may or may not have gone out. Park the lead: it leaves
// the queue (and the `gl_seq_due` index) until the operator decides.
export async function holdLead(project: string, dedupKey: string): Promise<void> {
  await dbConnect();
  await Lead.updateOne({ project, dedupKey, 'seq.status': 'active' }, { $set: { 'seq.status': 'hold', 'seq.claimedAt': '' } });
}

// The operator decided the email did not go out: the step is due again, now.
export async function retryHeldLead(project: string, dedupKey: string, now = new Date()): Promise<boolean> {
  await dbConnect();
  const r = await Lead.updateOne({ project, dedupKey, 'seq.status': 'hold' }, { $set: { 'seq.status': 'active', 'seq.claimedAt': '', 'seq.nextStepAt': now.toISOString() } });
  return r.modifiedCount === 1;
}

// Take one lead out of its sequence. `reason` says why ('replied', 'bounced',
// 'unsubscribed', 'manual', ...); it decides the end status. Returns false when
// the lead had no active sequence.
export async function stopSequence(lead: SeqLead, reason: string): Promise<boolean> {
  await dbConnect();
  const status = statusForStop(reason);
  // a lead that waits for its follow-ups is in the sequence too, and is taken out the same way
  const r = await Lead.updateOne(
    { project: lead.project, dedupKey: lead.dedupKey, 'seq.status': { $in: ['active', 'waiting'] } },
    { $set: { 'seq.status': status, 'seq.nextStepAt': '' } },
  );
  if (!r.modifiedCount) return false;
  await logActivity({
    type: 'outreach.stopped', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
    title: `${lead.name || lead.dedupKey}: sequence stopped (${reason || 'stopped'})`,
    data: { name: lead.name, sequenceId: lead.seq?.sequenceId || '', reason, status },
  });
  return true;
}

// Take every lead out of one sequence, when the sequence itself goes away: a
// lead must not stay active under a sequence id that no longer exists. Reads
// and writes only the active leads, through the partial index `gl_seq_due`.
// Returns how many were stopped.
export async function stopSequenceLeads(sequenceId: string, sequenceName: string, reason: string): Promise<number> {
  await dbConnect();
  const r = await Lead.updateMany(
    { 'seq.status': 'active', 'seq.sequenceId': String(sequenceId) },
    { $set: { 'seq.status': statusForStop(reason), 'seq.nextStepAt': '' } },
    { hint: 'gl_seq_due' },
  );
  const n = r.modifiedCount || 0;
  if (n) {
    await logActivity({
      type: 'outreach.stopped', n, source: 'system',
      title: `${n} ${n === 1 ? 'lead' : 'leads'} taken out of "${sequenceName || sequenceId}" (${reason})`,
      data: { sequenceId, reason },
    });
  }
  return n;
}

// Leads in an active sequence, per sequence: Map(sequenceId → count). One read
// of the active set through `gl_seq_due`, counted here: a $group over `leads`
// is not allowed, and the active set is the size of the running campaign, not
// of the collection. Stops at `cap` leads; `capped` says so.
export async function activeLeadCounts(cap = 50_000): Promise<{ counts: Map<string, number>; capped: boolean }> {
  await dbConnect();
  const rows = await Lead.find({ 'seq.status': 'active' }).hint('gl_seq_due').select('seq.sequenceId -_id').limit(cap + 1).lean() as unknown as { seq?: { sequenceId?: string } }[];
  const counts = new Map<string, number>();
  for (const r of rows.slice(0, cap)) {
    const id = r.seq?.sequenceId || '';
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { counts, capped: rows.length > cap };
}

// The leads active in one sequence, with where each stands and the fields the
// template variables read. For the editor: what a save will do to them, and how
// many of them lack a value a text uses. Through `gl_seq_due`, up to `cap` leads.
export interface ActiveSeqLead { project: string; dedupKey: string; stepId: string; sentStepIds: string[]; [field: string]: unknown }
export async function activeLeadsOfSequence(sequenceId: string, cap = 5000): Promise<{ leads: ActiveSeqLead[]; capped: boolean }> {
  await dbConnect();
  const rows = await Lead.find({ 'seq.status': 'active', 'seq.sequenceId': String(sequenceId) }).hint('gl_seq_due')
    .select(['project', 'dedupKey', 'seq.stepId', 'seq.sentStepIds', ...VARIABLE_FIELDS, '-_id'].join(' ')).limit(cap + 1).lean() as unknown as (Record<string, unknown> & { seq?: { stepId?: string; sentStepIds?: string[] } })[];
  const leads = rows.slice(0, cap).map(({ seq, ...rest }) => ({ ...rest, stepId: seq?.stepId || '', sentStepIds: seq?.sentStepIds || [] }) as ActiveSeqLead);
  return { leads, capped: rows.length > cap };
}
