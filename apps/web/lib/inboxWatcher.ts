// Reads what arrived in the sender mailboxes and acts on it. Server code.
//
// Outreach goes out over SMTP, so nothing calls back: a reply, a bounce and an
// out-of-office note all come as mail. One call handles one mailbox: a short
// read-only IMAP round (lib/imapFetch.ts), then for every new message a row in
// `outreachinbox` and its effect on the lead. What each kind of message means
// is decided by pure rules (lib/bounceRules.mjs, lib/replyRules.mjs).
//
// Nothing is thrown away. A message that matches no lead is stored and logged,
// and stays in the mailbox, where the operator can look at it.
import { dbConnect } from '@/lib/db';
import { Lead, OutreachInbox, OutreachSend, OutreachSender } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { open } from '@/lib/secretBox.mjs';
import { fetchNewMail } from '@/lib/imapFetch';
import type { InboxMessage } from '@/lib/imapFetch';
import { suppress } from '@/lib/suppression';
import { stopSequence } from '@/lib/outreachState';
import { mailEndpointAllowed } from '@/lib/outreachSenderRules.mjs';
import { SOFT_DELAY_MS, bounceAction, classifyBounce, fallbackRecipient } from '@/lib/bounceRules.mjs';
import { AUTO_REPLY_DELAY_MS, isStopRequest, pushedBack, stripQuoted, subjectMatches } from '@/lib/replyRules.mjs';

// Matching a reply by its subject reads at most this many running leads of the sender.
const SUBJECT_SCAN = 5000;
// A message whose handling failed is tried again this many times, then left for the operator.
const MAX_ATTEMPTS = 5;
// A mailbox is read at most this often, however often the route is called.
const MIN_BETWEEN_MS = 3 * 60_000;

export interface InboxRound {
  ok: boolean;
  checked: string;      // the mailbox that was read, '' when none was due
  messages: number; bounces: number; replies: number; stops: number; autoReplies: number; unmatched: number;
  more: boolean;        // the mailbox has more new mail than one round reads
  reason: string;       // a sentence for the tab
}

interface SenderDoc { senderId: string; label?: string; fromEmail: string; imapHost?: string; imapPort?: number; authUser?: string; authSecret?: string; uidValidity?: string; lastSeenUid?: number; lastCheckedAt?: string }
interface SendRow { _id: unknown; project: string; dedupKey: string; sequenceId?: string; stepId?: string; to?: string }
interface LeadDoc { project: string; dedupKey: string; name?: string; seq?: { status?: string; sequenceId?: string; stepId?: string; to?: string; nextStepAt?: string; softBounces?: number; threadSubject?: string } }
type Match = { send: SendRow | null; lead: LeadDoc | null; by: 'address' | 'subject' | '' };

const LEAD_FIELDS = 'project dedupKey name seq.status seq.sequenceId seq.stepId seq.to seq.nextStepAt seq.softBounces seq.threadSubject -_id';

// The last email that went to this address, and its lead.
async function matchByAddress(address: string): Promise<Match> {
  if (!address) return { send: null, lead: null, by: '' };
  const send = await OutreachSend.findOne({ to: address, outcome: { $nin: ['failed', 'sending'] } }).sort({ sentAt: -1 }).select('project dedupKey sequenceId stepId to').lean() as unknown as SendRow | null;
  if (!send) return { send: null, lead: null, by: '' };
  const lead = await Lead.findOne({ project: send.project, dedupKey: send.dedupKey }).select(LEAD_FIELDS).lean() as unknown as LeadDoc | null;
  return { send, lead, by: 'address' };
}

// The reply came from another address than the one written to (we wrote to
// info@, the owner answers from their own): look for the thread by its subject,
// among the leads this sender has in a sequence. Through `gl_seq_due`.
async function matchBySubject(senderId: string, subject: string): Promise<Match> {
  const leads = await Lead.find({ 'seq.senderId': senderId, 'seq.status': 'active' }).hint('gl_seq_due').select(LEAD_FIELDS).limit(SUBJECT_SCAN + 1).lean() as unknown as LeadDoc[];
  // more leads than were read: "exactly one" could not be claimed of them
  if (leads.length > SUBJECT_SCAN) return { send: null, lead: null, by: '' };
  const hits = leads.filter((l) => subjectMatches(subject, l.seq?.threadSubject || ''));
  // two threads with one subject cannot be told apart: better no match than the wrong lead stopped
  if (hits.length !== 1) return { send: null, lead: null, by: '' };
  const lead = hits[0];
  const send = await OutreachSend.findOne({ dedupKey: lead.dedupKey, to: lead.seq?.to || '', outcome: { $nin: ['failed', 'sending'] } }).sort({ sentAt: -1 }).select('project dedupKey sequenceId stepId to').lean() as unknown as SendRow | null;
  return { send, lead, by: 'subject' };
}

