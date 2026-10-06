import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';
import { HAS_EMAIL } from '@/lib/leadMatch';
import { fetchSiteHtml } from '@/lib/siteFetch';
import { siteSignals } from '@/lib/siteSignals.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Leads per call. Each is one website fetch of up to six seconds, six at a time.
const CHUNK = 18;
// Only the leads that can be enrolled at all are worth a fetch: an email, and a
// real website. The "not done yet" test is the result field itself, so a run
// that was cut off goes on where it stopped and there is no flag to keep in step.
const TODO = { email: HAS_EMAIL, websiteStatus: 'HAS_WEBSITE', 'sig.checkedAt': { $in: ['', null] } };

// POST /api/outreach/signals
// One chunk of reading the leads' own websites for three signals the offer
// routing uses: an online booking engine, an online ordering service, an
// Instagram link. Best-scored leads first. Only the three short values are
// stored, never the page. → { ok, done, found, remaining }; the client calls
// again until `remaining` is 0 (ARCHITECTURE §04, long jobs).
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const leads = await Lead.find(TODO).sort({ opportunityScore: -1, _id: 1 }).limit(CHUNK).select('project dedupKey website').lean() as unknown as { project: string; dedupKey: string; website?: string }[];
    const now = new Date().toISOString();
    const results: { lead: { project: string; dedupKey: string }; sig: Record<string, unknown> }[] = [];
    for (let i = 0; i < leads.length; i += 6) {
      results.push(...await Promise.all(leads.slice(i, i + 6).map(async (lead) => {
        const html = await fetchSiteHtml(lead.website || '');
        // a site that could not be read is marked as read too, with ok: false, or it would be tried on every call for ever
        return { lead, sig: html === null ? { booking: '', ordering: '', instagram: '', ok: false, checkedAt: now } : { ...siteSignals(html), ok: true, checkedAt: now } };
      })));
    }
    if (results.length) {
      await Lead.bulkWrite(results.map((r) => ({ updateOne: { filter: { project: r.lead.project, dedupKey: r.lead.dedupKey }, update: { $set: { sig: r.sig } } } })), { ordered: false });
    }
    // capped: the exact number of a long tail is not worth a slow count
    const remaining = leads.length < CHUNK ? 0 : await Lead.countDocuments(TODO, { limit: 5000 });
    return json({ ok: true, done: results.length, found: results.filter((r) => r.sig.ok).length, remaining });
  } catch (e) {
    console.error('outreach signals chunk failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'This chunk failed. What was read before it is saved; run it again to go on.' }, { status: 500 });
  }
}
