import { CORS, json } from '@/lib/models';
import { COVERAGE_KINDS, coverageCountries, missingBatches } from '@/lib/coverageMatrixData';
import type { CoverageRowKind } from '@/lib/coverageMatrixData';

export const runtime = 'nodejs';
// reads every project query
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/coverage/missing?type=&country=&kind=
// The places one business type still lacks in one country, as the extension's
// "Load batches from JSON" expects them: [{ city, areas }], where `city` is the
// batch suffix (a state, a city or the country) and `areas` its missing places.
//   → { ok, batches, searches }
// `kind` is state (US states), city (cities and their areas) or cities (the
// country and its city list). Read-only.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const type = String(sp.get('type') || '').trim().slice(0, 40);
    const country = String(sp.get('country') || '');
    const kind = String(sp.get('kind') || '') as CoverageRowKind;
    if (!type) return json({ ok: false, error: 'A business type is needed.' }, { status: 400 });
    if (!coverageCountries().includes(country)) return json({ ok: false, error: 'Unknown country.' }, { status: 400 });
    if (!COVERAGE_KINDS.includes(kind)) return json({ ok: false, error: 'Unknown level.' }, { status: 400 });
    const batches = await missingBatches(type, country, kind);
    return json({ ok: true, batches, searches: batches.reduce((n, b) => n + b.areas.length, 0) });
  } catch (e) {
    console.error('coverage missing list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The list could not be built.' }, { status: 500 });
  }
}
