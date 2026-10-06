// The pure side of the suppression list (lib/suppression.ts): how an address is
// keyed and which domains may be blocked as a whole. Tested without a database.
import { normalizeEmail } from './inboxClassify.mjs';

// Mailbox providers, not company domains: thousands of unrelated people share
// one. Blocking the whole domain because one of them asked would block them all,
// so a domain block is refused for these. The list lives here and nowhere else.
export const COMMON_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  // the Hungarian ones a local business is likely to use
  'freemail.hu', 'citromail.hu', 'indamail.hu', 't-online.hu', 't-email.hu', 'upcmail.hu', 'vipmail.hu',
]);

// A domain as typed or pasted ("Example.com", "@example.com", "https://www.example.com/")
// → "example.com". '' when it is not a domain.
export function normalizeDomain(value) {
  const d = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').replace(/^www\./, '').replace(/[/?#:].*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : '';
}

export function domainOf(email) {
  const e = normalizeEmail(email);
  return e ? normalizeDomain(e.slice(e.lastIndexOf('@') + 1)) : '';
}

export function isCommonProvider(domain) {
  return COMMON_PROVIDERS.has(normalizeDomain(domain));
}

// The `email` field is unique and required, so a domain-wide row needs a value
// there too: "@example.com", which no real address can be.
export function domainRowKey(domain) {
  const d = normalizeDomain(domain);
  return d ? '@' + d : '';
}

// What to look up to know whether an address may be written to: its own row,
// and the domain-wide row of its domain unless that is a mailbox provider.
// → { email, domain } with '' for a part that does not apply; email '' means
// the address itself is unusable.
export function lookupKeys(email, domain) {
  const e = normalizeEmail(email);
  const d = normalizeDomain(domain) || domainOf(e);
  return { email: e, domain: d && !isCommonProvider(d) ? d : '' };
}
