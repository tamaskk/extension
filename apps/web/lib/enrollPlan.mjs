// Which leads of a selection go into a sequence, and with what. Pure: the
// database reads (suppressions, running domains, senders) are handed in, so the
// preview and the real run decide by the same code and the rules are tested
// without a database.
//
// A wrong enrolment is expensive to undo: the state sits on the lead, and the
// only way back is another bulk write. So the order of the checks is fixed and
// every lead that is left out is counted under the reason that left it out.
import { nextEnabledStep, validateSequence } from './outreachSequence.mjs';
import { assignSenders, companyDomainOf } from './dispatchPlan.mjs';
import { lookupKeys } from './suppressionRules.mjs';
import { zoneOf } from './sendWindow.mjs';
import { bestEmail } from './emailQuality.mjs';
import { routeOffer } from './routeOffer.mjs';

// The first emails of a batch are spread over this long, so that the whole
// batch does not fall due in the same minute.
export const SPREAD_MINUTES = 120;

// The one address a lead is written to: the best-ranked usable one among its
// `email` and `emails` (lib/emailQuality.mjs). '' when none is usable.
export function pickEmail(lead) {
  return bestEmail(lead).email;
}

// The language a lead is written in, from the country of its project: Hungarian
// in Hungary, English in every other known country. '' when the country is not
// known: such a lead is not enrolled on a guess.
export function languageOfCountry(country) {
  if (!country || country === 'Other') return '';
  return country === 'Hungary' ? 'hu' : 'en';
}

// The senders that may serve a sequence: switched on, with a password, of the
// sequence's language, and among the ones the sequence names when it names any.
export function eligibleSenders(sequence, senders) {
  const named = Array.isArray(sequence && sequence.senderIds) ? sequence.senderIds : [];
  return (senders || []).filter((s) => s && s.active && s.hasPassword !== false && s.language === sequence.language && (!named.length || named.includes(s.senderId)));
}

// Why a sequence cannot take leads at all, or '' when it can.
export function enrolmentBlock(sequence, senders) {
  if (!sequence) return 'The sequence was not found.';
  const errors = validateSequence(sequence);
  if (errors.length) return 'This sequence is not complete: ' + errors.join(' ');
  if (!eligibleSenders(sequence, senders).length) return `No sender account is switched on for this sequence (language: ${sequence.language}).`;
  return '';
}

export const SKIP_REASONS = ['noEmail', 'badEmail', 'noMx', 'active', 'replied', 'suppressed', 'alreadyMailed', 'languageUnknown', 'language', 'noTimezone', 'domain', 'noSender', 'overLimit'];

