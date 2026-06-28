import { dbConnect } from '@/lib/db';
import { Project, CORS, json } from '@/lib/models';
import { STATE_PLACES } from '@/lib/states';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const normQ = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// GET /api/missing-states?type=<business type>  (e.g. "plumbers near")
// For every US state, returns the places that DON'T yet have a project
// "<type> <placeName> <state>" — i.e. the missing ones to scrape, with population.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const type = (u.get('type') || '').trim();
    if (!type) return json({ error: 'type (business type) is required' }, { status: 400 });

    // existing project queries that start with this business type (prefix regex → uses the index)
    const prefixRe = new RegExp('^' + type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const projs = await Project.find({ query: prefixRe }).select('query -_id').lean() as { query: string }[];
    const have = new Set(projs.map((p) => normQ(p.query)));

    const states: { state: string; places: { placeName: string; population: string }[] }[] = [];
    let totalMissing = 0;
    for (const [state, places] of Object.entries(STATE_PLACES)) {
      const missing: { placeName: string; population: string }[] = [];
      for (const [placeName, pop] of places as [string, number][]) {
        if (!have.has(normQ(`${type} ${placeName} ${state}`))) missing.push({ placeName, population: String(pop) });
      }
      if (missing.length) { states.push({ state, places: missing }); totalMissing += missing.length; }
    }
    return json({ type, states, statesWithMissing: states.length, totalMissing });
  } catch (e: any) {
    return json({ error: e?.message || 'missing-states failed' }, { status: 500 });
  }
}
