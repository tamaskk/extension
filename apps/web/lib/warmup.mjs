// How many emails a sender account may send today. A new mailbox that sends 35
// cold emails on its first day leaves a pattern at the spam filters, so the
// daily limit climbs in tiers, and the tiers are data on the account, not code:
// when an account gets a complaint, its pace can be taken back without a deploy.
//
// Pure: no database, no environment. The dashboard runs the same functions to
// show the limit, so what the screen says is what the dispatcher does.
//
// A sender here is { dailyLimit, firstSendAt, warmup: { enabled, tiers } } and
// a tier is { fromDay, dailyLimit }. Tiers are stored sorted by fromDay; the
// sorting happens on save (normalizeTiers), not here. The last tier holds for good.

// The day turns at midnight in this zone, for every sender. A fixed zone and
// never the server's local time: the functions run in fra1 today, but that is
// not a promise.
export const WARMUP_TIME_ZONE = 'Europe/Budapest';
// An account that sent nothing for longer than this many days does not come
// back at the tier it left: on the day it sends again it is one tier lower.
export const IDLE_DAYS = 3;
// The ceiling of an account that has none of its own.
export const DEFAULT_DAILY_LIMIT = 100;
export const DEFAULT_TIERS = [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }, { fromDay: 14, dailyLimit: 30 }, { fromDay: 21, dailyLimit: 35 }];
const MAX_LIMIT = 2000;

const zoneParts = (date, timeZone) => {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date)) p[type] = Number(value);
  return p;
};

// The calendar day an instant falls on in the warm-up zone, as 'YYYY-MM-DD'.
export function dayKey(date, timeZone = WARMUP_TIME_ZONE) {
  const p = zoneParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Calendar days from one instant to another in the warm-up zone: 0 on the same
// day, 1 once midnight has passed. Days, not hours divided by 24, so the two
// clock changes of the year neither skip a day nor count one twice.
// null when `from` is not a date.
export function daysBetween(from, now, timeZone = WARMUP_TIME_ZONE) {
  const start = from instanceof Date ? from.getTime() : Date.parse(from || '');
  if (!Number.isFinite(start)) return null;
  const noon = (key) => Date.parse(key + 'T12:00:00.000Z');
  return Math.round((noon(dayKey(now, timeZone)) - noon(dayKey(new Date(start), timeZone))) / 86_400_000);
}

// The instant today began in the warm-up zone. "Sent today" counts from here,
// so the count and the limit turn over at the same moment.
export function dayStart(now, timeZone = WARMUP_TIME_ZONE) {
  const p = zoneParts(now, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day);
  // the zone's offset at an instant = its wall clock read as UTC, minus the instant
  const offsetAt = (ms) => { const q = zoneParts(new Date(ms), timeZone); return Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - Math.floor(ms / 1000) * 1000; };
  let start = wall - offsetAt(wall);
  // on the day the clocks change, the offset at midnight differs from the one just used
  start = wall - offsetAt(start);
  return new Date(start);
}

const isCount = (n) => Number.isInteger(n) && n >= 0;

// What is wrong with a list of tiers, as one sentence, or null when it is sound.
// A tier lower than the one before it is allowed on purpose: stepping back is a
// thing an operator needs.
export function validateWarmup(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return 'The warm-up needs at least one tier.';
  const days = new Set();
  for (const t of tiers) {
    if (!t || typeof t !== 'object') return 'A tier is missing its values.';
    if (!isCount(t.fromDay)) return 'Every tier needs a start day: a whole number, 0 or more.';
    if (!isCount(t.dailyLimit) || t.dailyLimit > MAX_LIMIT) return `Every tier needs a daily limit: a whole number between 0 and ${MAX_LIMIT}.`;
    if (days.has(t.fromDay)) return `Two tiers start on day ${t.fromDay}.`;
    days.add(t.fromDay);
  }
  if (!days.has(0)) return 'The first tier must start on day 0.';
  return null;
}

// The tiers as they are stored: only the two fields, sorted by start day.
export function normalizeTiers(tiers) {
  return (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ fromDay: Number(t && t.fromDay), dailyLimit: Number(t && t.dailyLimit) }))
    .sort((a, b) => a.fromDay - b.fromDay);
}

// Everything about today's limit of a sender:
//   cap        emails it may send today
//   hard       its own ceiling, which no tier can lift
//   day        calendar days since its first send; null before the first send
//   tier       the tier in force, or null when the warm-up is off or empty
//   idleDays   calendar days since its last email before today; null when unknown
//   steppedBack  true when it is one tier lower today because it was idle too long
// `sender.lastSentBeforeToday` (ISO) is its last email on an earlier day. It is
// "before today" on purpose: an account that comes back after a pause stays a
// tier lower for the whole day, not only until its first email of the day.
export function warmupStatus(sender, now = new Date()) {
  const s = sender || {};
  const hard = isCount(s.dailyLimit) ? s.dailyLimit : DEFAULT_DAILY_LIMIT;
  const w = s.warmup;
  const day = s.firstSendAt ? daysBetween(s.firstSendAt, now) : null;
  const idleDays = s.lastSentBeforeToday ? daysBetween(s.lastSentBeforeToday, now) : null;
  if (!w || !w.enabled || !Array.isArray(w.tiers) || !w.tiers.length) return { cap: hard, hard, day, tier: null, idleDays, steppedBack: false };
  let index = 0;
  // before the first send, and with an unreadable date, the account is on the first tier
  if (day !== null) for (let i = 0; i < w.tiers.length; i++) { if (day >= w.tiers[i].fromDay) index = i; else break; }
  // A mailbox that fell silent has lost part of what the warm-up built. Coming
  // back at full pace after days of nothing is the jump the tiers exist to avoid.
  const steppedBack = idleDays !== null && idleDays > IDLE_DAYS && index > 0;
  const limitOf = (t) => Math.max(0, Math.min(Number(t.dailyLimit) || 0, hard));
  const reached = w.tiers[index];
  if (steppedBack) index -= 1;
  const tier = w.tiers[index];
  // a tier may be lower than the one before it, so the tier below can allow more: a step back never lifts the limit
  return { cap: Math.min(limitOf(tier), limitOf(reached)), hard, day, tier, idleDays, steppedBack };
}

export function dailyCapFor(sender, now = new Date()) {
  return warmupStatus(sender, now).cap;
}

// The status line under the tier table, in words.
export function describeWarmup(sender, now = new Date()) {
  const { cap, hard, day, tier, idleDays, steppedBack } = warmupStatus(sender, now);
  if (!tier) return `Warm-up off: ${cap} a day, the account's own ceiling.`;
  const where = day === null ? 'Nothing sent yet, so the first tier applies' : `Day ${day} since the first send, tier from day ${tier.fromDay}`;
  const capped = tier.dailyLimit > hard ? ` (the tier allows ${tier.dailyLimit}, the ceiling of ${hard} holds it back)` : '';
  const back = steppedBack ? ` Stepped back one tier, because it sent nothing for ${idleDays} days.` : '';
  return `${where}: ${cap} a day today${capped}.${back}`;
}
