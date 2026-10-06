// Is an address worth writing to, and which of a lead's addresses is the best?
// Pure: patterns only, no network. Whether the domain takes mail at all (its MX
// record) is asked apart, at enrolment.
//
// The addresses come from the business's own website, collected by the
// extension. Among them are noreply@ boxes, typos, leftovers of a site
// template, and the address of the agency that built the site. One bounce is
// nothing; the bounce RATE is what burns a sender: above 2 % mail providers
// start to filter it, above 5 % the mailbox itself can be suspended, replies
// and all. An uncleaned list burns the domain with its first thousand emails.
import { isCommonProvider } from './suppressionRules.mjs';

const VALID = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// Boxes nobody reads, or that answer for a machine.
const NEVER = new Set(['noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'postmaster', 'mailer-daemon', 'abuse', 'webmaster', 'hostmaster', 'privacy', 'gdpr', 'dpo', 'bounce', 'bounces', 'unsubscribe', 'newsletter']);
// What a site template or an example leaves behind.
const JUNK_LOCAL = new Set(['test', 'example', 'email', 'name', 'yourname', 'your.name', 'user', 'username', 'someone', 'john.doe', 'jane.doe', 'firstname.lastname', 'mail', 'you']);
const JUNK_DOMAIN = /^(example\.(com|org|net)|domain\.com|yourdomain\.com|email\.com|test\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|godaddy\.com|squarespace\.com|mysite\.com|company\.com|website\.com)$/;
// A file name that looked like an address to the collector: logo@2x.png
const FILE_TLD = /\.(png|jpe?g|gif|webp|svg|css|js)$/;
// Shared boxes: fine to write to, but a named person is better.
const ROLE = new Set(['info', 'contact', 'office', 'hello', 'hi', 'admin', 'sales', 'support', 'help', 'team', 'iroda', 'titkarsag', 'kapcsolat', 'ugyfelszolgalat', 'rendeles', 'reception', 'booking', 'bookings', 'enquiries', 'inquiries']);

const hostOf = (website) => {
  const w = String(website || '').trim().toLowerCase();
  if (!w) return '';
  const host = w.replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
};
// example.co.uk and shop.example.co.uk belong together, example.com and other.com do not
const sameSite = (a, b) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a);

// → { ok, reason, rank }. `rank` orders a lead's usable addresses, 1 the best:
//   1  a person at the business's own domain
//   2  a shared box (info@, contact@) at the business's own domain
//   3  a person at a company domain, when the lead has no website to compare with
//   4  a shared box at such a domain
//   5  an address at a mailbox provider (gmail.com and the like)
// `ok` false means: never write to it; `reason` says why, in words for the operator.
export function emailQuality(email, lead) {
  const e = String(email || '').trim().toLowerCase();
  if (!VALID.test(e) || e.includes('..')) return { ok: false, reason: 'not a valid address', rank: 99 };
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (FILE_TLD.test(domain)) return { ok: false, reason: 'a file name, not an address', rank: 99 };
  if (NEVER.has(local)) return { ok: false, reason: `${local}@ is not read by a person`, rank: 99 };
  if (JUNK_LOCAL.has(local) || JUNK_DOMAIN.test(domain)) return { ok: false, reason: 'a placeholder left in the website', rank: 99 };

  const role = ROLE.has(local);
  if (isCommonProvider(domain)) return { ok: true, reason: 'an address at a mailbox provider', rank: 5 };
  const site = hostOf(lead && lead.website);
  // a real site of its own, not a Facebook or Instagram page standing in for one
  const ownSite = site && !/(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|linktr\.ee|google\.com)$/.test(site);
  if (ownSite) {
    // Another company's domain on this business's website is most often the
    // agency that built the site. It must not get the email meant for its client.
    if (!sameSite(domain, site)) return { ok: false, reason: `another company's domain (${domain}), probably the agency behind the website`, rank: 99 };
    return role ? { ok: true, reason: 'a shared box at the business\'s own domain', rank: 2 } : { ok: true, reason: 'a person at the business\'s own domain', rank: 1 };
  }
  return role ? { ok: true, reason: 'a shared box at a company domain', rank: 4 } : { ok: true, reason: 'a person at a company domain', rank: 3 };
}

// The one address a lead is written to: the best-ranked usable one among its
// `email` and `emails`. One address per lead, never two of the same business:
// that would count twice in every complaint.
// → { email, rank, reason } with email '' when none is usable; `reason` then
// says what was wrong with the best candidate.
export function bestEmail(lead) {
  const l = lead || {};
  const seen = new Set();
  let best = null, firstBad = null;
  for (const c of [l.email, ...(Array.isArray(l.emails) ? l.emails : [])]) {
    const e = String(c || '').trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    const q = emailQuality(e, l);
    if (!q.ok) { if (!firstBad) firstBad = q; continue; }
    if (!best || q.rank < best.rank) best = { email: e, rank: q.rank, reason: q.reason };
  }
  return best || { email: '', rank: 99, reason: firstBad ? firstBad.reason : 'no address' };
}
