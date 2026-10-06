// Server side of the word-prefix lead search (the tokenizer is lib/searchTokens.mjs).
//
//   refreshSearchTokens  recompute `searchTokens` of leads after a write
//   applySearch          turn a search box value into a Mongo condition
//
// The token query only finds leads that have tokens, so it is switched on by a
// flag that the backfill (POST /api/search-backfill) sets once every lead has
// them. Until then applySearch keeps the old regex and nothing changes.
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { readCache, writeCache } from '@/lib/cache';
import { tokensOf, queryWords } from '@/lib/searchTokens.mjs';

// the lead fields the tokens are built from: a write to any of them needs a refresh
export const TOKEN_FIELDS = ['name', 'category', 'address', 'phone', 'email'];
const PROJECTION = { name: 1, category: 1, address: 1, phone: 1, email: 1 };

// Recompute the tokens from what is STORED after the write, by dedupKey (a
// business lives in one project). Reading back matters for sync, where an empty
// incoming contact field does not overwrite the stored one. Never throws: a
// failed token refresh must not fail the write it follows.
export async function refreshSearchTokens(dedupKeys: (string | null | undefined)[]) {
  const keys = [...new Set(dedupKeys.filter(Boolean))] as string[];
  if (!keys.length) return;
  try {
    await dbConnect();
    const leads = mongoose.connection.db!.collection('leads');
    for (let i = 0; i < keys.length; i += 2000) {
      const docs = await leads.find({ dedupKey: { $in: keys.slice(i, i + 2000) } }, { projection: PROJECTION }).toArray();
      if (!docs.length) continue;
      await leads.bulkWrite(docs.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { searchTokens: tokensOf(d) } } } })), { ordered: false });
    }
  } catch (e) {
    console.error('search token refresh failed', e); // the lead keeps its old tokens until its next write or a backfill
  }
}

const READY_KEY = 'searchTokens';
let ready: { at: number; value: boolean } | null = null;

// "Every lead has tokens." Remembered per instance; a `false` is re-read after a
// minute so a finished backfill takes effect without a deploy.
export async function searchTokensReady(): Promise<boolean> {
  if (ready && (ready.value || Date.now() - ready.at < 60_000)) return ready.value;
  const doc = await readCache(READY_KEY);
  ready = { at: Date.now(), value: !!(doc?.data as { ready?: boolean } | undefined)?.ready };
  return ready.value;
}
export async function markSearchTokensReady() {
  await writeCache(READY_KEY, { data: { ready: true }, at: Date.now() });
  ready = { at: Date.now(), value: true };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Narrow `match` to leads that fit the search box value.
export async function applySearch(match: Record<string, unknown>, search: string) {
  if (!search) return;
  if (await searchTokensReady()) {
    // every word typed must start some token of the lead; the index bounds the first
    const conds = queryWords(search).map((w: string) => ({ searchTokens: { $gte: w, $lt: w + '￿' } }));
    if (conds.length) match.$and = ((match.$and as Record<string, unknown>[]) || []).concat(conds);
    return; // nothing left of the term (one letter, punctuation) → no filter
  }
  // before the backfill: substring match on five fields (reads every lead)
  const rx = new RegExp(escapeRegex(search), 'i');
  match.$or = [{ name: rx }, { category: rx }, { address: rx }, { phone: rx }, { email: rx }];
}
