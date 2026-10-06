// What a bounce means. Pure.
//
// Outreach goes out over SMTP, so nothing reports back: a bounce is not an
// event but an EMAIL from the mailer-daemon in the sender's mailbox, which the
// IMAP watcher brings in. There is no "delivered" either. What is known is that
// our mail server took the email and no error came back; that is an assumption
// of delivery, not a measurement.
//
// Three different things arrive looking like a bounce, and they call for three
// different answers:
//   hard   the address does not exist → suppress it and stop the sequence, for good
//   soft   a full mailbox, a server that is down → count it; the third one is a hard one
//   block  the address is fine, WE were refused → never suppress; count it apart,
//          because the cure is less volume, not a cleaner list

// Soft bounces in a row that count as a hard one.
export const SOFT_LIMIT = 3;
// After a soft bounce the next email to that lead waits at least this long.
export const SOFT_DELAY_MS = 24 * 3_600_000;

const BLOCK_WORDS = /\b(blocked|blocklist(ed)?|blacklist(ed)?|spam|rejected due to|reputation|policy reasons|not authorized|denied)\b/i;

// → 'block' | 'hard' | 'soft' | 'unknown', from the DSN's Status (5.x.x
// permanent, 4.x.x temporary) and Diagnostic-Code (the receiving server's own
// words). A block is looked for first: a refusal for reputation is a 5.x.x too,
// and it must not be mistaken for a dead address.
export function classifyBounce({ status, diagnostic } = {}) {
  const s = String(status || '').trim();
  const d = String(diagnostic || '');
  if (s === '5.7.1' || BLOCK_WORDS.test(d)) return 'block';
  if (/^5\.\d{1,3}\.\d{1,3}$/.test(s)) return 'hard';
  if (/^4\.\d{1,3}\.\d{1,3}$/.test(s)) return 'soft';
  // no enhanced code: the plain SMTP reply code at the start of the diagnostic
  const smtp = d.match(/(?:^|[\s;:])([45])\d\d[\s-]/);
  if (smtp) return smtp[1] === '5' ? 'hard' : 'soft';
  return 'unknown';
}

// When the delivery report could not be read: an address in the text of the
// bounce that is not one of our own and not a mailer-daemon's. '' when there is none.
export function fallbackRecipient(text, ownAddresses) {
  const own = new Set((ownAddresses || []).map((a) => String(a).toLowerCase()));
  for (const m of String(text || '').matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
    const a = m[0].toLowerCase().replace(/\.$/, '');
    const local = a.slice(0, a.indexOf('@'));
    if (own.has(a) || local === 'mailer-daemon' || local === 'postmaster') continue;
    return a;
  }
  return '';
}

// What to do with one bounce, given how many soft ones the lead already had.
// → { kind, suppress, stop, outcome, softBounces }
//   kind         the final kind: a third soft bounce comes back as 'hard'
//   suppress     put the address on the suppression list
//   stop         take the lead out of its sequence
//   outcome      what the send row becomes: 'bounced', 'blocked', or '' (it stays as it is)
//   softBounces  the lead's new count
export function bounceAction(kind, softBounces) {
  const had = Math.max(0, Number(softBounces) || 0);
  if (kind === 'hard') return { kind: 'hard', suppress: true, stop: true, outcome: 'bounced', softBounces: had };
  if (kind === 'block') return { kind: 'block', suppress: false, stop: false, outcome: 'blocked', softBounces: had };
  if (kind === 'soft') {
    const now = had + 1;
    return now >= SOFT_LIMIT
      ? { kind: 'hard', suppress: true, stop: true, outcome: 'bounced', softBounces: now }
      : { kind: 'soft', suppress: false, stop: false, outcome: '', softBounces: now };
  }
  return { kind: 'unknown', suppress: false, stop: false, outcome: '', softBounces: had };
}

// Shares of what went out, as fractions of `sent`. null while nothing was sent.
// `sent` counts every email handed to a mail server, bounced ones included.
export function bounceRates({ sent, bounced, blocked } = {}) {
  const n = Number(sent) || 0;
  if (n <= 0) return { bounced: null, blocked: null };
  return { bounced: (Number(bounced) || 0) / n, blocked: (Number(blocked) || 0) / n };
}
