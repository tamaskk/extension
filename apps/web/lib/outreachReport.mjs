// Turns counted send rows into the outreach report. Pure: the route counts the
// rows of `outreachsends` (never of `leads`) and this folds the counts into
// totals, breakdowns, rates and warning levels.
//
// What SMTP lets us measure, and what it does not:
//   accepted   our own mail server took the email. That is not delivery.
//   bounced    an error email came back for good (a dead address)
//   soft       an error email came back for now (a full mailbox)
//   blocked    the receiving server refused US; the address is fine
//   replied, stopped   matched from the mailbox
// There is no "delivered" event. "Accepted minus what came back" is an
// ASSUMPTION of delivery and is named so everywhere. Inbox or spam folder
// cannot be seen at all, and neither can a complaint: nobody tells the sender
// when a recipient presses "spam".

// Above these a sender's reputation is in danger.
export const THRESHOLDS = { bounce: 0.02, block: 0.01 };
// Below this many emails a share says nothing: 3 bounces out of 20 are
// 3 bounces, not "15 %".
export const MIN_SAMPLE = 30;
// A Postmaster Tools figure older than this is too old to steer by.
export const POSTMASTER_MAX_AGE_DAYS = 14;

const ZERO = () => ({ sent: 0, bounced: 0, soft: 0, blocked: 0, replied: 0, stopped: 0, unknown: 0 });

// One counted group ({ outcome, bounceKind, n }) added to a tally.
function add(t, g) {
  const n = Number(g.n) || 0;
  t.sent += n;
  if (g.outcome === 'bounced') t.bounced += n;
  else if (g.outcome === 'blocked') t.blocked += n;
  else if (g.outcome === 'replied') t.replied += n;
  else if (g.outcome === 'stopped') t.stopped += n;
  else if (g.outcome === 'unknown') t.unknown += n;
  if (g.bounceKind === 'soft' && g.outcome !== 'bounced') t.soft += n;
}

// 'bad' at or over the threshold, 'warn' from three quarters of it, else 'ok'.
export function levelOf(rate, threshold) {
  if (rate === null || rate === undefined) return '';
  return rate >= threshold ? 'bad' : rate >= threshold * 0.75 ? 'warn' : 'ok';
}

// A tally with what follows from it. The rates are null while fewer than
// MIN_SAMPLE emails went out: the screen then shows the counts alone.
export function summarize(t) {
  const enough = t.sent >= MIN_SAMPLE;
  const rate = (n) => (enough ? n / t.sent : null);
  const rates = { bounce: rate(t.bounced), block: rate(t.blocked), reply: rate(t.replied), stop: rate(t.stopped) };
  return {
    ...t,
    // an estimate, not a measurement
    assumedDelivered: Math.max(0, t.sent - t.bounced - t.blocked - t.soft),
    enough, rates,
    levels: { bounce: levelOf(rates.bounce, THRESHOLDS.bounce), block: levelOf(rates.block, THRESHOLDS.block) },
  };
}

// `groups` are rows counted by { sequenceId, stepId, senderId, offer, outcome, bounceKind } with `n`.
// `names` gives the screen something to call things:
//   sequences  [{ sequenceId, name, steps: [{ id, variantOf? }] }]
//   senders    [{ senderId, label }]
// → { total, bySender, byStep, byOffer }, each row a summarized tally with a
// label. Steps come in the order of their sequence, a variant right after the
// step it is a wording of.
export function buildReport(groups, names) {
  const list = groups || [];
  const total = ZERO();
  const senders = new Map(), steps = new Map(), offers = new Map();
  const bucket = (map, key) => { if (!map.has(key)) map.set(key, ZERO()); return map.get(key); };
  for (const g of list) {
    add(total, g);
    add(bucket(senders, String(g.senderId || '')), g);
    add(bucket(steps, `${g.sequenceId || ''}|${g.stepId || ''}`), g);
    // only sequence emails have an offer; a draft sent by hand has none
    if (g.sequenceId) add(bucket(offers, String(g.offer || '')), g);
  }

  const senderLabel = new Map(((names && names.senders) || []).map((s) => [s.senderId, s.label]));
  const bySender = [...senders].map(([id, t]) => ({ id, label: id ? senderLabel.get(id) || 'A sender that no longer exists' : 'Sent by hand', ...summarize(t) }))
    .sort((a, b) => b.sent - a.sent);

  const byStep = [];
  const placed = new Set();
  for (const seq of (names && names.sequences) || []) {
    const all = Array.isArray(seq.steps) ? seq.steps : [];
    let position = 0;
    for (const main of all.filter((s) => !s.variantOf)) {
      position += 1;
      const wordings = [main, ...all.filter((v) => v.variantOf === main.id)];
      const hasVariants = wordings.length > 1;
      wordings.forEach((w, i) => {
        const key = `${seq.sequenceId}|${w.id}`;
        if (!steps.has(key)) return;
        placed.add(key);
        byStep.push({ id: key, sequence: seq.name || seq.sequenceId, label: `Step ${position}${hasVariants ? (i === 0 ? ', original wording' : `, variant ${i}`) : ''}`, variant: i > 0, ...summarize(steps.get(key)) });
      });
    }
  }
  // sends of a step or a sequence that was deleted since: still counted, named as what they are
  for (const [key, t] of steps) {
    if (placed.has(key)) continue;
    const [sequenceId] = key.split('|');
    const seq = ((names && names.sequences) || []).find((s) => s.sequenceId === sequenceId);
    byStep.push({ id: key, sequence: sequenceId ? (seq ? seq.name || sequenceId : 'A sequence that no longer exists') : 'Sent by hand', label: sequenceId ? 'A step that no longer exists' : 'Draft from the lead panel', variant: false, ...summarize(t) });
  }

  const OFFER = { ai: 'AI automation', social: 'Social media', '': 'No offer recorded' };
  const byOffer = [...offers].map(([id, t]) => ({ id, label: OFFER[id] || id, ...summarize(t) })).sort((a, b) => b.sent - a.sent);

  return { total: summarize(total), bySender, byStep, byOffer };
}

// The spam rate read by hand from Google Postmaster Tools, checked before it is
// stored. `spamRate` is a percentage, `date` the day it was read (YYYY-MM-DD).
// → { value: { spamRate, date } } or { error }.
export function cleanPostmaster(input, now = new Date()) {
  const b = input && typeof input === 'object' ? input : {};
  const spamRate = typeof b.spamRate === 'string' ? Number(b.spamRate.replace(',', '.').replace('%', '').trim() || NaN) : Number(b.spamRate);
  if (!Number.isFinite(spamRate) || spamRate < 0 || spamRate > 100) return { error: 'The spam rate must be a percentage between 0 and 100.' };
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00.000Z'))) return { error: 'The date must be a day, as YYYY-MM-DD.' };
  if (Date.parse(date + 'T00:00:00.000Z') > now.getTime()) return { error: 'The date cannot be in the future.' };
  return { value: { spamRate, date } };
}

// How old the Postmaster figure is, in whole days, and whether that is too old.
// A figure that was never entered is as stale as can be.
export function postmasterAge(date, now = new Date()) {
  const at = Date.parse(String(date || '') + 'T00:00:00.000Z');
  if (!Number.isFinite(at)) return { days: null, stale: true };
  const days = Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
  return { days, stale: days > POSTMASTER_MAX_AGE_DAYS };
}