// → { take, skipped, bySender, byLanguage }
//   take      [{ project, key, name, seq }]: `seq` is the subdocument to write
//   skipped   { reason: count } for every reason in SKIP_REASONS
// `candidates` are leads as { project, key, name, email, emails, seqStatus, country, lat, lng, address }
// plus the fields lib/emailQuality.mjs and lib/routeOffer.mjs read (website, category, rating, ...).
// `ctx` holds:
//   sequence, senders        (senders as lib/warmup.mjs reads them, plus language, active, hasPassword)
//   isSuppressed(email, domain) → boolean, for the address and for its company domain
//   hasMx(domain) → false when the domain takes no mail at all; anything else lets the lead through
//   wasMailed(email, companyDomain) → true when that address, or that company, got a sequence email before
//   busyDomains              Map or Set of company domains with a running sequence
//   room                     how many more leads this run may take
//   ignoreLanguage           true to take leads whose language differs or is unknown
//   now, random
// The checks run in this order, and the first one that fails names the reason:
// a usable address at a domain that takes mail, no running sequence, not
// suppressed, the language, a known time zone, a free company domain, a sender.
export function planEnrollment(candidates, ctx) {
  const { sequence, isSuppressed, busyDomains, ignoreLanguage } = ctx;
  const now = ctx.now || new Date();
  const random = ctx.random || Math.random;
  const room = ctx.room === undefined ? Infinity : Math.max(0, ctx.room);
  const skipped = Object.fromEntries(SKIP_REASONS.map((r) => [r, 0]));
  const byLanguage = {};
  const first = nextEnabledStep(sequence, '');
  const senders = eligibleSenders(sequence, ctx.senders);

  const passed = [];
  const taken = new Set(); // company domains taken earlier in this same batch
  for (const c of candidates || []) {
    const pick = bestEmail(c);
    const to = pick.email;
    // 'no address' is a lead without one; anything else is an address that must not be written to
    if (!to) { if (pick.reason === 'no address') skipped.noEmail++; else skipped.badEmail++; continue; }
    // a domain without an MX record takes no mail: the email is certain to bounce
    if (ctx.hasMx && ctx.hasMx(to.slice(to.lastIndexOf('@') + 1)) === false) { skipped.noMx++; continue; }
    // on hold: an email to it may have gone out and waits for the operator's decision; a new series now could double it
    // waiting: it got the opening email and its follow-ups have not been started
    if (c.seqStatus === 'active' || c.seqStatus === 'hold' || c.seqStatus === 'waiting') { skipped.active++; continue; }
    // someone who answered is in a conversation; a new series on top of it is not wanted
    if (c.seqStatus === 'replied') { skipped.replied++; continue; }
    const keys = lookupKeys(to);
    if (isSuppressed(keys.email, keys.domain)) { skipped.suppressed++; continue; }
    // One opening email per company, ever. The same company can be several leads
    // (several branches, or scraped again under another project): whoever was
    // written to once is not written to again as if for the first time.
    if (ctx.wasMailed && ctx.wasMailed(to, companyDomainOf(to))) { skipped.alreadyMailed++; continue; }
    const language = languageOfCountry(c.country);
    byLanguage[language || 'unknown'] = (byLanguage[language || 'unknown'] || 0) + 1;
    if (!ignoreLanguage) {
      if (!language) { skipped.languageUnknown++; continue; }
      if (language !== sequence.language) { skipped.language++; continue; }
    }
    // No zone, no enrolment: the send window runs on the lead's own clock, and a
    // lead without one would sit in the sequence for good without ever being sent to.
    const tz = zoneOf({ lat: c.lat, lng: c.lng, address: c.address, country: c.country });
    if (!tz) { skipped.noTimezone++; continue; }
    const domain = companyDomainOf(to);
    if (domain && ((busyDomains && busyDomains.has(domain)) || taken.has(domain))) { skipped.domain++; continue; }
    if (passed.length >= room) { skipped.overLimit++; continue; }
    if (domain) taken.add(domain);
    passed.push({ c, to, language, tz });
  }

  const assigned = first ? assignSenders(passed.map((p) => p.c.key), senders, now) : new Map();
  const take = [];
  const bySender = {};
  for (const p of passed) {
    const senderId = assigned.get(p.c.key);
    if (!senderId) { skipped.noSender++; continue; }
    bySender[senderId] = (bySender[senderId] || 0) + 1;
    take.push({
      project: p.c.project, key: p.c.key, name: p.c.name || '',
      seq: {
        sequenceId: sequence.sequenceId,
        stepId: first.step.id,
        nextStepAt: new Date(now.getTime() + Math.floor(random() * SPREAD_MINUTES * 60_000)).toISOString(),
        senderId,
        to: p.to,
        // the sequence's language: it is the language the lead will be written in
        language: sequence.language,
        // found here, once; the dispatcher reads it and never works it out again
        tz: p.tz,
        // Which offer the second round makes (lib/routeOffer.mjs). Decided
        // here, once, so it cannot change in the middle of a sequence and the
        // reports stay stable. `offerManual` is set when the operator overrides it.
        ...offerOf(p.c),
        threadSubject: '',
        lastMessageId: '',
        sentStepIds: [],
        status: 'active',
        lastSentAt: '',
        claimedAt: '',
        errorCount: 0,
      },
    });
  }
  return { take, skipped, bySender, byLanguage };
}

function offerOf(lead) {
  const r = routeOffer(lead);
  return { offer: r.offer, offerScore: r.score, offerReasons: r.reasons, offerManual: false };
}

// Adds the skip counts of one chunk to a running total.
export function addSkipped(total, more) {
  const out = { ...total };
  for (const r of SKIP_REASONS) out[r] = (out[r] || 0) + ((more && more[r]) || 0);
  return out;
}
