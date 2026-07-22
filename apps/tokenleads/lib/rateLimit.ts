// In-memory sliding-window rate limiter + Mongo-backed daily quotas.
//
//   ┌ request ─▶ limit(key, max, windowMs) ── under? ─▶ proceed
//   │                                     └─ over?  ─▶ 429 {retryAfter}
//   └ paid search ─▶ bumpDailyQuota(...)  ── under? ─▶ proceed (persisted/day)
//
// Single-instance semantics: the window lives in process memory. On a
// multi-instance deploy swap this module's internals for Upstash/Redis —
// callers don't change. The DAILY quota is Mongo-persisted (usagecounters
// with TTL), so it survives restarts and is instance-safe.
import { UsageCounter } from './models';
import { dbConnect } from './db';

const buckets = new Map<string, number[]>(); // key → sorted timestamps (ms)
let lastSweep = Date.now();

export interface LimitResult { ok: boolean; retryAfter: number; }

export function limit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now();
  // Occasional sweep so abandoned keys don't leak memory.
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, arr] of buckets) {
      if (!arr.length || arr[arr.length - 1] < now - 10 * 60_000) buckets.delete(k);
    }
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

export function today(): string { return new Date().toISOString().slice(0, 10); }

// Atomic daily counter. Returns the count AFTER increment; caller compares to
// the quota and, if over, should NOT perform the action (counter already
// bumped — acceptable: quota is a soft abuse guard, not accounting).
export async function bumpDailyQuota(key: string): Promise<number> {
  await dbConnect();
  const doc = await UsageCounter.findOneAndUpdate(
    { key, day: today() },
    { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 3 * 86400_000) } },
    { new: true, upsert: true },
  ).lean() as { n: number };
  return doc.n;
}

export async function getDailyCount(key: string): Promise<number> {
  await dbConnect();
  const doc = await UsageCounter.findOne({ key, day: today() }).lean() as { n: number } | null;
  return doc?.n ?? 0;
}

// Test hook — reset in-memory windows.
export function _resetBuckets() { buckets.clear(); }
