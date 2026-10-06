// Paginated reviews for the dashboard Reviews view, filterable by country / state /
// city (matched against the review's project) and by a specific business (dedupKey),
// joined with the business name + address. Web-only → protected by the auth middleware.
import { dbConnect } from '@/lib/db';
import { Review, Lead, CORS, json } from '@/lib/models';
import { STATE_REGIONS } from '@/lib/regionNames';
import { projectNamesWhere, LIST_MAX } from '@/lib/projectScope';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const US_STATES_RE = new RegExp('(' + STATE_REGIONS.map(esc).join('|') + ')\\s*$', 'i');

export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(u.get('pageSize') || '50', 10) || 50));
    const dedupKey = (u.get('dedupKey') || '').trim();
    const country = (u.get('country') || '').trim();
    const state = (u.get('state') || '').trim();
    const city = (u.get('city') || '').trim();
    const search = (u.get('search') || '').trim();

    const match: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (dedupKey) {
      match.dedupKey = dedupKey;
    } else {
      // region = state (US) or country name, matched at the END of the project query
      const tests: RegExp[] = [];
      if (state) tests.push(new RegExp(esc(state) + '\\s*$', 'i'));
      else if (country) tests.push(/^(usa|united states)$/i.test(country) ? US_STATES_RE : new RegExp(esc(country) + '\\s*$', 'i'));
      if (city) tests.push(new RegExp('(^|\\s)' + esc(city), 'i')); // city appears in the query
      if (tests.length) {
        // A pattern on `project` cannot use the index and reads every review.
        // Match the ~250k project names in memory and send an exact list; only
        // a list too long for one query falls back to the patterns.
        // When nearly everything matches (country = USA), list the few that don't.
        const hit = (q: string) => tests.every((t) => t.test(q));
        const names = await projectNamesWhere(hit);
        if (names.length <= LIST_MAX) match.project = { $in: names };
        else {
          const rest = await projectNamesWhere((q) => !hit(q));
          if (rest.length <= LIST_MAX) match.project = { $nin: rest };
          else for (const t of tests) and.push({ project: t });
        }
      }
    }
    if (search) match.$or = [{ text: new RegExp(esc(search), 'i') }, { author: new RegExp(esc(search), 'i') }];
    if (and.length) match.$and = and;

    // no filter → the collection's own counter (a filtered count would scan all reviews)
    const noFilter = Object.keys(match).length === 0;
    const [rows, total] = await Promise.all([
      Review.find(match).sort({ scrapedAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      noFilter ? Review.estimatedDocumentCount() : Review.countDocuments(match),
    ]);

    // join the business name / address (reviews only store dedupKey + project)
    const keys = [...new Set((rows as any[]).map((r) => r.dedupKey))];
    const leads = keys.length ? await Lead.find({ dedupKey: { $in: keys } }).select('dedupKey name address project -_id').lean() : [];
    const byKey: Record<string, any> = {};
    for (const l of leads as any[]) if (!byKey[l.dedupKey]) byKey[l.dedupKey] = l;

    const out = (rows as any[]).map((r) => {
      const l = byKey[r.dedupKey] || {};
      return {
        id: String(r._id), dedupKey: r.dedupKey,
        businessName: l.name || r.dedupKey, address: l.address || '', project: r.project || l.project || '',
        author: r.author || '', authorUrl: r.authorUrl || '', rating: r.rating ?? null,
        text: r.text || '', relativeTime: r.relativeTime || '', ownerResponse: r.ownerResponse || '', scrapedAt: r.scrapedAt || '',
      };
    });
    return json({ ok: true, rows: out, total, page, pageSize });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'reviews query failed' }, { status: 500 });
  }
}