// Every other lead with a running sequence to this address stops too: what the
// list learns now takes effect now, not at the next enrolment.
async function stopOthersAt(address: string, reason: string) {
  await Lead.updateMany({ 'seq.status': 'active', 'seq.to': address }, { $set: { 'seq.status': reason === 'bounced' ? 'bounced' : 'stopped', 'seq.nextStepAt': '' } }, { hint: 'gl_seq_due' });
}

const ref = (lead: LeadDoc) => ({ project: lead.project, dedupKey: lead.dedupKey, name: lead.name, seq: lead.seq });
type Effect = { row: Record<string, unknown>; counted: 'bounce' | 'reply' | 'stop' | 'auto' | 'unmatched' };

async function handleBounce(sender: SenderDoc, m: InboxMessage): Promise<Effect> {
  // Anyone can send a mail that looks like a bounce and names any address in
  // it. Acting on it would let a stranger suppress a lead, or shut the whole
  // campaign with one mail that says "blocked". So only a report proven to come
  // from Google's own mail system has an effect; it is the one that reports the
  // failures of mail sent through Gmail. Anything else is kept and shown, and
  // changes nothing.
  if (!m.trustedBounce) {
    await logActivity({
      type: 'outreach.bounced', n: 1, source: 'system',
      title: `A bounce from ${m.from || 'an unknown sender'} in the mailbox of ${sender.fromEmail} could not be proven to come from Google's mail system. Nothing was changed; have a look at it.`,
      data: { senderId: sender.senderId, from: m.from, subject: m.subject, status: m.bounceStatus, uid: m.uid },
    });
    return { row: { bounceKind: classifyBounce({ status: m.bounceStatus, diagnostic: m.bounceDiagnostic }) as string, bounceStatus: m.bounceStatus, ignored: 'The sender of this bounce could not be verified.' }, counted: 'unmatched' };
  }
  // the delivery report names the address; when it cannot be read, the text of the bounce may
  const recipient = m.bounceRecipient || fallbackRecipient(m.snippet, [sender.fromEmail, sender.authUser || '']);
  const found = await matchByAddress(recipient);
  const kind = classifyBounce({ status: m.bounceStatus, diagnostic: m.bounceDiagnostic || m.snippet }) as string;
  if (!found.send) {
    await logActivity({
      type: 'outreach.bounced', n: 1, source: 'system',
      title: recipient ? `A bounce for ${recipient} matches no email that was sent. It is in the mailbox of ${sender.fromEmail}.` : `A bounce in the mailbox of ${sender.fromEmail} could not be read. Have a look at it.`,
      data: { senderId: sender.senderId, recipient, subject: m.subject, status: m.bounceStatus, diagnostic: m.bounceDiagnostic, uid: m.uid },
    });
    return { row: { bounceKind: kind, bounceStatus: m.bounceStatus }, counted: 'unmatched' };
  }

  const { send, lead } = found;
  const act = bounceAction(kind, lead?.seq?.softBounces) as { kind: string; suppress: boolean; stop: boolean; outcome: string; softBounces: number };
  // The send row carries one bounce. A final answer may replace a temporary or
  // an unreadable one (a "delayed" notice is often followed by the failure);
  // nothing replaces a final one. Whether the row changed decides what is
  // counted and logged, so the same bounce handled twice counts once.
  const final = act.kind === 'hard' || act.kind === 'block';
  const fresh = await OutreachSend.updateOne(
    { _id: send._id, bounceKind: final ? { $nin: ['hard', 'block'] } : { $in: ['', null] } },
    { $set: { bounceKind: act.kind, bounceStatus: m.bounceStatus, bounceDiagnostic: m.bounceDiagnostic, ...(act.outcome ? { outcome: act.outcome, outcomeAt: m.at } : {}) } },
  );
  // Suppressing and stopping do not depend on that: they change nothing when
  // done twice, and they must happen even if an earlier try died right after
  // the row was written. A dead address that stays unsuppressed gets the next
  // step too, and bounces again.
  if (act.suppress) {
    await suppress(recipient, 'hard_bounce', `sender:${sender.senderId}`, m.bounceStatus);
    if (lead) await stopSequence(ref(lead), 'bounced');
    await stopOthersAt(recipient, 'bounced');
  }
  if (fresh.modifiedCount === 1) {
    if (act.kind === 'soft' && lead) {
      // counted, and the next email to this lead waits: not stopped, not sent again at once
      await Lead.updateOne({ project: lead.project, dedupKey: lead.dedupKey }, { $set: { 'seq.softBounces': act.softBounces, ...(lead.seq?.status === 'active' ? { 'seq.nextStepAt': pushedBack(lead.seq?.nextStepAt || '', new Date(), SOFT_DELAY_MS) } : {}) } });
    }
    const what = act.kind === 'hard' ? 'bounced for good; the address is suppressed' : act.kind === 'block' ? 'was blocked by the receiving server; the address itself is fine' : act.kind === 'soft' ? `bounced for now (${act.softBounces} of 3)` : 'came back in a form that could not be read';
    await logActivity({
      type: 'outreach.bounced', project: send.project, keys: [send.dedupKey], n: 1, source: 'system',
      title: `${lead?.name || send.dedupKey}: the email to ${recipient} ${what}`,
      data: { name: lead?.name, to: recipient, kind: act.kind, status: m.bounceStatus, diagnostic: m.bounceDiagnostic, sequenceId: send.sequenceId, stepId: send.stepId, senderId: sender.senderId },
    });
  }
  return { row: { bounceKind: act.kind, bounceStatus: m.bounceStatus, project: send.project, dedupKey: send.dedupKey, leadName: lead?.name || '', sequenceId: send.sequenceId || '', stepId: send.stepId || '', matchedBy: 'address' }, counted: 'bounce' };
}

