import { CORS, Lead, json } from '@/lib/models';
import { dbConnect } from '@/lib/db';
import { refuseUnlessOperator } from '@/lib/session';
import { parseProjectGeo } from '@/lib/projectGeo';
import { companyFor } from '@/lib/melodiaPlan.mjs';
import { pushToMelodia, type MelodiaCompany } from '@/lib/melodia';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// One click sends at most this many: five of Melodia's batches of 200, one after the other.
const MAX_LEADS = 1000;

// POST /api/melodia  { leads: [{ project, key }] }
// Sends the leads the operator ticked on the dashboard to Melodia's company
// intake (lib/melodia.ts), with or without a website of its own
// (lib/melodiaPlan.mjs); `noWebsite` counts the ones that went without one.
// → { ok, picked, sent, noWebsite, inserted, skipped, failed, problems }
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    if (!process.env.MELODIA_API_KEY) return json({ ok: false, error: 'MELODIA_API_KEY is not set on the server.' }, { status: 503 });
    const b = await req.json().catch(() => null);
    const items = (Array.isArray(b?.leads) ? b.leads : [])
      .filter((x: unknown): x is { project: string; key: string } => !!x && typeof (x as { project?: unknown }).project === 'string' && typeof (x as { key?: unknown }).key === 'string')
      .map((x: { project: string; key: string }) => ({ project: x.project.slice(0, 500), key: x.key.slice(0, 200) }));
    if (!items.length) return json({ ok: false, error: 'Tick the businesses to send first.' }, { status: 400 });
    if (items.length > MAX_LEADS) return json({ ok: false, error: `At most ${MAX_LEADS.toLocaleString()} businesses at a time.` }, { status: 413 });

    await dbConnect();
    const wanted = new Set(items.map((i: { project: string; key: string }) => `${i.project}|${i.key}`));
    const leads = await Lead.find({ dedupKey: { $in: items.map((i: { key: string }) => i.key) } })
      .select('project dedupKey name website websiteStatus category email emails -_id').lean() as unknown as { project: string; dedupKey: string }[];
    const geoOf = new Map<string, ReturnType<typeof parseProjectGeo>>();
    const companies: MelodiaCompany[] = [];
    for (const l of leads) {
      if (!wanted.has(`${l.project}|${l.dedupKey}`)) continue;
      if (!geoOf.has(l.project)) geoOf.set(l.project, parseProjectGeo(l.project));
      const c = companyFor(l, geoOf.get(l.project)) as MelodiaCompany | null;
      if (c) companies.push(c);
    }
    const outcome = await pushToMelodia(companies);
    if (!outcome) return json({ ok: false, error: 'MELODIA_API_KEY is not set on the server.' }, { status: 503 });
    return json({ ok: outcome.failed === 0, picked: items.length, sent: companies.length, noWebsite: companies.filter((c) => !c.website).length, ...outcome });
  } catch (e) {
    console.error('melodia send failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The businesses could not be sent to Melodia.' }, { status: 500 });
  }
}
