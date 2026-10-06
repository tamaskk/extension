// Seals a secret (a sender account's app password) before it is stored in the
// database, and opens it again when a connection needs it. Server code: it
// reads process.env, so never import it from a component or from lib/api.ts.
//
// AES-256-GCM from node:crypto, no dependency. The master key lives only in the
// environment (OUTREACH_SECRET_KEY, 32 bytes, base64). A database dump alone
// therefore does not give away the mailboxes.
//
// Sealed form: 'v1:<iv>:<tag>:<ciphertext>', each part base64. The version tag
// is there for the day the key or the cipher changes: the field then says what
// it holds.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

// No fallback on purpose: with the key missing or malformed nothing is sealed
// and nothing is opened. Storing the secret in the clear instead is never an option.
function masterKey(key) {
  const raw = key === undefined ? process.env.OUTREACH_SECRET_KEY : key;
  if (!raw) throw new Error('OUTREACH_SECRET_KEY is not set in the environment');
  // Checked as text first: Node's base64 decoder skips what it does not know, so
  // a key in quotes or with stray characters would decode to something else.
  const buf = /^[A-Za-z0-9+/]{43}=$/.test(String(raw)) ? Buffer.from(String(raw), 'base64') : Buffer.alloc(0);
  if (buf.length !== 32) throw new Error('OUTREACH_SECRET_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
  return buf;
}

// `key` is for tests; the app always uses the environment.
export function seal(plain, key) {
  if (typeof plain !== 'string' || plain === '') throw new Error('nothing to seal');
  const iv = randomBytes(12); // a fresh one per record: the same secret never seals to the same text
  const cipher = createCipheriv('aes-256-gcm', masterKey(key), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// Throws when the text was changed, sealed with another key, or is not a sealed value.
export function open(sealed, key) {
  const parts = String(sealed || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('not a sealed value');
  const [iv, tag, data] = parts.slice(1).map((p) => Buffer.from(p, 'base64'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(key), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // the library's own message is kept out: this error may travel towards a log
    throw new Error('the sealed value could not be opened (changed, or sealed with another key)');
  }
}
