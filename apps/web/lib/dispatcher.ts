// One round of the outreach loop: decide whether anything may be sent right
// now, and send at most a few emails. Server code. It sends real email.
//
// The runner tab (components/OutreachRunner.tsx) calls this every 30 to 60
// seconds and only schedules; every decision is taken here, on every call. A
// round sends at most three emails and one per sender: the 60 second limit is
// never near, the rhythm is a person's and not a machine gun's, and a round
// that goes wrong goes wrong on three emails, not fifty.
//
// The order around one email is fixed (lib/sendGuard.mjs): claim the lead →
// write a `sending` row → hand the email to the mail server → turn the row into
// `sent` and move the lead on. Whatever fails, the answer is a sentence for the
// tab; the mail server's own words stay on the server.
import nodemailer from 'nodemailer';
import { dbConnect } from '@/lib/db';
import { Lead, OutreachSend, OutreachSender, OutreachSequence } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import mongoose from 'mongoose';
import { readCache, writeCache } from '@/lib/cache';
import { open } from '@/lib/secretBox.mjs';
import { isSuppressed } from '@/lib/suppression';
import { activeCompanyDomains } from '@/lib/companyDomains';
import { beginSend, failSend, finishSend, lastSentBeforeToday, sentTodayBySender, sweepStaleSending } from '@/lib/outreachSends';
import { campaignState } from '@/lib/campaignState';
import { advanceSequence, claimLead, holdLead, recordSendError, releaseClaim, skipStep, stopSequence } from '@/lib/outreachState';
import { stepById } from '@/lib/outreachSequence.mjs';
import { pickVariant } from '@/lib/outreachVariant.mjs';
import { VARIABLE_FIELDS, isKnownVariable, render, renderContext, variablesIn } from '@/lib/outreachRender.mjs';
import { preflight } from '@/lib/outreachPreflight.mjs';
import { buildMessage } from '@/lib/outreachMessage.mjs';
import { footerFor, withFooter } from '@/lib/outreachFooter.mjs';
import { domainHeldByAnother, gapState, minGapMs } from '@/lib/dispatchPlan.mjs';
import { dailyCapFor } from '@/lib/warmup.mjs';
import { ALL_ZONES, isInsideWindow, runLimits, windowOf, zonesOpenNow } from '@/lib/sendWindow.mjs';
import { mailEndpointAllowed } from '@/lib/outreachSenderRules.mjs';
import { BLOCKING_OUTCOMES, sendFailureKind, staleBefore } from '@/lib/sendGuard.mjs';
import { DEFAULT_DELAY_MS } from '@/lib/outreachRunner.mjs';

export const MAX_PER_ROUND = 3;
// A sender's round lock left behind by a round that died is free again after this long.
const SENDER_LOCK_MS = 90_000;
// The same for the lock of the whole round.
const ROUND_LOCK_MS = 90_000;
// Leads of a step whose text is at fault are looked at again after this long.
const TEXT_FAULT_RETRY_MS = 6 * 3_600_000;
// How long the tab waits when there was nothing to do.
const IDLE_DELAY_MS = 2 * 60_000;
// The runner's heartbeat lives in `caches` under this key.
const RUNNER_KEY = 'outreach:runner';
// A loop that died gives no error, only silence: after this long without a
// round the heartbeat counts as stale.
const STALE_HEARTBEAT_MS = 10 * 60_000;

export interface RoundOptions { ignoreWindow: boolean; testMode: boolean }
export interface RoundResult {
  ok: boolean;
  blocked?: boolean;      // the gate is shut: nothing may be sent today
  blockers?: string[];
  sent: number;
  skipped: number;        // leads looked at and not sent to (a step left out, a sequence stopped)
  remaining: number;      // leads still due for the senders that had room
  nextAt: string;         // when the tab should ask again
  nextInMs: number;
  reason: string;         // a sentence for the tab
  action: 'sent' | 'skip';
  sentToday: number;      // emails sent today, all senders
}

