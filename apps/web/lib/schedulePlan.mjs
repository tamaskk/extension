// Scheduling ahead: which day and which sender account each lead of a selection
// gets, so that every sender's days are filled up to their limit and no further.
// Pure: the numbers from the database (emails sent today, leads already due on
// each day) are handed in, so the preview and the write decide by the same code.
//
// A lead put in "for Thursday" is an ordinary enrolment whose first email falls
// due on Thursday (`seq.nextStepAt`). The send round is unchanged and still
// decides on its own at every call: this only chooses the due times so that it
// finds a full day's work on each day, and not three days' work on the first.
import { dayKey, dayStart, warmupStatus } from './warmup.mjs';
import { isInsideWindow, nextOpening, windowOf } from './sendWindow.mjs';
import { SPREAD_MINUTES } from './enrollPlan.mjs';

// A plan never reaches further than this many days from today.
export const HORIZON_DAYS = 120;

// 1 = Monday ... 7 = Sunday, of a 'YYYY-MM-DD' day
const weekdayOf = (key) => ((new Date(key + 'T12:00:00.000Z').getUTCDay() + 6) % 7) + 1;

// The calendar days from today on, in the warm-up zone: [{ day, start, end }]
// with the instants the day begins and ends. Stepped from noon to noon, so the
// two clock changes of the year neither skip a day nor give one twice.
export function daysAhead(now, count) {
  const out = [];
  let start = dayStart(now).getTime();
  for (let i = 0; i < count; i++) {
    const next = dayStart(new Date(start + 36 * 3_600_000)).getTime();
    out.push({ day: dayKey(new Date(start + 12 * 3_600_000)), start, end: next });
    start = next;
  }
  return out;
}

// What each sender can still take on each day: Map(senderId → [row]), a row per
// day of `days`:
//   cap     the limit of that day, by the warm-up tiers as they will stand then; 0 on a day it does not send
//   booked  emails that already count against it: sent today, due on that day, and what the days before could not hold
//   free    cap - booked, never below 0
//   open    whether it is one of the sender's sending days
// `booked` is Map(senderId → Map(day → count)) of the leads already due; a lead
// due before today counts on today. `sentToday` is Map(senderId → count).
// A sender is a row as lib/warmup.mjs and lib/sendWindow.mjs read it, plus
// `lastSentBeforeToday` for today's limit.
export function capacityPlan(senders, days, { booked, sentToday } = {}) {
  const out = new Map();
  for (const s of senders || []) {
    const w = windowOf(s);
    const mine = (booked && booked.get(s.senderId)) || new Map();
    const firstOpen = days.find((d) => w.days.includes(weekdayOf(d.day)));
    const rows = [];
    let carry = 0; // due leads a day could not hold go out on the next sending day
    days.forEach((d, i) => {
      const open = w.days.includes(weekdayOf(d.day)) && w.to > w.from;
      // An account that never sent starts its tiers on the first day it gets
      // work. After today nobody knows how long it will have been idle, so only
      // today's limit can be a step back.
      const then = { ...s, firstSendAt: s.firstSendAt || (firstOpen ? new Date(firstOpen.start).toISOString() : ''), lastSentBeforeToday: i === 0 ? s.lastSentBeforeToday : '' };
      const cap = open ? warmupStatus(then, new Date(d.start + 12 * 3_600_000)).cap : 0;
      const due = (mine.get(d.day) || 0) + (i === 0 ? Math.max(0, Number(sentToday && sentToday.get(s.senderId)) || 0) : 0) + carry;
      carry = Math.max(0, due - cap);
      rows.push({ day: d.day, start: d.start, end: d.end, cap, booked: due, free: Math.max(0, cap - due), open });
    });
    out.set(s.senderId, rows);
  }
  return out;
}

