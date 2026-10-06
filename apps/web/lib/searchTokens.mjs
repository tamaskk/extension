// Search tokens of a lead: the words a search can match from their start.
//
// The lead search used to be an unanchored, case-insensitive regex over five
// fields, which no index can serve: every search read all 1.6M leads. Each lead
// now stores its words in `searchTokens` (indexed), and a search asks for
// tokens that START with each word typed. "pizz" finds "Pizza Hut" and
// "Joe's Pizza"; "zza" finds nothing — that is the trade.

export const MAX_TOKENS = 24; // per lead; bounds the multikey index

// lower case, accents removed: "Bécs" and "becs" are the same word
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// Tokens in priority order (name first), without repeats, capped.
export function tokensOf(lead) {
  const out = [];
  const seen = new Set();
  const add = (t) => { if (t && t.length > 1 && !seen.has(t)) { seen.add(t); out.push(t); } };
  for (const w of words(lead.name)) add(w);
  // the phone: each digit group as shown, and the whole number as one run
  const phone = String(lead.phone ?? '');
  for (const g of phone.split(/\D+/)) add(g);
  add(phone.replace(/\D+/g, ''));
  // the email: whole, its domain, and its parts
  const email = normalize(lead.email).trim();
  if (email) { add(email); add(email.split('@')[1] || ''); for (const w of words(email)) add(w); }
  for (const w of words(lead.category)) add(w);
  for (const w of words(lead.address)) add(w);
  return out.slice(0, MAX_TOKENS);
}

// The words of a search box value. A value with an "@" stays one word so an
// email (or the start of one) matches the whole-email token.
export function queryWords(term) {
  return normalize(term).trim().split(/\s+/)
    .flatMap((part) => (part.includes('@') ? [part] : part.split(/[^a-z0-9]+/)))
    .filter((w) => w.length > 1);
}
