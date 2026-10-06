// Read and write the `caches` collection: finished payloads that are too slow
// to build inside a request (the sidebar payload, later the stats buckets).
// Mongo-backed because Vercel spreads requests across instances, so an
// in-memory cache would be rebuilt by every cold one.
//
// Native driver on purpose (no mongoose model): the documents are free-form
// ({ key, at, hash?, gz?, data?, rebuildingAt? }).
import mongoose from 'mongoose';
import { after } from 'next/server';
import { dbConnect } from '@/lib/db';

export interface CacheDoc {
  key: string;
  at?: number;           // when the content was last built or confirmed unchanged (ms)
  hash?: string;         // hash of the content, used as the ETag
  gz?: unknown;          // gzipped body (a driver Binary when read back)
  data?: unknown;        // small JSON payloads
  rebuildingAt?: number; // set while one request rebuilds the entry
}

// A rebuild that died (function killed mid-build) releases its claim after this long.
const CLAIM_MS = 60_000;

async function coll() {
  await dbConnect();
  return mongoose.connection.db!.collection<CacheDoc>('caches');
}

export async function readCache(key: string): Promise<CacheDoc | null> {
  return (await coll()).findOne({ key });
}

// The entry without its body — enough to answer a conditional request (ETag)
// without pulling megabytes of gzip out of MongoDB first.
export async function readCacheMeta(key: string): Promise<CacheDoc | null> {
  return (await coll()).findOne({ key }, { projection: { gz: 0, data: 0 } });
}

// Store freshly built content. Creates the entry when it does not exist.
export async function writeCache(key: string, fields: Omit<CacheDoc, 'key' | 'rebuildingAt'>) {
  await (await coll()).updateOne({ key }, { $set: { key, ...fields }, $unset: { rebuildingAt: '' } }, { upsert: true });
}

export async function dropCache(key: string) {
  await (await coll()).deleteOne({ key });
}

// Only one request rebuilds an expired entry; the others keep serving the old
// content. Returns the claim stamp, or null when another request holds it.
export async function claimRebuild(key: string, now = Date.now()): Promise<number | null> {
  const r = await (await coll()).updateOne(
    { key, $or: [{ rebuildingAt: { $exists: false } }, { rebuildingAt: { $lt: now - CLAIM_MS } }] },
    { $set: { rebuildingAt: now } },
  );
  return r.modifiedCount === 1 ? now : null;
}

// Finish a claimed rebuild. Writes nothing when the entry was dropped in the
// meantime (an edit invalidated it): the content was computed before that edit,
// and storing it would bring the old state back.
export async function finishRebuild(key: string, claim: number, fields: Omit<CacheDoc, 'key' | 'rebuildingAt'>) {
  await (await coll()).updateOne({ key, rebuildingAt: claim }, { $set: fields, $unset: { rebuildingAt: '' } });
}

// A small JSON payload behind the cache, stale-while-revalidate: an expired
// entry is still returned at once and rebuilt after the response; only a
// missing entry is built inside the request.
export async function cachedData<T>(key: string, ttlMs: number, build: () => Promise<T>): Promise<T> {
  const doc = await readCache(key);
  if (doc && doc.data !== undefined) {
    if (Date.now() - (doc.at || 0) >= ttlMs) {
      after(async () => {
        try {
          const claim = await claimRebuild(key);
          if (claim === null) return; // another request is already rebuilding
          await finishRebuild(key, claim, { data: await build(), at: Date.now() });
        } catch (e) {
          // the claim expires on its own and a later request retries
          console.error(`cache rebuild failed: ${key}`, e);
        }
      });
    }
    return doc.data as T;
  }
  const data = await build();
  await writeCache(key, { data, at: Date.now() });
  return data;
}