async function handleAutoReply(m: InboxMessage): Promise<Effect> {
  const { send, lead } = await matchByAddress(m.from);
  if (!send || !lead) return { row: {}, counted: 'auto' };
  // Not a reply: the sequence goes on. The person is away, so the next step waits a few days.
  await Lead.updateOne({ project: lead.project, dedupKey: lead.dedupKey }, { $set: { 'seq.autoReplyAt': m.at, ...(lead.seq?.status === 'active' ? { 'seq.nextStepAt': pushedBack(lead.seq?.nextStepAt || '', new Date(), AUTO_REPLY_DELAY_MS) } : {}) } });
  return { row: { project: send.project, dedupKey: send.dedupKey, leadName: lead.name || '', sequenceId: send.sequenceId || '', stepId: send.stepId || '', matchedBy: 'address' }, counted: 'auto' };
}

async function handleReply(sender: SenderDoc, m: InboxMessage): Promise<Effect> {
  let found = await matchByAddress(m.from);
  if (!found.lead) found = await matchBySubject(sender.senderId, m.subject);
  const own = stripQuoted(m.snippet);
  const stop = isStopRequest(m.snippet);
  const { send, lead } = found;

  if (!lead) {
    // A stop request from an address we never wrote to is honoured when the mail
    // is proven to come from that address. Otherwise anyone could put any
    // address on the list by writing it into a From line.
    const suppressed = stop && m.authenticated;
    if (suppressed) await suppress(m.from, 'stop', `sender:${sender.senderId}`, 'matched no lead');
    await logActivity({
      type: 'outreach.replied', n: 1, source: 'system',
      title: `A reply from ${m.from} matches no lead${stop ? (suppressed ? '; it asks to stop, the address is suppressed' : '; it asks to stop, but its sender could not be verified, so nothing was suppressed') : ''}. It is in the mailbox of ${sender.fromEmail}.`,
      data: { senderId: sender.senderId, from: m.from, subject: m.subject, text: own.slice(0, 300), uid: m.uid },
    });
    return { row: { stop, snippet: own, ignored: stop && !suppressed ? 'A stop request whose sender could not be verified.' : '' }, counted: 'unmatched' };
  }

  const to = lead.seq?.to || send?.to || '';
  // Matched only by the subject: somebody else's address answered in our thread.
  // That is enough to end the sequence, which costs nothing if it is wrong. It
  // is not enough to put the LEAD's address on the list for good: a subject can
  // be guessed, and the list has no way back in the app.
  const bySubjectOnly = found.by === 'subject';
  if (stop) {
    // Both at once, never one without the other: the status ends this sequence,
    // the suppression keeps every later one away. In force at once.
    if (!bySubjectOnly || m.authenticated) await suppress(m.from, 'stop', `sequence:${lead.seq?.sequenceId || ''}`);
    if (!bySubjectOnly && to && to !== m.from) await suppress(to, 'stop', `sequence:${lead.seq?.sequenceId || ''}`, `asked from ${m.from}`);
    await stopSequence(ref(lead), 'unsubscribed');
    for (const address of new Set((bySubjectOnly ? [m.from] : [m.from, to]).filter(Boolean))) await stopOthersAt(address, 'unsubscribed');
  }
  // Whatever state the sequence is in, the lead has answered: no further step, ever.
  await Lead.updateOne(
    { project: lead.project, dedupKey: lead.dedupKey, 'seq.status': { $in: ['active', 'waiting', 'finished', 'hold', 'failed', 'stopped', 'replied'] } },
    { $set: { 'seq.repliedAt': m.at, 'seq.claimedAt': '', 'seq.nextStepAt': '', 'seq.status': stop ? 'stopped' : 'replied' } },
  );
  if (send) await OutreachSend.updateOne({ _id: send._id, outcome: { $in: ['sent', 'delivered'] } }, { $set: { outcome: stop ? 'stopped' : 'replied', outcomeAt: m.at } });
  await logActivity({
    type: stop ? 'outreach.stopped' : 'outreach.replied', project: lead.project, keys: [lead.dedupKey], n: 1, source: 'system',
    title: stop ? `${lead.name || lead.dedupKey}: asked to stop; taken out and suppressed` : `${lead.name || lead.dedupKey}: replied; the sequence is stopped`,
    data: { name: lead.name, from: m.from, subject: m.subject, text: own.slice(0, 300), matchedBy: found.by, sequenceId: lead.seq?.sequenceId || '', reason: stop ? 'unsubscribed' : 'replied' },
  });
  return { row: { stop, snippet: own, project: lead.project, dedupKey: lead.dedupKey, leadName: lead.name || '', sequenceId: lead.seq?.sequenceId || send?.sequenceId || '', stepId: send?.stepId || '', matchedBy: found.by }, counted: stop ? 'stop' : 'reply' };
}

