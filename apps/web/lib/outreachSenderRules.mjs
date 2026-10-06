// Rules of a sender account (the `outreachsenders` collection) that need no
// database and no network: what a saved account must look like and how a failed
// connection is worded. The daily limit and its tiers are in lib/warmup.mjs.
import { normalizeEmail } from './inboxClassify.mjs';
import { DEFAULT_DAILY_LIMIT, DEFAULT_TIERS, normalizeTiers, validateWarmup } from './warmup.mjs';

export const SENDER_DEFAULTS = { smtpHost: 'smtp.gmail.com', smtpPort: 587, imapHost: 'imap.gmail.com', imapPort: 993 };

// The only mail servers an account may point at. The stored app password is
// sent to whatever host the account names, so a free host field would be a way
// to read the password out: change the host to a server of your own, press
// "Test connection", and it arrives in the login. It would also let the
// function be aimed at any address inside a network. Checked on save and again
// right before every connection, because a stored value can be changed in the
// database as well.
export const ALLOWED_MAIL = { smtp: { host: 'smtp.gmail.com', ports: [465, 587] }, imap: { host: 'imap.gmail.com', ports: [993] } };

// `kind` is 'smtp' or 'imap'.
export function mailEndpointAllowed(kind, host, port) {
  const allowed = ALLOWED_MAIL[kind];
  return !!allowed && String(host || '').toLowerCase() === allowed.host && allowed.ports.includes(Number(port));
}

// Control characters are dropped: a From name becomes a mail header, and a line
// break in it would start a header of the writer's choosing.
const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const port = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null; };

// The fields of an account from a request body: coerced, cut to size and
// checked. → { value, errors }; `value` holds only the fields that were sent,
// so an edit changes nothing else. With `creating`, every required field must
// be there. The password is not handled here on purpose: it never travels
// together with the plain fields.
export function cleanSender(input, creating) {
  const b = input && typeof input === 'object' ? input : {};
  const value = {};
  const errors = [];
  const has = (k) => creating || b[k] !== undefined;

  if (has('label')) { value.label = text(b.label, 80); if (!value.label) errors.push('The account needs a label.'); }
  if (has('fromName')) { value.fromName = text(b.fromName, 80); if (!value.fromName) errors.push('The From name is missing. Use a person\'s name.'); }
  if (has('fromEmail')) { value.fromEmail = normalizeEmail(text(b.fromEmail, 200)); if (!value.fromEmail) errors.push('The From address is not an email address.'); }
  if (has('language')) { value.language = text(b.language, 5); if (value.language !== 'en' && value.language !== 'hu') errors.push('The language must be en or hu.'); }
  if (has('authUser')) {
    // the login is the address itself unless told otherwise
    value.authUser = text(b.authUser, 200) || value.fromEmail || '';
    if (creating && !value.authUser) errors.push('The login name is missing.');
  }
  for (const [k, kind] of [['smtpHost', 'smtp'], ['imapHost', 'imap']]) {
    if (!has(k)) continue;
    value[k] = text(b[k], 200).toLowerCase() || (creating ? SENDER_DEFAULTS[k] : '');
    if (value[k] !== ALLOWED_MAIL[kind].host) errors.push(`The ${kind.toUpperCase()} host must be ${ALLOWED_MAIL[kind].host}.`);
  }
  for (const [k, kind] of [['smtpPort', 'smtp'], ['imapPort', 'imap']]) {
    if (!has(k)) continue;
    const empty = b[k] === undefined || b[k] === null || b[k] === '';
    value[k] = empty && creating ? SENDER_DEFAULTS[k] : port(b[k]);
    if (!ALLOWED_MAIL[kind].ports.includes(value[k])) errors.push(`The ${kind.toUpperCase()} port must be ${ALLOWED_MAIL[kind].ports.join(' or ')}.`);
  }
  if (has('dailyLimit')) {
    const empty = b.dailyLimit === undefined || b.dailyLimit === null || b.dailyLimit === '';
    value.dailyLimit = empty ? DEFAULT_DAILY_LIMIT : Number(b.dailyLimit);
    if (!(Number.isInteger(value.dailyLimit) && value.dailyLimit >= 0 && value.dailyLimit <= 2000)) errors.push('The daily ceiling must be a whole number between 0 and 2000.');
  }
  if (has('warmup')) {
    // a new account without tiers of its own starts on the default ones
    const w = b.warmup && typeof b.warmup === 'object' ? b.warmup : { enabled: true, tiers: DEFAULT_TIERS };
    value.warmup = { enabled: w.enabled !== false, tiers: normalizeTiers(w.tiers) };
    const problem = validateWarmup(value.warmup.tiers);
    if (problem) errors.push(problem);
  }
  // the send window, on the recipient's clock (lib/sendWindow.mjs)
  if (has('sendDays')) {
    const days = Array.isArray(b.sendDays) ? [...new Set(b.sendDays.map(Number))].sort((x, y) => x - y) : creating ? [1, 2, 3, 4, 5] : [];
    value.sendDays = days;
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) errors.push('Choose at least one sending day.');
  }
  for (const [k, fallback] of [['windowFrom', 7], ['windowTo', 19]]) {
    if (!has(k)) continue;
    const empty = b[k] === undefined || b[k] === null || b[k] === '';
    value[k] = empty ? fallback : Number(b[k]);
    if (!(Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 24)) errors.push('The sending hours must be whole hours between 0 and 24.');
  }
  if (value.windowFrom !== undefined && value.windowTo !== undefined && Number.isInteger(value.windowFrom) && Number.isInteger(value.windowTo) && value.windowFrom >= value.windowTo) errors.push('The sending window must end after it starts.');
  if (has('notes')) value.notes = text(b.notes, 2000);
  if (b.active !== undefined) value.active = b.active === true;
  return { value, errors };
}

// Why a connection failed, from the error of nodemailer or imapflow, as one of
// three kinds. The library's own message is never passed on: it can carry the
// login name or the server's answer.
export function connectionFailure(err) {
  const e = err && typeof err === 'object' ? err : {};
  if (e.code === 'EAUTH' || e.authenticationFailed === true) return 'auth';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETLS', 'NoConnection'].includes(e.code)) return 'unreachable';
  return 'failed';
}

// The sentence shown for a connection test. `channel` is 'SMTP' or 'IMAP'.
export function connectionMessage(channel, kind) {
  if (kind === 'ok') return `${channel} works.`;
  if (kind === 'auth') return `${channel}: the server refused the login name or the app password.`;
  if (kind === 'unreachable') return `${channel}: the server could not be reached. Check the host and the port.`;
  return `${channel}: the connection failed.`;
}