interface SenderDoc {
  senderId: string; label?: string; fromName?: string; fromEmail: string; language?: string;
  smtpHost?: string; smtpPort?: number; authUser?: string; authSecret?: string; footer?: string;
  firstSendAt?: string; dailyLimit?: number; warmup?: unknown; sendDays?: number[]; windowFrom?: number; windowTo?: number; lastTickAt?: string;
  lastSentBeforeToday?: string; // filled in by the round, for the warm-up's idle step-back
}
interface SeqState { sequenceId?: string; stepId?: string; senderId?: string; to?: string; tz?: string; language?: string; offer?: string; threadSubject?: string; lastMessageId?: string; errorCount?: number }
interface DueLead { project: string; dedupKey: string; name?: string; category?: string; seq?: SeqState; [field: string]: unknown }
interface StepDoc { id: string; subject?: string; body?: string; sameThread?: boolean; enabled?: boolean; variantOf?: string }
interface SequenceDoc { sequenceId: string; name?: string; language?: string; enabled?: boolean; steps?: StepDoc[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const errorCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'no code');

// ── The heartbeat ─────────────────────────────────────────────────────────

// the `caches` collection itself, for the one update lib/cache.ts has no helper for: the round lock
async function cachesColl() {
  await dbConnect();
  return mongoose.connection.db!.collection<{ key: string; roundLockAt?: number }>('caches');
}

async function writeHeartbeat(at: Date, action: string, reason: string, sentToday: number) {
  await writeCache(RUNNER_KEY, { data: { lastTickAt: at.toISOString(), action, reason, sentToday }, at: at.getTime() });
}

// When the loop last ran, for the watchdog.
export async function readHeartbeat(now = new Date()) {
  const doc = await readCache(RUNNER_KEY);
  const d = (doc?.data || {}) as { lastTickAt?: string; action?: string; reason?: string; sentToday?: number };
  return { lastTickAt: d.lastTickAt || '', action: d.action || '', reason: d.reason || '', sentToday: d.sentToday || 0, stale: !doc?.at || now.getTime() - doc.at > STALE_HEARTBEAT_MS };
}

// ── One lead ──────────────────────────────────────────────────────────────

type Outcome = { kind: 'sent' | 'skipped' | 'none' | 'error'; note: string };

interface RoundContext {
  now: Date;
  sequences: Map<string, SequenceDoc | null>;
  domains: Map<string, string[]> | null;
  checkWindow: boolean;
}

async function sequenceOf(ctx: RoundContext, sequenceId: string): Promise<SequenceDoc | null> {
  if (!ctx.sequences.has(sequenceId)) {
    ctx.sequences.set(sequenceId, await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as SequenceDoc | null);
  }
  return ctx.sequences.get(sequenceId) || null;
}

async function handleLead(lead: DueLead, sender: SenderDoc, send: (message: Record<string, unknown>) => Promise<{ messageId?: string }>, ctx: RoundContext): Promise<Outcome> {
  const { now } = ctx;
  const who = lead.name || lead.dedupKey;
  const seq = lead.seq || {};
  const ref = { project: lead.project, dedupKey: lead.dedupKey, name: lead.name, seq };

  const sequence = await sequenceOf(ctx, String(seq.sequenceId || ''));
  if (!sequence) {
    await stopSequence(ref, 'sequence_deleted');
    return { kind: 'skipped', note: `${who}: its sequence no longer exists, taken out.` };
  }
  if (!sequence.enabled) return { kind: 'none', note: `"${sequence.name}" is switched off, its leads wait.` };
  const step = stepById(sequence, seq.stepId) as StepDoc | null;
  if (!step || step.variantOf) {
    await stopSequence(ref, 'step_deleted');
    return { kind: 'skipped', note: `${who}: the step it was waiting for was deleted, taken out of "${sequence.name}".` };
  }
  if (ctx.checkWindow && !isInsideWindow(lead, sender, now)) return { kind: 'none', note: `${who}: outside sending hours where the lead is.` };

  // every wording of the step, switched on or not: none of them may be in the lead's history
  const wordingIds = [step.id, ...(sequence.steps || []).filter((s) => s.variantOf === step.id).map((s) => s.id)];
  if (!await claimLead(ref, step.id, wordingIds, now)) return { kind: 'none', note: `${who}: another round is working on it, or it already got this step.` };

  let attempted = false;
  try {
    if (!step.enabled) {
      await skipStep(ref, sequence, step.id, ['The step is switched off.'], now);
      return { kind: 'skipped', note: `${who}: the step is switched off, moved on to the next one.` };
    }
    const to = String(seq.to || '');
    // throws when the list cannot be read; then nothing is sent to this lead
    if (await isSuppressed(to)) {
      await stopSequence(ref, 'suppressed');
      return { kind: 'skipped', note: `${who}: the address is on the suppression list, taken out.` };
    }
    if (!ctx.domains) ctx.domains = await activeCompanyDomains();
    if (domainHeldByAnother(ctx.domains, to, lead.dedupKey)) {
      await stopSequence(ref, 'company_domain');
      return { kind: 'skipped', note: `${who}: another lead of the same company is in a sequence, taken out.` };
    }

    // A row that says this step went out, or may have, although the lead still
    // waits for it: a round died between the send and the bookkeeping.
    const prior = await OutreachSend.findOne({ dedupKey: lead.dedupKey, sequenceId: sequence.sequenceId, stepId: { $in: wordingIds }, outcome: { $in: BLOCKING_OUTCOMES } })
      .select('outcome stepId messageId -_id').lean() as { outcome?: string; stepId?: string; messageId?: string } | null;
    if (prior) {
      if (prior.outcome === 'sending') return { kind: 'none', note: `${who}: an earlier send is still open.` }; // the claim stays until the sweep settles it
      if (prior.outcome === 'unknown') {
        await holdLead(lead.project, lead.dedupKey);
        return { kind: 'skipped', note: `${who}: an earlier send may have gone out; waiting for your decision.` };
      }
      await advanceSequence(ref, sequence, String(prior.stepId || step.id), String(prior.messageId || ''), now);
      return { kind: 'skipped', note: `${who}: this step was already sent, the lead was moved on.` };
    }

    const wording = (pickVariant(sequence.steps, step.id, lead.dedupKey) || step) as StepDoc;
    const values = renderContext(lead);
    const threaded = !!step.sameThread && !!String(seq.threadSubject || '').trim();
    const subject = render(wording.subject || '', values);
    const body = render(wording.body || '', values);
    // the footer is in the lead's language, not the sender's
    const lang = String(seq.language || sequence.language || 'en');
    const footer = footerFor(lang);
    const text = withFooter(body.out, lang);
    const finalSubject = threaded ? `Re: ${String(seq.threadSubject).trim()}` : subject.out;
    const check = preflight({
      subject: finalSubject, text, footer, to,
      // the subject of a step that continues the thread is not used, so a gap in it does not matter
      missing: threaded ? body.missing : [...subject.missing, ...body.missing],
      sequenceLanguage: sequence.language, category: lead.category,
      usesCategory: variablesIn(`${threaded ? '' : wording.subject || ''}\n${wording.body || ''}`).includes('category'),
    }) as { ok: boolean; blocks: string[]; warnings: string[] };
    if (!check.ok) {
      const gaps = threaded ? body.missing : [...subject.missing, ...body.missing];
      // A value this lead lacks is the lead's own gap: the step is left out for
      // it and it moves on. Anything else is a fault of the text (a mistyped
      // variable, braces left in, no footer) and would be the same for every
      // lead: skipping would walk the whole sequence past the step, with no
      // way back. Those leads keep the step and are looked at again later.
      const ownGap = gaps.length > 0 && gaps.every((v: string) => isKnownVariable(v)) && !check.blocks.some((b) => /Double braces|footer/.test(b));
      if (ownGap) {
        await skipStep(ref, sequence, step.id, check.blocks, now);
        return { kind: 'skipped', note: `${who}: step left out. ${check.blocks.join(' ')}` };
      }
      await Lead.updateOne({ project: lead.project, dedupKey: lead.dedupKey, 'seq.status': 'active' }, { $set: { 'seq.claimedAt': '', 'seq.nextStepAt': new Date(now.getTime() + TEXT_FAULT_RETRY_MS).toISOString() } });
      return { kind: 'error', note: `A step of "${sequence.name}" cannot be sent as it is written, to anyone: ${check.blocks.join(' ')} Fix the text; its leads wait.` };
    }

    const message = buildMessage({ sender, to, subject: subject.out, text, sameThread: step.sameThread, threadSubject: seq.threadSubject, lastMessageId: seq.lastMessageId });
    const sendId = await beginSend({ project: lead.project, dedupKey: lead.dedupKey, to, sequenceId: sequence.sequenceId, stepId: wording.id, senderId: sender.senderId, language: sequence.language, offer: seq.offer, sentAt: now.toISOString() });
    attempted = true;
    let info: { messageId?: string };
    try {
      info = await send(message);
    } catch (e) {
      // the library's message can carry the login name and the server's answer: only its code is logged
      console.error('outreach send failed', sender.senderId, errorCode(e));
      if (sendFailureKind(e) === 'refused') {
        await failSend(sendId);
        const status = await recordSendError(ref, sequence.name || '');
        return { kind: 'error', note: status === 'failed' ? `${who}: the mail server refused the email for the third time, taken out of the queue.` : `${who}: the mail server refused the email. It stays due and is tried again.` };
      }
      // It may have gone out. Never again by a machine: the row and the lead wait for the operator.
      await OutreachSend.updateOne({ _id: sendId, outcome: 'sending' }, { $set: { outcome: 'unknown', outcomeAt: new Date().toISOString() } });
      await holdLead(lead.project, lead.dedupKey);
      return { kind: 'error', note: `${who}: the connection broke during the send. The email may have gone out; it waits for your decision.` };
    }

    const messageId = String(info.messageId || '');
    const sentAt = new Date();
    await finishSend(sendId, messageId, sentAt);
    // The lead panel is built on emailSentAt and emailSentTo, and the next step
    // of the thread on its subject: they go into the same update that moves the lead on.
    await advanceSequence(ref, sequence, wording.id, messageId, sentAt, 'active', { emailSentAt: sentAt.toISOString(), emailSentTo: to, ...(threaded ? {} : { 'seq.threadSubject': String(message.subject) }) });
    if (!sender.firstSendAt) {
      // the warm-up days count from the first email that really went out
      await OutreachSender.updateOne({ senderId: sender.senderId, firstSendAt: { $in: ['', null] } }, { $set: { firstSendAt: sentAt.toISOString() } });
      sender.firstSendAt = sentAt.toISOString();
    }
    await logActivity({
      type: 'outreach.sent', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
      title: `${who}: email sent to ${to}`,
      data: { name: lead.name, to, subject: message.subject, body: text, sequenceId: sequence.sequenceId, stepId: wording.id, senderId: sender.senderId, messageId, warnings: check.warnings },
    });
    return { kind: 'sent', note: `${who}: sent from ${sender.fromEmail}${check.warnings.length ? ` (${check.warnings.join(' ')})` : ''}` };
  } catch (e) {
    console.error('outreach round: lead failed', errorCode(e), e instanceof Error ? e.message.slice(0, 200) : '');
    // Before the hand-over nothing went out, so the lead is free again. After
    // it the claim stays: the `sending` row decides what happens next.
    if (!attempted) await releaseClaim(ref).catch(() => undefined);
    return { kind: 'error', note: `${who}: this lead could not be handled in this round.` };
  }
}

// ── The round ─────────────────────────────────────────────────────────────

export async function runRound(opts: RoundOptions, now = new Date()): Promise<RoundResult> {
  await dbConnect();
  let sentBefore = await sentTodayBySender(now);
  let sentToday = [...sentBefore.values()].reduce((a, b) => a + b, 0);
  // The gate judges the loop by the heartbeat from BEFORE this round: a loop
  // that was silent decided nothing on fresh numbers.
  const before = await readHeartbeat(now);
  // First of all, and always: an idle night must not look like a dead loop.
  await writeHeartbeat(now, 'skip', 'Round started.', sentToday);

  const answer = (r: Partial<RoundResult> & { reason: string; nextInMs: number }): RoundResult => ({
    ok: true, sent: 0, skipped: 0, remaining: 0, action: (r.sent || 0) > 0 ? 'sent' : 'skip', sentToday,
    nextAt: new Date(now.getTime() + r.nextInMs).toISOString(), ...r,
  });

  // One round at a time. The claim keeps two rounds from sending the same email,
  // but two rounds side by side still use up the day's limits twice as fast, and
  // the runner is a browser tab that is easily opened twice. The lock is a field
  // on the heartbeat document, taken in one atomic update; a round that died
  // leaves it behind for 90 seconds at most.
  const lock = await (await cachesColl()).updateOne(
    { key: RUNNER_KEY, $or: [{ roundLockAt: { $exists: false } }, { roundLockAt: { $lt: now.getTime() - ROUND_LOCK_MS } }] },
    { $set: { roundLockAt: now.getTime() } },
  );
  if (lock.modifiedCount !== 1) return answer({ reason: 'Another round is running right now. This one did nothing.', nextInMs: DEFAULT_DELAY_MS });
  try {
    return await lockedRound();
  } finally {
    await (await cachesColl()).updateOne({ key: RUNNER_KEY, roundLockAt: now.getTime() }, { $unset: { roundLockAt: '' } }).catch(() => undefined);
  }

  async function lockedRound(): Promise<RoundResult> {
  // counted again now that the lock is held: another round may have sent since the first read
  sentBefore = await sentTodayBySender(now);
  sentToday = [...sentBefore.values()].reduce((a, b) => a + b, 0);
  // Sends a dead round left open become "unknown", and their leads leave the queue.
  const stale = await sweepStaleSending(now);
  for (const s of stale) await holdLead(s.project, s.dedupKey);

  // The gate, before anything else, on every call: here and not only on the
  // screen, so calling the route directly cannot get round it.
  const state = await campaignState(before.lastTickAt, now);
  if (!state.gate.allowed) {
    const result = answer({ ok: false, blocked: true, blockers: state.gate.blockers, reason: state.gate.blockers.join(' '), nextInMs: IDLE_DELAY_MS });
    await writeHeartbeat(now, 'blocked', result.reason, sentToday);
    return result;
  }
  const idleSince = await lastSentBeforeToday(now);
  const senders = (await OutreachSender.find({ active: true }).select('+authSecret -_id').sort({ lastTickAt: 1 }).lean() as unknown as SenderDoc[])
    .map((d) => ({ ...d, lastSentBeforeToday: idleSince.get(d.senderId) || '' }));

  const limits = runLimits(opts) as { checkWindow: boolean; maxSends: number | null };
  const maxSends = Math.min(MAX_PER_ROUND, limits.maxSends ?? MAX_PER_ROUND);
  const ctx: RoundContext = { now, sequences: new Map(), domains: null, checkWindow: limits.checkWindow };
  const notes: string[] = [];
  let sent = 0, skipped = 0, remaining = 0, soonest = IDLE_DELAY_MS;

  // Leads of a sequence that is switched off are not asked for at all: eight of
  // them at the head of a sender's queue would otherwise hide every lead behind them.
  const enabledIds = (await OutreachSequence.find({ enabled: true }).select('sequenceId -_id').lean() as { sequenceId: string }[]).map((q) => q.sequenceId);

  for (const sender of senders) {
    if (sent >= maxSends) break;
    const label = sender.label || sender.fromEmail;
    if (!sender.authSecret) continue;
    // One round per sender at a time. Two overlapping rounds would both read
    // "limit not reached, pause over" and send two emails seconds apart.
    const locked = await OutreachSender.updateOne(
      { senderId: sender.senderId, $or: [{ roundAt: { $in: ['', null] } }, { roundAt: { $lt: new Date(now.getTime() - SENDER_LOCK_MS).toISOString() } }] },
      { $set: { roundAt: now.toISOString() } },
    );
    if (locked.modifiedCount !== 1) { notes.push(`${label} is busy in another round.`); continue; }
    try {
      await roundOfSender(sender, label);
    } finally {
      await OutreachSender.updateOne({ senderId: sender.senderId, roundAt: now.toISOString() }, { $set: { roundAt: '' } }).catch(() => undefined);
    }
  }

  async function roundOfSender(sender: SenderDoc, label: string): Promise<void> {
    if (!mailEndpointAllowed('smtp', sender.smtpHost, sender.smtpPort)) { notes.push(`${label} points at a mail server that is not allowed.`); return; }
    const cap = dailyCapFor(sender, now);
    const left = cap - (sentBefore.get(sender.senderId) || 0);
    if (left <= 0) { notes.push(`${label} has used up today's ${cap}.`); return; }
    const window = windowOf(sender) as { days: number[]; from: number; to: number };
    if (!opts.testMode) {
      const last = await OutreachSend.findOne({ senderId: sender.senderId, outcome: { $ne: 'failed' } }).sort({ sentAt: -1 }).select('sentAt -_id').lean() as { sentAt?: string } | null;
      const gap = gapState(last?.sentAt || '', minGapMs(cap, window.to - window.from), now) as { open: boolean; inMs: number };
      if (!gap.open) {
        soonest = Math.min(soonest, gap.inMs);
        notes.push(`${label} pauses ${Math.ceil(gap.inMs / 60_000)} more min between two emails.`);
        return;
      }
    }

    const due: Record<string, unknown> = {
      'seq.senderId': sender.senderId, 'seq.status': 'active', 'seq.nextStepAt': { $lte: now.toISOString() },
      'seq.sequenceId': { $in: enabledIds },
      // not the leads another round holds right now; a claim older than ten minutes is a dead round's
      $or: [{ 'seq.claimedAt': { $in: ['', null] } }, { 'seq.claimedAt': { $lt: staleBefore(now) } }],
    };
    const zones = limits.checkWindow ? zonesOpenNow(ALL_ZONES, sender, now) as string[] : null;
    // projection and lean, through the partial index: never whole documents, never a scan
    const leads = zones && !zones.length ? [] : await Lead.find(zones ? { ...due, 'seq.tz': { $in: zones } } : due).hint('gl_seq_due')
      .sort({ 'seq.nextStepAt': 1 }).limit(8).select(['project', 'dedupKey', 'email', 'seq', ...VARIABLE_FIELDS, '-_id'].join(' ')).lean() as unknown as DueLead[];
    await OutreachSender.updateOne({ senderId: sender.senderId }, { $set: { lastTickAt: now.toISOString() } });

    if (!leads.length) {
      // due, but asleep: say so, with the hour it is there
      const asleep = zones ? await Lead.findOne(due).hint('gl_seq_due').select('name dedupKey seq.tz -_id').lean() as { name?: string; dedupKey?: string; seq?: { tz?: string } } | null : null;
      if (asleep) {
        const tz = asleep.seq?.tz || 'its time zone';
        let clock = '';
        try { clock = new Intl.DateTimeFormat('en-GB', { timeZone: asleep.seq?.tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(now); } catch { clock = ''; }
        notes.push(`${label}: leads are due, but it is outside sending hours where they are (${asleep.name || asleep.dedupKey}: ${clock || 'unknown time'} in ${tz}).`);
      }
      return;
    }

    let pass = '';
    try {
      pass = open(sender.authSecret);
    } catch (e) {
      console.error('outreach round: a sender password could not be opened', sender.senderId, e instanceof Error ? e.message : '');
      notes.push(`${label}: its stored password cannot be opened. Save the password again.`);
      return;
    }
    const transport = nodemailer.createTransport({
      host: sender.smtpHost, port: sender.smtpPort,
      // 465 speaks TLS from the first byte; on every other port the upgrade is required, never optional
      secure: sender.smtpPort === 465, requireTLS: sender.smtpPort !== 465,
      auth: { user: sender.authUser || sender.fromEmail, pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    try {
      for (const lead of leads) {
        const outcome = await handleLead(lead, sender, (m) => transport.sendMail(m), ctx);
        if (outcome.note) notes.unshift(outcome.note);
        if (outcome.kind === 'skipped') skipped += 1;
        if (outcome.kind === 'sent') { sent += 1; sentToday += 1; break; } // one email per sender per round
        if (outcome.kind === 'error') break; // this sender has had its try for this round
      }
    } finally {
      transport.close();
    }
    remaining += Math.max(0, leads.length - 1);
  }

  const reason = sent
    ? `${plural(sent, 'email', 'emails')} sent. ${notes[0] || ''}`.trim()
    : notes[0] || (stale.length ? `${plural(stale.length, 'earlier send', 'earlier sends')} may have gone out and wait for your decision.` : 'Nothing is due right now.');
  const result = answer({ sent, skipped, remaining, reason, nextInMs: sent || remaining ? DEFAULT_DELAY_MS : Math.max(30_000, soonest) });
  await writeHeartbeat(now, result.action, reason, sentToday);
  return result;
  }
}
