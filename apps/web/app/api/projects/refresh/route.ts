import { CORS, json } from '@/lib/models';
import { recomputeAllProjectStats } from '@/lib/projectStats';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/projects/refresh — full rebuild of the ProjectStat counters from
// the live leads collection (the ⟳ Recount button).
export async function POST() {
  try {
    const t0 = Date.now();
    const projects = await recomputeAllProjectStats();
    return json({ ok: true, projects, ms: Date.now() - t0 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'refresh failed' }, { status: 500 });
  }
}
