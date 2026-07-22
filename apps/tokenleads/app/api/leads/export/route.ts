import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { ObjectId } from 'mongodb';
import { dbConnect } from '@/lib/db';
import { Unlock, SearchGrant } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, InsufficientTokensError } from '@/lib/tokens';
import { leadsCollection, searchLeads, shapeLead, queryKey, validateSourceLead, SearchFilters } from '@/lib/leads';
import { toCsv, csvResponse } from '@/lib/csv';
import { limit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

// GET  /api/leads/export           → unlocked leads, FREE, full data (what you paid for)
// POST /api/leads/export {filters,page} → one search page as masked CSV, costs
//      EXPORT_PAGE_COST and requires a still-valid search grant for that page.

export async function GET(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  await dbConnect();

  const userId = new Types.ObjectId(s.uid);
  const unlocks = await Unlock.find({ userId }).sort({ createdAt: -1 }).limit(5000).lean() as unknown as
    { leadId: Types.ObjectId; scope: 'lead' | 'contact'; snapshot: Record<string, unknown> | null }[];
  const flags = new Map<string, { lead: boolean; contact: boolean; snapshot: Record<string, unknown> | null }>();
  for (const u of unlocks) {
    const k = String(u.leadId);
    const f = flags.get(k) || { lead: false, contact: false, snapshot: null };
    f[u.scope] = true;
    if (u.snapshot) f.snapshot = u.snapshot;
    flags.set(k, f);
  }

  const col = await leadsCollection();
  const docs = await col.find({ _id: { $in: [...flags.keys()].map((k) => new ObjectId(k)) } }).toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const rows: (string | number | null)[][] = [];
  for (const [k, f] of flags) {
    const doc = byId.get(k) || (f.snapshot ? { _id: k, ...f.snapshot } : null);
    if (!doc) continue;
    const d = validateSourceLead(doc as Record<string, unknown> & { _id: unknown });
    rows.push([
      String(d.name || ''), String(d.category || ''), String(d.address || ''),
      d.rating as number | null, d.reviewCount as number | null, d.leadScore as number | null,
      String(d.leadTemperature || ''), String(d.websiteStatus || ''),
      f.contact ? String(d.phone || '') : '(nincs feloldva)',
      f.contact ? String(d.email || '') : '(nincs feloldva)',
      f.contact ? String(d.website || '') : '(nincs feloldva)',
      String(d.mapsUrl || ''),
    ]);
  }

  logEvent('export_unlocked', { userId: s.uid, rows: rows.length });
  const csv = toCsv(
    ['Név', 'Kategória', 'Cím', 'Értékelés', 'Vélemények', 'Lead score', 'Hőmérséklet', 'Weboldal státusz', 'Telefon', 'E-mail', 'Weboldal', 'Google Maps'],
    rows,
  );
  return csvResponse(csv, `tokenleads-sajat-leadek-${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function POST(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`export:${s.uid}`, 10, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const gate = await requireVerified(s);
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(400, 'filters required');
  const filters: SearchFilters = {
    q: body.q || undefined, category: body.category || undefined, city: body.city || undefined,
    minRating: body.minRating ? Number(body.minRating) : undefined,
    minReviews: body.minReviews ? Number(body.minReviews) : undefined,
    temperature: body.temperature || undefined, websiteStatus: body.websiteStatus || undefined,
    hasEmail: !!body.hasEmail, hasPhone: !!body.hasPhone,
    page: Math.max(1, Number(body.page || 1) || 1),
  };

  await dbConnect();
  const userId = new Types.ObjectId(s.uid);
  const queryHash = createHash('sha1').update(queryKey(filters)).digest('hex');

  // Export is tied to an already-paid page — no grant, no export.
  const grant = await SearchGrant.findOne({ userId, queryHash }).lean();
  if (!grant) return jsonError(409, 'search_not_paid', { hint: 'Run the search first — the export attaches to a paid page.' });

  const pricing = await getPricing();
  const day = new Date().toISOString().slice(0, 10);
  let balance: number | null = null;
  let charged = 0;
  try {
    const result = await spend({
      userId: s.uid, cost: pricing.EXPORT_PAGE_COST, type: 'spend_export',
      description: `CSV export — keresési oldal (${filters.page}. oldal)`,
      ref: { query: queryKey(filters) },
      idempotencyKey: `export:${s.uid}:${queryHash}:${day}`,
    });
    balance = result.balance;
    charged = result.duplicate ? 0 : pricing.EXPORT_PAGE_COST;
  } catch (e) {
    if (e instanceof InsufficientTokensError) {
      return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: e.required });
    }
    throw e;
  }

  const { items } = await searchLeads(filters);
  const unlocked = await Unlock.find({ userId, leadId: { $in: items.map((d) => d._id) } }).lean() as unknown as
    { leadId: Types.ObjectId; scope: 'lead' | 'contact' }[];
  const fmap = new Map<string, { lead: boolean; contact: boolean }>();
  for (const u of unlocked) {
    const f = fmap.get(String(u.leadId)) || { lead: false, contact: false };
    f[u.scope] = true;
    fmap.set(String(u.leadId), f);
  }

  const rows = items.map((d) => {
    const shaped = shapeLead(d, fmap.get(String(d._id)) || { lead: false, contact: false }) as Record<string, unknown>;
    return [
      String(shaped.name), String(shaped.category || ''), String(shaped.city || ''),
      shaped.rating as number | null, shaped.reviewCount as number | null, shaped.leadScore as number | null,
      String(shaped.leadTemperature || ''),
      shaped.unlocked && (shaped.unlocked as { contact: boolean }).contact ? String(shaped.phone || '') : '(zárolt)',
      shaped.unlocked && (shaped.unlocked as { contact: boolean }).contact ? String(shaped.email || '') : '(zárolt)',
    ];
  });

  logEvent('export_search_page', { userId: s.uid, page: filters.page, charged });
  const csv = toCsv(
    ['Név', 'Kategória', 'Hely', 'Értékelés', 'Vélemények', 'Lead score', 'Hőmérséklet', 'Telefon', 'E-mail'],
    rows,
  );
  const res = csvResponse(csv, `tokenleads-kereses-${day}.csv`);
  if (balance != null) res.headers.set('X-Balance', String(balance));
  res.headers.set('X-Charged', String(charged));
  return res;
}
