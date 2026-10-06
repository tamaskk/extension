// Timing and bookkeeping of the outreach runner tab (components/OutreachRunner.tsx):
// a browser tab left open around the clock that calls POST /api/outreach/tick.
// The tab only schedules; what is sent is decided by the route. Pure functions,
// so the rhythm can be tested without a browser.

// Chrome wakes the timers of a background tab about once a minute, so a faster
// rhythm buys nothing, and one sender sends 30 to 50 emails a day.
export const DEFAULT_DELAY_MS = 45_000;
export const MIN_DELAY_MS = 10_000;
// The route may ask for a longer wait (night, quota used up), but the watchdog
// calls the loop dead after 10 minutes without a tick: never wait longer than this.
export const MAX_DELAY_MS = 5 * 60_000;
// A function runs for 60 seconds at most; a request still open after this hangs.
export const REQUEST_TIMEOUT_MS = 70_000;
// How long past the next planned tick a tab keeps its claim on the loop. Longer
// than the one-minute timer throttling, so a late tick does not lose the claim.
export const LOCK_MARGIN_MS = 120_000;
// About a day of ticks at the default rhythm.
export const LOG_CAP = 2000;

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

// Wait before the next tick after a good answer; `serverMs` is the route's hint.
export function nextDelay(serverMs) {
  const ms = Number(serverMs);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(ms)));
}

// Wait after the nth failure in a row (1-based): 30 s, 1 min, 2 min, then 5 min for good.
export function backoffDelay(failures) {
  const i = Math.max(1, Math.floor(Number(failures) || 1)) - 1;
  return BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
}

// `lock` is { id, until } from localStorage. A tab may run the loop when nobody
// holds the lock, when it holds it itself, or when the holder's claim ran out
// (the other tab crashed or was closed without letting go).
export function lockIsFree(lock, tabId, now) {
  if (!lock || typeof lock.id !== 'string' || !Number.isFinite(lock.until)) return true;
  return lock.id === tabId || lock.until <= now;
}

// The log with one more entry, oldest dropped past the cap.
export function appendLog(log, entry, cap = LOG_CAP) {
  const next = log.concat([entry]);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// Longest pause between two neighbouring ticks of the log, in ms (0 for fewer than two).
export function longestGapMs(log) {
  let max = 0;
  for (let i = 1; i < log.length; i++) max = Math.max(max, log[i].at - log[i - 1].at);
  return max;
}
