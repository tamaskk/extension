// Reading a person's reply: what part of it they wrote, whether it asks us to
// stop, and whether it belongs to a thread we started. Pure.
//
// The costliest single mistake of the whole system sits here. Someone who
// answers and still gets the next automatic step three days later sees at once
// that it was a mass campaign, and that someone is the one who was interested.

// The words that mean "stop writing to me", in one place. Compared without
// case, accents and punctuation. The footer (lib/outreachFooter.mjs) asks for STOP.
export const STOP_WORDS = ['stop', 'unsubscribe', 'remove', 'remove me', 'leallit', 'leiratkozas', 'leiratkozom', 'ne irj', 'ne irjon', 'torolj', 'toroljon'];

// lower case, no accents, no punctuation, single spaces
function plain(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const QUOTE_MARKERS = [
  /^\s*>/,                                               // quoted lines
  /^\s*on .{0,200}wrote:\s*$/i,                          // On Tue, 20 Oct 2026 at 14:00, Tom <tom@…> wrote:
  /^\s*.{0,200}(ezt írta|írta)\s*(\(.*\))?:\s*$/i,       // 2026. okt. 20., K 14:00 Tom <tom@…> ezt írta:
  /^\s*-{2,}\s*(original message|eredeti üzenet|forwarded message|továbbított üzenet)\s*-{2,}\s*$/i,
  /^\s*(from|feladó|von):\s.+/i,                         // the header block Outlook puts above a quote
  /^--\s?$/,                                             // the signature delimiter
  /^\s*_{5,}\s*$/,                                       // Outlook's line above a quote
];

// What the person wrote: the reply without the quoted original under it and
// without their signature. Every reply carries our own email underneath, and
// that email says "Reply STOP": read the whole text and every reply looks like
// a stop request.
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "On … wrote:" is often folded over two lines by the mail program
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1]}` : line;
    if (QUOTE_MARKERS.some((m) => m.test(line)) || /^\s*on .{0,300}wrote:\s*$/i.test(joined)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

// Does the reply ask us to stop? Only what the person wrote counts. It does
// when that is a stop word and nothing else, or starts with one and is no
// longer than four words ("stop please", "remove me from this"). A longer
// sentence that merely begins with such a word ("Stop by our office any time")
// is a reply, not a request: it still ends the sequence, as every reply does,
// but it does not put the address on the suppression list.
export function isStopRequest(text) {
  const own = plain(stripQuoted(text));
  if (!own) return false;
  const words = own.split(' ');
  return STOP_WORDS.some((w) => own === w || (own.startsWith(w + ' ') && words.length <= 4));
}

const bareSubject = (s) => plain(String(s || '').replace(/^\s*((re|fwd?|fw|vá|válasz|tov|aw|sv)\s*:\s*)+/i, ''));

// Does a reply's subject belong to the thread that went out under
// `threadSubject`? The second key for matching, for the reply that comes from
// another address than the one written to (we wrote to info@, the owner
// answers from their own). A subject too short to be told apart never matches.
export function subjectMatches(replySubject, threadSubject) {
  const thread = bareSubject(threadSubject);
  if (thread.length < 8) return false;
  return bareSubject(replySubject).includes(thread);
}

// After an out-of-office note the person is away: the next step waits this long.
export const AUTO_REPLY_DELAY_MS = 3 * 24 * 3_600_000;

// The later of two moments, as ISO: a due date is pushed back, never pulled forward.
export function pushedBack(currentIso, now, delayMs) {
  const current = Date.parse(currentIso || '');
  const later = now.getTime() + delayMs;
  return new Date(Number.isFinite(current) && current > later ? current : later).toISOString();
}
