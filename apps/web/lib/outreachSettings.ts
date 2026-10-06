// The few values of the outreach system the operator enters by hand: readings
// no machine can take, and the daily acknowledgements. Server code.
//
// One document, in `caches` under one key: there is no settings collection, and
// five values do not justify one. Nothing else writes or drops this key.
import { readCache, writeCache } from '@/lib/cache';

const KEY = 'outreach:settings';

export interface OutreachSettings {
  postmaster: { spamRate: number | null; date: string };   // the Gmail spam rate from Google Postmaster Tools, in percent, and the day it was read
  seed: { date: string; inbox: number | null; of: number | null }; // the last seed test: how many of the test mailboxes got it in the inbox
  seedAddresses: string[];     // the test mailboxes a seed test is sent to
  authConfirmedAt: string;     // the day the operator saw SPF, DKIM and DMARC all pass; '' = never
  repliesReviewedAt: string;   // ISO of the last time the operator read the replies; '' = never
}

const EMPTY: OutreachSettings = { postmaster: { spamRate: null, date: '' }, seed: { date: '', inbox: null, of: null }, seedAddresses: [], authConfirmedAt: '', repliesReviewedAt: '' };

export async function readSettings(): Promise<OutreachSettings> {
  const doc = await readCache(KEY);
  const d = (doc?.data || {}) as Partial<OutreachSettings>;
  return { ...EMPTY, ...d, postmaster: { ...EMPTY.postmaster, ...(d.postmaster || {}) }, seed: { ...EMPTY.seed, ...(d.seed || {}) }, seedAddresses: Array.isArray(d.seedAddresses) ? d.seedAddresses : [] };
}

// Change some of the values and keep the rest. One operator, one screen: read,
// merge and write is enough here.
export async function patchSettings(patch: Partial<OutreachSettings>): Promise<OutreachSettings> {
  const next = { ...(await readSettings()), ...patch };
  await writeCache(KEY, { data: next, at: Date.now() });
  return next;
}
