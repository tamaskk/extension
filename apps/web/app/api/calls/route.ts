import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const CAP = 50000;

// GET /api/calls          → { rows, total } for all leads flagged call=true
// GET /api/calls?count=1  → { total } only (cheap, for the button badge)
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const total = await Lead.countDocuments({ call: true });
    if (u.get('count')) return json({ total });

    const docs = await Lead.find({ call: true })
      .select('project dedupKey name category rating reviewCount phone email website websiteStatus address mapsUrl opportunityScore leadScore leadTemperature salesStatus salesDate tags -_id')
      .sort({ opportunityScore: -1, _id: 1 })
      .limit(CAP).lean();
    const rows = (docs as Record<string, unknown>[]).map((r) => r);
    return json({ rows, total, capped: total > CAP });
  } catch (e: any) {
    return json({ rows: [], total: 0, error: e?.message || 'calls query failed' }, { status: 500 });
  }
}
