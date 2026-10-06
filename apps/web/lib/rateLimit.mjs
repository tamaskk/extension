// In-memory sliding-window rate limiter (same idea as apps/tokenleads/lib/rateLimit.ts).
// The window lives in the memory of one function instance, so on Vercel the
// real ceiling is max × the number of warm instances. That is enough to make
// password guessing against the single login slow; it is not an exact quota.

const buckets = new Map(); // key → call timestamps (ms), oldest first
let lastSweep = 0;

// → { ok, retryAfter } where retryAfter is seconds until the next call is allowed
export function limit(key, max, windowMs, now = Date.now()) {
  // Occasional sweep so keys that stopped calling do not pile up.
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, arr] of buckets) if (!arr.length || arr[arr.length - 1] <= now - windowMs) buckets.delete(k);
  }
  const arr = (buckets.get(key) || []).filter((t) => t > now - windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, retryAfter: 0 };
}

// test hook
export function resetLimits() { buckets.clear(); lastSweep = 0; }