// Read one mailbox: the one that was read longest ago. Returns what it found,
// as numbers and as a sentence. Throws only for what the caller cannot put
// right by itself; the route turns that into a sentence too.
export async function checkInbox(now = new Date()): Promise<InboxRound> {
  await dbConnect();
  const round: InboxRound = { ok: true, checked: '', messages: 0, bounces: 0, replies: 0, stops: 0, autoReplies: 0, unmatched: 0, more: false, reason: '' };
  // The mailbox TRIED longest ago, not the one read longest ago: a mailbox that
  // keeps failing (a changed password, a locked account) would otherwise stay
  // first in line for ever, and no other mailbox would be read again.
  const sender = await OutreachSender.findOne({ $or: [{ inboxTriedAt: { $in: ['', null] } }, { inboxTriedAt: { $lt: new Date(now.getTime() - MIN_BETWEEN_MS).toISOString() } }] })
    .select('+authSecret -_id').sort({ inboxTriedAt: 1 }).lean() as unknown as SenderDoc | null;
  if (!sender) return { ...round, reason: 'Every mailbox was read a moment ago.' };
  round.checked = sender.label || sender.fromEmail;
  await OutreachSender.updateOne({ senderId: sender.senderId }, { $set: { inboxTriedAt: now.toISOString() } });
  if (!sender.authSecret) return { ...round, reason: `${round.checked} has no stored password, its mailbox was not read.` };
  // the password must only ever travel to Google: checked before it is opened
  if (!mailEndpointAllowed('imap', sender.imapHost, sender.imapPort)) return { ...round, ok: false, reason: `${round.checked} points at a mail server that is not allowed.` };

  const count = (effect: Effect) => {
    round.messages += 1;
    if (effect.counted === 'bounce') round.bounces += 1;
    else if (effect.counted === 'reply') round.replies += 1;
    else if (effect.counted === 'stop') round.stops += 1;
    else if (effect.counted === 'auto') round.autoReplies += 1;
    else round.unmatched += 1;
  };
  // Handle one stored message. A failure is the message's own: it is noted on
  // its row and the round goes on, so one message that cannot be handled does
  // not keep every later one waiting. It is tried again from its row.
  const handle = async (key: Record<string, unknown>, m: InboxMessage) => {
    try {
      const effect = m.kind === 'bounce' ? await handleBounce(sender, m) : m.kind === 'auto' ? await handleAutoReply(m) : await handleReply(sender, m);
      await OutreachInbox.updateOne(key, { $set: { ...effect.row, handledAt: new Date().toISOString() } });
      count(effect);
    } catch (e) {
      console.error('inbox message could not be handled', sender.senderId, m.uid, e instanceof Error ? e.message.slice(0, 200) : '');
      await OutreachInbox.updateOne(key, { $inc: { attempts: 1 } }).catch(() => undefined);
      round.unmatched += 1;
    }
  };

  // First, what an earlier round stored and could not finish.
  const left = await OutreachInbox.find({ senderId: sender.senderId, handledAt: '', attempts: { $lt: MAX_ATTEMPTS } }).sort({ at: 1 }).limit(20).lean() as unknown as (Record<string, unknown> & { _id: unknown })[];
  for (const r of left) {
    await handle({ _id: r._id }, {
      uid: Number(r.uid) || 0, messageId: String(r.messageId || ''), inReplyTo: '', kind: (r.kind === 'bounce' || r.kind === 'auto' ? r.kind : 'human'),
      from: String(r.from || ''), subject: String(r.subject || ''), at: String(r.at || ''), snippet: String(r.snippet || ''),
      bounceRecipient: String(r.bounceRecipient || ''), bounceStatus: String(r.bounceStatus || ''), bounceDiagnostic: String(r.bounceDiagnostic || ''),
      authenticated: r.authenticated === true, trustedBounce: r.trustedBounce === true,
    });
  }

  const batch = await fetchNewMail(
    { host: sender.imapHost || '', port: sender.imapPort || 993, user: sender.authUser || sender.fromEmail, pass: open(sender.authSecret) },
    { uidValidity: sender.uidValidity || '', lastSeenUid: sender.lastSeenUid || 0, lastCheckedAt: sender.lastCheckedAt || '' },
    now,
  );

  for (const m of batch.messages) {
    // After a UIDVALIDITY change the UIDs are new, so a message already stored is known by its Message-ID.
    if (batch.byMessageId && m.messageId && await OutreachInbox.exists({ senderId: sender.senderId, messageId: m.messageId })) continue;
    const key = { senderId: sender.senderId, uidValidity: batch.state.uidValidity, uid: m.uid };
    // Store first, with everything needed to handle it again from the row alone.
    // A message is handled when it is new, or stored earlier but never handled
    // (the round died in between); a handled one is left alone.
    await OutreachInbox.updateOne(key, { $setOnInsert: { ...key, messageId: m.messageId, kind: m.kind, from: m.from, subject: m.subject.slice(0, 300), at: m.at, snippet: m.snippet, bounceRecipient: m.bounceRecipient, bounceStatus: m.bounceStatus, bounceDiagnostic: m.bounceDiagnostic, authenticated: m.authenticated, trustedBounce: m.trustedBounce, createdAt: now.toISOString() } }, { upsert: true });
    const stored = await OutreachInbox.findOne(key).select('handledAt -_id').lean() as { handledAt?: string } | null;
    if (stored?.handledAt) continue;
    await handle(key, m);
  }

  // Only now: the place in the mailbox moves on after its messages are stored, never before.
  await OutreachSender.updateOne({ senderId: sender.senderId }, { $set: { uidValidity: batch.state.uidValidity, lastSeenUid: batch.state.lastSeenUid, lastCheckedAt: batch.state.lastCheckedAt } });
  round.more = batch.more;
  const parts = [
    round.replies && `${round.replies} ${round.replies === 1 ? 'reply' : 'replies'}`,
    round.stops && `${round.stops} stop ${round.stops === 1 ? 'request' : 'requests'}`,
    round.bounces && `${round.bounces} ${round.bounces === 1 ? 'bounce' : 'bounces'}`,
    round.autoReplies && `${round.autoReplies} automatic ${round.autoReplies === 1 ? 'reply' : 'replies'}`,
    round.unmatched && `${round.unmatched} that matched no lead`,
  ].filter(Boolean);
  round.reason = parts.length ? `${round.checked}: ${parts.join(', ')}.` : `${round.checked}: nothing new.`;
  return round;
}
