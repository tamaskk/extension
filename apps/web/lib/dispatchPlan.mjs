// Who sends to whom, and how much is left for today. Pure logic for enrolment
// and for the dispatcher; the numbers it needs from the database (emails sent
// today, domains with a running sequence) are handed in by the caller.
import { dailyCapFor } from './warmup.mjs';
import { domainOf, isCommonProvider } from './suppressionRules.mjs';
import { hashToUnit } from './stableHash.mjs';

// How many more emails this sender may send today. `sentToday` is counted from
// the `outreachsends` rows, never kept in memory: every call of a serverless
// function can be a new instance, so a counter in memory would start at 0 again.
export function remainingToday(sender, sentToday, now = new Date()) {
  return Math.max(0, dailyCapFor(sender, now) - Math.max(0, Number(sentToday) || 0));
}

// Which sender each lead gets: Map(dedupKey → senderId).
// - The shares follow today's limit of each sender (dailyCapFor), not an equal
//   split: a new account on 10 a day gets less than a third of what a settled
//   one on 35 a day gets.
// - Deterministic: it depends only on the lead's key and the senders, so
//   running it again gives the same answer. And when a sender is added or its
//   limit grows, only that sender's share of the leads moves; the rest keep
//   theirs (weighted rendezvous hashing).
// - Senders that are switched off or have no room at all get nothing. With no
//   usable sender the map is empty.
// The caller passes only the senders that may serve these leads (the right
// language, the ones the sequence allows). A lead keeps its sender for the
// whole sequence, so this runs at enrolment, not at every send.
export function assignSenders(leadKeys, senders, now = new Date()) {
  const usable = (senders || [])
    .filter((s) => s && s.senderId && s.active !== false)
    .map((s) => ({ id: String(s.senderId), weight: dailyCapFor(s, now) }))
    .filter((s) => s.weight > 0);
  const out = new Map();
  if (!usable.length) return out;
  for (const key of leadKeys || []) {
    let best = '', bestScore = Infinity;
    for (const s of usable) {
      const score = -Math.log(hashToUnit(`${key}|${s.id}`)) / s.weight;
      if (score < bestScore || (score === bestScore && s.id < best)) { best = s.id; bestScore = score; }
    }
    out.set(key, best);
  }
  return out;
}

// The domain that stands for a company, from an address. '' for an address at a
// mailbox provider (gmail.com and the like): thousands of unrelated businesses
// share those, so they never block each other. The provider list is the one of
// the suppression rules.
export function companyDomainOf(email) {
  const d = domainOf(email);
  return d && !isCommonProvider(d) ? d : '';
}

// One running sequence per company domain. The same company can be several
// leads here (several branches, several addresses at one domain; dedupKey is
// unique per place, not per company), and a sequence to each of them is spam in
// the eyes of the people who get it.
//
// `candidates` are [{ key, email }] in the order they should be preferred.
// `busyDomains` answers has(domain) for the domains that already have an active
// sequence (a Set or a Map). → { take, skipped }: `skipped` rows say which
// domain held them back. Within the batch the first lead of a domain wins.
export function pickOnePerDomain(candidates, busyDomains) {
  const seen = new Set();
  const take = [], skipped = [];
  for (const c of candidates || []) {
    const domain = companyDomainOf(c && c.email);
    if (!domain) { take.push(c); continue; }
    if ((busyDomains && busyDomains.has(domain)) || seen.has(domain)) { skipped.push({ key: c.key, domain }); continue; }
    seen.add(domain);
    take.push(c);
  }
  return { take, skipped };
}

// Before a send: is another lead's sequence running at this lead's company
// domain? `activeByDomain` is Map(domain → [dedupKey]) of the active sequences.
// The lead's own entry does not count.
export function domainHeldByAnother(activeByDomain, email, key) {
  const domain = companyDomainOf(email);
  if (!domain) return false;
  return ((activeByDomain && activeByDomain.get(domain)) || []).some((k) => k !== key);
}

// Between two emails of a sender: at least this long, at most that long.
export const GAP_MIN_MS = 10 * 60_000;
export const GAP_MAX_MS = 20 * 60_000;

// The pause a sender keeps after an email, before its next one: somewhere from
// GAP_MIN_MS to GAP_MAX_MS, different after every email and to the millisecond.
// Sending the day's emails one after another, or at an even spacing, is the
// rhythm of a machine; a person's pauses are uneven. It is worked out from the
// time of that email and not drawn: every call of a serverless function can be
// a new instance, and each round must find the same pause still running.
// 0 when the sender has sent nothing.
export function pauseAfter(senderId, lastSentAt) {
  if (!lastSentAt) return 0;
  return GAP_MIN_MS + Math.floor(hashToUnit(`${senderId}|${lastSentAt}|pause`) * (GAP_MAX_MS - GAP_MIN_MS));
}

// May the sender send again? `lastSentAt` is the time of its last email (ISO),
// '' when it has sent nothing. → { open, inMs }: inMs is how long is left.
export function gapState(lastSentAt, gapMs, now = new Date()) {
  const last = Date.parse(lastSentAt || '');
  if (!Number.isFinite(last)) return { open: true, inMs: 0 };
  const left = last + gapMs - now.getTime();
  return { open: left <= 0, inMs: Math.max(0, left) };
}
