import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrKey, isResponse, rateLimited } from '@/lib/apiUtil';
import { getFacetsFiltered, SearchFilters } from '@/lib/leads';
import { limit } from '@/lib/rateLimit';

// Free — dropdown options for the search UI (no token charge). Accepts API
// keys too, so Bearer-auth clients can enumerate the same filter values.
// Optional filter query params return DEPENDENT (faceted) counts: each dropdown
// reflects the other active filters. Empty filters → global cached facets.
export async function GET(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`facets:${s.uid}`, 40, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const sp = req.nextUrl.searchParams;
  const filters: SearchFilters = {
    q: sp.get('q') || undefined,
    category: sp.get('category') || undefined,
    city: sp.get('city') || undefined,
    minRating: sp.get('minRating') ? Number(sp.get('minRating')) : undefined,
    minReviews: sp.get('minReviews') ? Number(sp.get('minReviews')) : undefined,
    temperature: sp.get('temperature') || undefined,
    websiteStatus: sp.get('websiteStatus') || undefined,
    hasEmail: sp.get('hasEmail') === '1',
    hasPhone: sp.get('hasPhone') === '1',
  };

  const facets = await getFacetsFiltered(filters);
  return NextResponse.json({ ok: true, ...facets });
}
