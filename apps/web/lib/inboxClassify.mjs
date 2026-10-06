// Reading one incoming email of a sender mailbox: which kind it is, which part
// of it to fetch, and what a bounce report says. Pure functions over the pieces
// IMAP returns (lib/imapFetch.ts), so they are tested without a mail server.
//
// Outreach goes out over SMTP, so nothing calls back: a reply, a bounce and an
// out-of-office note all arrive as ordinary mail and have to be told apart here.

// Headers the classifier reads. Fetched by name, so the rest of the header block
// never leaves the mail server.
export const HEADER_NAMES = ['Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence', 'Content-Type', 'X-Failed-Recipients', 'Authentication-Results'];

// Stored text of a message: enough to read a reply in the dashboard.
export const SNIPPET_CHARS = 2000;

const AUTO_SUBJECT = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|automatikus válasz|házon kívül)/i;

// A raw header block → { 'lower-case-name': value }. Folded lines are joined;
// of a repeated header the first one wins.
/** @returns {Record<string, string>} */
export function parseHeaders(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  const lines = String(raw || '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

export function normalizeEmail(value) {
  // cut first: on a very long text without an address the pattern below is slow, and this reads mail headers anyone can send
  const m = String(value || '').slice(0, 500).match(/[^\s<>;,"']+@[^\s<>;,"']+/);
  return m ? m[0].toLowerCase() : '';
}

// → 'bounce' | 'auto' | 'human'. The order matters: a bounce quotes the
// original email, so it can contain anything a reply or an auto-reply would.
export function classifyMessage({ fromAddress, subject, headers, contentType }) {
  const h = headers || {};
  const local = normalizeEmail(fromAddress).split('@')[0];
  const type = String(contentType || h['content-type'] || '').toLowerCase();
  if (local === 'mailer-daemon' || local === 'postmaster') return 'bounce';
  if (type.includes('multipart/report') && type.includes('delivery-status')) return 'bounce';

  const autoSubmitted = String(h['auto-submitted'] || '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto';
  if ('x-autoreply' in h || 'x-autorespond' in h) return 'auto';
  if (String(h['precedence'] || '').toLowerCase() === 'auto_reply') return 'auto';
  if (AUTO_SUBJECT.test(String(subject || ''))) return 'auto';

  return 'human';
}

// Which parts of a message to fetch, from its IMAP body structure: the readable
// text (plain before HTML, never an attachment) and, in a bounce, the
// machine-readable delivery report. A message that is not multipart has no part
// numbers; its only part is '1'.
/**
 * @typedef {{ part: string, type: string, encoding: string, charset: string }} TextPart
 * @returns {{ text: TextPart | null, status: string | null }}
 */
export function pickParts(structure) {
  /** @type {TextPart | null} */
  let plain = null;
  /** @type {TextPart | null} */
  let html = null;
  /** @type {string | null} */
  let status = null;
  const walk = (node) => {
    if (!node) return;
    const type = String(node.type || '').toLowerCase();
    const attached = String(node.disposition || '').toLowerCase() === 'attachment';
    const part = { part: node.part || '1', type, encoding: String(node.encoding || '').toLowerCase(), charset: (node.parameters && node.parameters.charset) || '' };
    if (type === 'message/delivery-status' && !status) status = part.part;
    else if (type === 'text/plain' && !attached && !plain) plain = part;
    else if (type === 'text/html' && !attached && !html) html = part;
    for (const child of node.childNodes || []) walk(child);
  };
  walk(structure);
  return { text: plain || html, status };
}

function decodeQuotedPrintable(buf) {
  const s = buf.toString('latin1').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const hex = s[i] === '=' ? s.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; }
    else bytes.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeBase64(buf) {
  const s = buf.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '');
  // Only the start of the part is fetched, so the data can end inside a group of four.
  return Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64');
}

// The fetched bytes of a text part → a string. `encoding` is the transfer
// encoding ('' when the server already decoded it).
export function decodePart(buf, encoding, charset) {
  const bytes = encoding === 'base64' ? decodeBase64(buf) : encoding === 'quoted-printable' ? decodeQuotedPrintable(buf) : buf;
  let text;
  try {
    text = new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    // an unknown charset label: UTF-8 reads the ASCII part of it at least
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // a multi-byte character cut in half by the fetch limit
  return text.replace(/�+$/, '');
}

// Readable text of a part, cut to the stored length. HTML loses its tags.
export function textSnippet(text, type, max = SNIPPET_CHARS) {
  let t = String(text || '');
  if (type === 'text/html') {
    t = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return t.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// The message/delivery-status part of a bounce → who it failed for and why.
// `status` is the enhanced code (5.x.x permanent, 4.x.x temporary),
// `diagnostic` the receiving server's own words, cut to a storable length.
export function parseDeliveryStatus(text) {
  const h = parseHeaders(text);
  const recipient = normalizeEmail(h['final-recipient'] || h['original-recipient'] || '');
  const status = (String(h['status'] || '').match(/\d\.\d{1,3}\.\d{1,3}/) || [''])[0];
  return { recipient, status, action: String(h['action'] || '').toLowerCase(), diagnostic: String(h['diagnostic-code'] || '').replace(/\s+/g, ' ').slice(0, 400) };
}

// Did the mail really come from the address it claims? Anyone can send a mail
// to a sender mailbox and write anything into its From line, so a message that
// can suppress an address or end a sequence must prove where it is from.
// The proof is Gmail's own verdict, the Authentication-Results header it puts
// on top of every message it receives. Only the first such header is read, and
// only when it is Gmail's (mx.google.com): a forger can add lines of that name
// further down, but not above Gmail's.
// → { authenticated, googleBounce }
//   authenticated  SPF, DKIM or DMARC passed for the domain in the From address
//   googleBounce   a delivery report that Google's own mail system sent, proven
export function mailAuth(headers, fromAddress) {
  const from = normalizeEmail(fromAddress);
  const fromDomain = from.slice(from.lastIndexOf('@') + 1);
  const verdict = String((headers && headers['authentication-results']) || '').slice(0, 2000).toLowerCase();
  if (!from || !verdict.trimStart().startsWith('mx.google.com')) return { authenticated: false, googleBounce: false };
  const aligned = (d) => { const x = String(d || '').replace(/^@/, '').replace(/[>;,]+$/, ''); return !!x && (x === fromDomain || x.endsWith('.' + fromDomain) || fromDomain.endsWith('.' + x)); };
  const dkim = [...verdict.matchAll(/dkim=pass[^;]*?header\.[id]=@?([^\s;]+)/g)].some((m) => aligned(m[1]));
  const spf = [...verdict.matchAll(/spf=pass[^;]*?smtp\.mailfrom=(?:[^\s;@]*@)?([^\s;]+)/g)].some((m) => aligned(m[1]));
  const dmarc = [...verdict.matchAll(/dmarc=pass[^;]*?header\.from=([^\s;]+)/g)].some((m) => aligned(m[1]));
  const authenticated = dkim || spf || dmarc;
  const local = from.slice(0, from.lastIndexOf('@'));
  return { authenticated, googleBounce: authenticated && local === 'mailer-daemon' && (fromDomain === 'googlemail.com' || fromDomain === 'google.com') };
}
