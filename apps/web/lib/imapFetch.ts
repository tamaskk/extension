// One short round against a sender mailbox: connect, read what arrived since the
// last round, disconnect. Server code. Never keep the connection open (IDLE):
// the function dies under it. The mailbox is opened read-only, so nothing is
// marked as read and every message stays where the operator can see it.
//
// This file only fetches and sorts. Storing the result, matching a message to a
// lead and reacting to it belong to the caller.
import { ImapFlow } from 'imapflow';
import { HEADER_NAMES, classifyMessage, decodePart, mailAuth, normalizeEmail, parseDeliveryStatus, parseHeaders, pickParts, textSnippet } from '@/lib/inboxClassify.mjs';
import { planFetch, selectUids, nextState } from '@/lib/inboxPlan.mjs';
import { mailEndpointAllowed } from '@/lib/outreachSenderRules.mjs';

export interface ImapAccount { host: string; port: number; user: string; pass: string }
// What is remembered per sender between rounds (see lib/inboxPlan.mjs).
export interface InboxState { uidValidity: string; lastSeenUid: number; lastCheckedAt: string }
export type InboxKind = 'bounce' | 'auto' | 'human';

export interface InboxMessage {
  uid: number;
  messageId: string;   // of the incoming message; the duplicate check after a UIDVALIDITY change
  inReplyTo: string;   // may not match what was sent: Gmail can rewrite the Message-ID on the way out
  kind: InboxKind;
  from: string;        // lower-cased address; the key for matching a reply to a lead
  subject: string;
  at: string;          // ISO, when the mailbox received it
  snippet: string;
  bounceRecipient: string; // bounce only: the address that failed, the key for matching a bounce
  bounceStatus: string;    // bounce only: 5.x.x permanent, 4.x.x temporary, '' unknown
  bounceDiagnostic: string; // bounce only: the receiving server's own words
  authenticated: boolean;  // Gmail's own check says the mail is from the domain in its From address
  trustedBounce: boolean;  // a delivery report proven to come from Google's mail system
}

export interface InboxBatch {
  state: InboxState;      // store this only after the messages are stored
  messages: InboxMessage[];
  more: boolean;          // true when messages were left for the next round
  byMessageId: boolean;   // true after a UIDVALIDITY change: skip what is already stored by Message-ID
}

// Only the start of the text is fetched. Attachments are never needed and would
// only eat the 60 seconds.
const TEXT_BYTES = 6000;
const STATUS_BYTES = 4000;
// Stop reading bodies after this long and leave the rest for the next round.
const BUDGET_MS = 40_000;

export async function fetchNewMail(account: ImapAccount, state: InboxState, now = new Date()): Promise<InboxBatch> {
  // The account's password must only ever travel to Google (see ALLOWED_MAIL).
  if (!mailEndpointAllowed('imap', account.host, account.port)) throw new Error('this IMAP server is not allowed');
  const started = Date.now();
  const client = new ImapFlow({
    host: account.host, port: account.port, secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  });
  // Without a listener a late connection error is thrown into the process; the
  // call it interrupted already rejects with it.
  client.on('error', () => {});
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      if (!client.mailbox) throw new Error('INBOX did not open');
      const mailbox = { uidValidity: String(client.mailbox.uidValidity), uidNext: client.mailbox.uidNext };
      const plan = planFetch(state, mailbox, now);
      const byMessageId = plan.mode === 'since';
      if (plan.mode === 'baseline' || plan.mode === 'none') {
        return { state: nextState(state, mailbox, plan, [], now), messages: [], more: false, byMessageId };
      }

      const found = await client.search(plan.mode === 'uid' ? { uid: `${plan.fromUid}:*` } : { since: plan.since }, { uid: true });
      const picked = selectUids(plan, found || [], state.lastSeenUid);
      if (!picked.take.length) {
        const settled = nextState(state, mailbox, plan, [], now) as InboxState;
        // Nothing above lastSeenUid although the mailbox says there should be:
        // those messages were deleted. Move past them, or every round would ask again.
        return { state: { ...settled, lastSeenUid: Math.max(settled.lastSeenUid, mailbox.uidNext - 1) }, messages: [], more: false, byMessageId };
      }

      const heads = await client.fetchAll(picked.take, { uid: true, envelope: true, internalDate: true, bodyStructure: true, headers: HEADER_NAMES }, { uid: true });
      heads.sort((a, b) => a.uid - b.uid);

      const messages: InboxMessage[] = [];
      let more: boolean = picked.more;
      for (const head of heads) {
        if (Date.now() - started > BUDGET_MS) { more = true; break; }
        const headers = parseHeaders(head.headers ? head.headers.toString('latin1') : '');
        const structure = head.bodyStructure;
        const reportType = structure?.parameters?.['report-type'] || '';
        const from = normalizeEmail(head.envelope?.from?.[0]?.address || '');
        const subject = head.envelope?.subject || '';
        const kind: InboxKind = classifyMessage({ fromAddress: from, subject, headers, contentType: structure ? `${structure.type}; report-type=${reportType}` : '' });

        const auth = mailAuth(headers, from) as { authenticated: boolean; googleBounce: boolean };
        const parts = pickParts(structure);
        const wanted = [];
        if (parts.text) wanted.push({ key: parts.text.part, start: 0, maxLength: TEXT_BYTES });
        if (kind === 'bounce' && parts.status) wanted.push({ key: parts.status, start: 0, maxLength: STATUS_BYTES });
        const body = wanted.length ? await client.fetchOne(String(head.uid), { uid: true, bodyParts: wanted }, { uid: true }) : false;
        const bytes = (part: string) => (body && body.bodyParts?.get(part)) || null;
        // a part the server already decoded keeps its charset but has no transfer encoding left
        const encodingOf = (part: string, encoding: string) => (body && body.binaryParts?.has(part) ? '' : encoding);

        const textBytes = parts.text ? bytes(parts.text.part) : null;
        const snippet = parts.text && textBytes ? textSnippet(decodePart(textBytes, encodingOf(parts.text.part, parts.text.encoding), parts.text.charset), parts.text.type) : '';
        const statusBytes = parts.status ? bytes(parts.status) : null;
        const report = statusBytes ? parseDeliveryStatus(statusBytes.toString('latin1')) : { recipient: '', status: '', action: '', diagnostic: '' };

        messages.push({
          uid: head.uid,
          messageId: head.envelope?.messageId || '',
          inReplyTo: head.envelope?.inReplyTo || '',
          kind, from, subject,
          at: new Date(head.internalDate || now).toISOString(),
          snippet,
          bounceRecipient: kind === 'bounce' ? (report.recipient || normalizeEmail(headers['x-failed-recipients'] || '')) : '',
          bounceStatus: kind === 'bounce' ? report.status : '',
          bounceDiagnostic: kind === 'bounce' ? report.diagnostic : '',
          authenticated: auth.authenticated, trustedBounce: kind === 'bounce' && auth.googleBounce,
        });
      }

      // Messages were found and none could be read in time: the place in the
      // mailbox stays exactly where it was, so the next round starts on them again.
      if (!messages.length) return { state, messages: [], more: true, byMessageId };
      return { state: nextState(state, mailbox, plan, messages.map((m) => m.uid), now), messages, more, byMessageId };
    } finally {
      lock.release();
    }
  } finally {
    // the round is over either way; a failed goodbye must not hide the real error
    await client.logout().catch(() => client.close());
  }
}
