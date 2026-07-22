import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { SearchGrant, Unlock } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, InsufficientTokensError } from '@/lib/tokens';
import { searchLeads, shapeLead, queryKey, SearchFilters } from '@/lib/leads';
import { limit, bumpDailyQuota } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

export async function GET(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`search:${s.uid}`, 30, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const gate = await requireVerified(s);
  if (gate) return gate;
  await dbConnect();

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
    page: Math.max(1, Number(sp.get('page') || 1) || 1),
  };

  const pricing = await getPricing();
  const queryHash = createHash('sha1').update(queryKey(filters)).digest('hex');
  const userId = new Types.ObjectId(s.uid);

  // Same query+page within 24h → already paid, no new charge.
  const grant = await SearchGrant.findOne({ userId, queryHash }).lean();
  let charged = 0;
  let balance: number | null = null;

  if (!grant && pricing.SEARCH_COST > 0) {
    // Daily quota on PAID pages only — one bump, reject if it pushes over.
    // Over-bump on a rejected request is acceptable (soft abuse guard) and it
    // can never grant more than DAILY_SEARCH_QUOTA paid searches.
    const used = await bumpDailyQuota(`search:${s.uid}`);
    if (used > pricing.DAILY_SEARCH_QUOTA) {
      logEvent('daily_search_quota_hit', { userId: s.uid, used });
      // Resets at UTC midnight — tell the client how long that is, not "60s".
      const now = new Date();
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const res = jsonError(429, 'daily_quota_exceeded', { quota: pricing.DAILY_SEARCH_QUOTA, retryAfter: Math.ceil((midnight - now.getTime()) / 1000) });
      res.headers.set('Retry-After', String(Math.ceil((midnight - now.getTime()) / 1000)));
      return res;
    }

    const label = [filters.q, filters.category, filters.city].filter(Boolean).join(', ') || 'minden lead';
    const day = new Date().toISOString().slice(0, 10);
    try {
      const r = await spend({
        userId: s.uid, cost: pricing.SEARCH_COST, type: 'spend_search',
        description: `Keresés — „${label}” (${filters.page}. oldal)`,
        ref: { query: queryKey(filters) },
        idempotencyKey: `search:${s.uid}:${queryHash}:${day}`,
      });
      charged = r.duplicate ? 0 : pricing.SEARCH_COST;
      balance = r.balance;
    } catch (e) {
      if (e instanceof InsufficientTokensError) {
        return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: e.required });
      }
      throw e;
    }
    // Set the 24h window ONLY when creating the grant — re-reads must not slide
    // expiry forward, otherwise one payment buys perpetual free access.
    await SearchGrant.updateOne(
      { userId, queryHash },
      { $setOnInsert: { expiresAt: new Date(Date.now() + 24 * 3600 * 1000) } },
      { upsert: true },
    ).catch(() => {}); // concurrent upsert can 11000 — grant already exists, fine
  }

  const { items, total, page, pages } = await searchLeads(filters);

  const ids = items.map((d) => d._id);
  const unlocks = await Unlock.find({ userId, leadId: { $in: ids } }).lean() as unknown as
    { leadId: Types.ObjectId; scope: 'lead' | 'contact' }[];
  const flags = new Map<string, { lead: boolean; contact: boolean }>();
  for (const u of unlocks) {
    const f = flags.get(String(u.leadId)) || { lead: false, contact: false };
    f[u.scope] = true;
    flags.set(String(u.leadId), f);
  }

  return NextResponse.json({
    ok: true,
    items: items.map((d) => shapeLead(d, flags.get(String(d._id)) || { lead: false, contact: false })),
    total, page, pages, charged, cost: pricing.SEARCH_COST, balance,
  });
}
