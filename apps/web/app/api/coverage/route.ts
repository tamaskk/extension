import { CORS, json } from '@/lib/models';
import { getCoverageMatrix } from '@/lib/coverageMatrixData';

export const runtime = 'nodejs';
// A fresh build reads every project query; the cached answer is one document.
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/coverage[?fresh=1]
// The coverage matrix: every region with a reference list (US states, countries,
// cities) and, per business type, how many of its places already have a project.
//   → { ok, rows: [{ country, kind, region, total }], types: [{ key, label, projects }], present, at }
// `present[typeKey][rowIndex]` is the number of places done; a missing entry is 0.
// Read-only. `fresh=1` rebuilds instead of answering from the 120 s cache.
export async function GET(req: Request) {
  try {
    const fresh = new URL(req.url).searchParams.get('fresh') === '1';
    return json({ ok: true, ...(await getCoverageMatrix(fresh)) });
  } catch (e) {
    console.error('coverage matrix failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The coverage matrix could not be built.' }, { status: 500 });
  }
}
