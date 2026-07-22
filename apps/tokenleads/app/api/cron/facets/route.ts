import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { FacetsCache } from '@/lib/models';
import { checkCron } from '@/lib/cronAuth';
import { computeFacets } from '@/lib/leads';
import { logEvent, logError } from '@/lib/monitoring';

// Daily facets materialization — keeps the search dropdowns warm so no user
// request ever pays the ~10s aggregation.
export async function GET(req: NextRequest) {
  const denied = checkCron(req);
  if (denied) return denied;
  await dbConnect();
  try {
    const started = Date.now();
    const value = await computeFacets();
    await FacetsCache.updateOne({ key: 'facets' }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
    logEvent('facets_refreshed', { ms: Date.now() - started, categories: value.categories.length, cities: value.cities.length });
    return NextResponse.json({ ok: true, ms: Date.now() - started, total: value.total });
  } catch (e) {
    logError('facets_refresh_failed', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