// The moment a lead's first email falls due on a day: the first sending hour
// where the lead is, inside that day, plus a scatter so a day's leads do not
// all fall due in the same minute. null when the day has no sending hour for it.
function dueTimeOn(row, sender, tz, now, random, cache) {
  const id = `${tz}|${sender.senderId}|${row.day}`;
  const lead = { seq: { tz } };
  let opening = cache.get(id);
  if (opening === undefined) {
    let from = Math.max(now.getTime(), row.start);
    // A later day begins at midnight in Budapest, which is the evening before in
    // America: the last hour of yesterday's window there. The lead is due when
    // its own morning comes, so the tail of that window is stepped over, unless
    // the day holds no other sending hour for it.
    const tail = from;
    if (row.start > now.getTime()) while (from < row.end && isInsideWindow(lead, sender, new Date(from))) from += 15 * 60_000;
    let at = nextOpening(lead, sender, new Date(from));
    if (!(at && at.getTime() < row.end) && tail !== from) at = new Date(tail);
    opening = at && at.getTime() < row.end ? at.getTime() : null;
    cache.set(id, opening);
  }
  if (opening === null) return null;
  const scattered = Math.min(opening + Math.floor(random() * SPREAD_MINUTES * 60_000), row.end - 60_000);
  // a scatter that lands after the window has closed would move the email to the next day, against that day's limit
  return isInsideWindow(lead, sender, new Date(scattered)) ? scattered : opening;
}

// Places leads on days and senders, as early as possible.
//   leads     [{ key, language, tz }] in the order they should be preferred
//   senders   the accounts that may take them, each with its `language`
//   capacity  the answer of capacityPlan for these senders; it is not changed
//   fromDay, toDay   the first and last day ('YYYY-MM-DD') that may be used
// → { placed: [{ key, senderId, day, at }], left: [key], filled: Map(senderId → Map(day → count)) }
// A lead goes to the earliest day on which a sender of its language has room
// and it is a sending hour where the lead is; of several such senders, to the
// one with the most room left that day. `left` are the leads no day could take.
export function fillSchedule(leads, senders, capacity, { fromDay, toDay, now = new Date(), random = Math.random }) {
  const free = new Map();
  for (const s of senders || []) free.set(s.senderId, (capacity.get(s.senderId) || []).map((r) => r.free));
  const days = ((senders || []).length ? capacity.get(senders[0].senderId) || [] : []);
  const at0 = days.findIndex((d) => d.day >= fromDay);
  const first = at0 < 0 ? days.length : at0;
  const cache = new Map();
  const startOf = new Map(); // per language: the first day that may still have room
  const placed = [], left = [];
  const filled = new Map();
  for (const lead of leads || []) {
    const mine = (senders || []).filter((s) => s.language === lead.language);
    let i = startOf.has(lead.language) ? startOf.get(lead.language) : first;
    let hit = null;
    let fullSoFar = true;
    for (; i < days.length && days[i].day <= toDay; i++) {
      const withRoom = mine.filter((s) => free.get(s.senderId)[i] > 0).sort((a, b) => free.get(b.senderId)[i] - free.get(a.senderId)[i]);
      // a day that is full for the language is full for every later lead of it too
      if (!withRoom.length) { if (fullSoFar) startOf.set(lead.language, i + 1); continue; }
      fullSoFar = false;
      for (const s of withRoom) {
        const at = dueTimeOn(capacity.get(s.senderId)[i], s, lead.tz, now, random, cache);
        if (at !== null) { hit = { s, at }; break; }
      }
      if (hit) break;
    }
    if (!hit) { left.push(lead.key); continue; }
    free.get(hit.s.senderId)[i]--;
    placed.push({ key: lead.key, senderId: hit.s.senderId, day: days[i].day, at: new Date(hit.at).toISOString() });
    if (!filled.has(hit.s.senderId)) filled.set(hit.s.senderId, new Map());
    const f = filled.get(hit.s.senderId);
    f.set(days[i].day, (f.get(days[i].day) || 0) + 1);
  }
  return { placed, left, filled };
}

// How many leads of a language the days from `fromDay` to `toDay` can still take.
export function roomFor(language, senders, capacity, fromDay, toDay) {
  let n = 0;
  for (const s of senders || []) {
    if (s.language !== language) continue;
    for (const r of capacity.get(s.senderId) || []) if (r.day >= fromDay && r.day <= toDay) n += r.free;
  }
  return n;
}

// A 'YYYY-MM-DD' the operator typed, or '' when it is not a real day.
export function parseDay(value) {
  const v = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const t = Date.parse(v + 'T12:00:00.000Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : '';
}
