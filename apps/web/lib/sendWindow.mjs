// When an email may go out, by the clock on the RECIPIENT's wall. Pure.
//
// The contiguous United States span four time zones. An email sent at 7:00 on
// the east coast reaches California at 4:00 in the morning, and an email in the
// small hours is the strongest sign of automation a filter, or a person, can
// see. So the window is applied to the lead's own local time, found from the
// coordinates the Maps scraper stored with every lead.
//
// The zone comes from lib/timezoneFromCoords.mjs, an offline approximation. It
// is found once, when a lead is enrolled, and stored (`seq.tz`); the
// dispatcher never works it out again.

import { ZONES, timezoneFromCoords } from './timezoneFromCoords.mjs';

// A sender without settings of its own sends Monday to Friday, 7:00 to 19:00.
export const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5]; // 1 = Monday ... 7 = Sunday
export const DEFAULT_WINDOW_FROM = 7;
export const DEFAULT_WINDOW_TO = 19;
// A test run sends at most this many emails, whatever is due.
export const TEST_MODE_MAX = 3;

const ADDRESS_ZONES = [
  [/(hungary|magyarorsz[aá]g)\s*$/i, 'Europe/Budapest'],
  [/(united kingdom|\buk)\s*$/i, 'Europe/London'],
  [/(portugal)\s*$/i, 'Europe/Lisbon'],
  [/(greece|ελλάδα)\s*$/i, 'Europe/Athens'],
  [/(hong kong)\s*$/i, 'Asia/Hong_Kong'],
  [/(taiwan)\s*$/i, 'Asia/Taipei'],
  [/(austria|österreich|belgium|belgië|belgique|france|italy|italia|netherlands|nederland|spain|españa|switzerland|schweiz|suisse)\s*$/i, 'Europe/Budapest'],
];

// The IANA time zone a lead lives in: the one it already carries (`seq.tz`), or
// from its coordinates, or else from the country its address ends in. '' when
// none of them says: such a lead is left out of sending, it is not given
// somebody else's clock. Never throws.
export function zoneOf(lead) {
  const l = lead || {};
  if (l.seq && l.seq.tz) return l.seq.tz;
  const byPlace = timezoneFromCoords(l.lat, l.lng, l.country);
  if (byPlace) return byPlace;
  const address = String(l.address || '').trim().replace(/[.,;]+$/, '');
  for (const [pattern, zone] of ADDRESS_ZONES) if (pattern.test(address)) return zone;
  return '';
}

// Every zone a lead can have: what the dispatcher asks about when it needs to
// know where it is a sending hour right now.
export const ALL_ZONES = [...new Set([...ZONES, ...ADDRESS_ZONES.map((a) => a[1])])];

const formatters = new Map();
// The weekday (1 = Monday ... 7 = Sunday), hour and minute on a wall clock in
// `zone`. null for no zone, or one the runtime does not know.
function localClock(date, zone) {
  if (!zone) return null;
  let f = formatters.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      f = null; // remembered, so the same bad zone is not tried on every call
    }
    formatters.set(zone, f);
  }
  if (!f) return null;
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1, hour: Number(p.hour), minute: Number(p.minute) };
}

// The sender's window, with the defaults filled in.
export function windowOf(sender) {
  const s = sender || {};
  const days = Array.isArray(s.sendDays) && s.sendDays.length ? s.sendDays.map(Number).filter((d) => d >= 1 && d <= 7) : DEFAULT_SEND_DAYS;
  const hour = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 24 ? v : fallback);
  return { days, from: hour(s.windowFrom, DEFAULT_WINDOW_FROM), to: hour(s.windowTo, DEFAULT_WINDOW_TO) };
}

// Is it a sending hour where the lead is? The sender's days and hours are read
// on the lead's clock, not the sender's and not the server's.
export function isInsideWindow(lead, sender, now = new Date()) {
  const w = windowOf(sender);
  const c = localClock(now, zoneOf(lead));
  // no known clock, no send: never an email at an hour nobody chose
  if (!c) return false;
  return w.days.includes(c.day) && c.hour >= w.from && c.hour < w.to;
}

// The next moment the window is open for this lead: `now` when it is open
// already, otherwise the start of the next quarter hour that falls inside it.
// null when the sender's window never opens (no days, or no hours).
export function nextOpening(lead, sender, now = new Date()) {
  if (isInsideWindow(lead, sender, now)) return new Date(now.getTime());
  const QUARTER = 15 * 60_000;
  let t = Math.ceil((now.getTime() + 1) / QUARTER) * QUARTER;
  for (let i = 0; i < 8 * 24 * 4; i++, t += QUARTER) {
    const at = new Date(t);
    if (isInsideWindow(lead, sender, at)) return at;
  }
  return null;
}

// Of these zones, the ones where the window is open right now. The dispatcher
// asks for the due leads of exactly these, so a mixed American queue spreads
// over the day by itself: the east coast in the morning, the west coast later.
export function zonesOpenNow(zones, sender, now = new Date()) {
  return [...new Set(zones || [])].filter((zone) => isInsideWindow({ seq: { tz: zone } }, sender, now));
}

// What the two switches of a dispatcher run mean.
//   ignoreWindow  send whatever the hour is; for the operator's own tests
//   testMode      no window either, and at most TEST_MODE_MAX emails per run
// → { checkWindow, maxSends } with maxSends null when there is no extra cap.
export function runLimits({ ignoreWindow, testMode } = {}) {
  if (testMode) return { checkWindow: false, maxSends: TEST_MODE_MAX };
  return { checkWindow: !ignoreWindow, maxSends: null };
}
