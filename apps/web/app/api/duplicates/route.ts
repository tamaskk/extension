import { dbConnect } from '@/lib/db';
import { Lead, CORS, json, mongoose } from '@/lib/models';
import { readCache, writeCache, dropCache } from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Businesses stored more than once: the same Google `cid` under two different
// dedupKeys (one copy keyed by placeId, one by cid), usually in two projects.
//
// A single $group over all leads has 1.6M buckets and dies on the shared
// tier's 100 MB aggregation limit — the old route answered 500 and the modal
// read that as "no duplicates". So the client drives chunked POSTs over the
// `cid` key space (same pattern as /api/categories/summary): each request
// groups one slice inside the cid index, only the cids that occur twice are
// fetched, and the finished list is cached in the `caches` collection.
const KEY = 'duplicates';
const PARTIAL = 'duplicates_partial';
const CHUNK = 100_000;     // cids per request
const MAX_GROUPS = 2000;   // groups kept for the modal; `total` still counts all

interface DupeItem { project: string; key: string; name?: string; category?: string; rating?: number | null; reviewCount?: number | null; checked?: boolean }
interface DupeGroup { name: string; address: string; items: DupeItem[] }
interface DupeData { groups: DupeGroup[]; total: number }

// GET → the last finished scan: { ok, groups, total, at } (at = 0: never scanned)
export async function GET() {
  try {
    const doc = await readCache(KEY);
    const data = (doc?.data || { groups: [], total: 0 }) as DupeData;
    return json({ ok: true, groups: data.groups, total: data.total, at: doc?.at || 0 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'duplicates failed' }, { status: 500 });
  }
}

// POST { after?, at? } → one slice of the scan; loop until done:true.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const leads = mongoose.connection.db!.collection('leads');
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const after: string | null = typeof b?.after === 'string' && b.after ? b.after : null;
    const at: number = typeof b?.at === 'number' && b.at ? b.at : Date.now();
    if (!after) await writeCache(PARTIAL, { data: { groups: [], total: 0 }, at });

    // upper bound of this slice: an index-only skip on the cid index
    const from = after ?? ''; // '' also leaves out leads without a cid
    const next = await leads.find({ cid: { $gt: from } }).sort({ cid: 1 }).hint('cid_1')
      .skip(CHUNK - 1).limit(1).project({ cid: 1, _id: 0 }).toArray();
    const upper: string | null = next.length ? (next[0].cid as string) : null;
    const range: Record<string, string> = { $gt: from };
    if (upper !== null) range.$lte = upper;

    // cids that occur more than once in the slice — covered by the index, no documents read
    const dup = await leads.aggregate([
      { $match: { cid: range } },
      { $group: { _id: '$cid', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ], { hint: 'cid_1' }).toArray();

    const partial = ((await readCache(PARTIAL))?.data || { groups: [], total: 0 }) as DupeData;
    partial.total += dup.length;
    const room = MAX_GROUPS - partial.groups.length;
    if (dup.length && room > 0) {
      const cids = dup.slice(0, room).map((d) => d._id as string);
      const docs = await Lead.find({ cid: { $in: cids } })
        .select('cid project dedupKey name address category rating reviewCount checked -_id').lean() as Record<string, any>[];
      const byCid = new Map<string, DupeGroup>();
      for (const d of docs) {
        let g = byCid.get(d.cid);
        if (!g) { g = { name: d.name || '', address: d.address || '', items: [] }; byCid.set(d.cid, g); }
        g.items.push({ project: d.project, key: d.dedupKey, name: d.name, category: d.category, rating: d.rating, reviewCount: d.reviewCount, checked: !!d.checked });
      }
      partial.groups.push(...byCid.values());
    }

    if (upper === null) { // past the last cid: publish
      partial.groups.sort((x, y) => y.items.length - x.items.length || x.name.localeCompare(y.name));
      await writeCache(KEY, { data: partial, at });
      await dropCache(PARTIAL);
      return json({ ok: true, done: true, at, total: partial.total });
    }
    await writeCache(PARTIAL, { data: partial, at });
    return json({ ok: true, done: false, at, after: upper, total: partial.total });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'duplicate scan failed' }, { status: 500 });
  }
}
