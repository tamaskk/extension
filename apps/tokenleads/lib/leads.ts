// Read-only access to the GridLeads source database (myapp.leads) + the
// server-side masking rules. Contact fields NEVER leave the server unless the
// caller holds a 'contact' unlock — masking on the client is forbidden.
import { ObjectId, type Collection, type Document } from 'mongodb';
import { sourceDb } from './db';

export const PAGE_SIZE = 20;

export async function leadsCollection(): Promise<Collection<Document>> {
  const db = await sourceDb();
  // Native driver handle — no mongoose model on the foreign DB, so schema
  // drift over there can't silently register bad defaults here.
  return db.db!.collection('leads');
}

export const TEMPERATURES = ['HOT', 'WARM', 'COLD'] as const;
export const WEBSITE_STATUSES = ['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'HAS_WEBSITE'] as const;

export interface SearchFilters {
  q?: string;              // free text: matches name OR category
  category?: string;       // exact category (from facet dropdown)
  city?: string;           // "City, ST" label (from facet dropdown) — substring of address
  minRating?: number;
  minReviews?: number;
  temperature?: string;    // HOT | WARM | COLD
  websiteStatus?: string;  // NO_WEBSITE | FACEBOOK_ONLY | INSTAGRAM_ONLY | HAS_WEBSITE
  hasEmail?: boolean;
  hasPhone?: boolean;
  page?: number;
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function buildQuery(f: SearchFilters): Document {
  const query: Document = {};
  const and: Document[] = [];
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.trim()), 'i');
    and.push({ $or: [{ name: rx }, { category: rx }] });
  }
  if (f.category) query.category = f.category;
  if (f.city) and.push({ address: new RegExp(escapeRegex(f.city.trim()), 'i') });
  if (f.minRating) query.rating = { $gte: f.minRating };
  if (f.minReviews) query.reviewCount = { $gte: f.minReviews };
  if (f.temperature && (TEMPERATURES as readonly string[]).includes(f.temperature)) query.leadTemperature = f.temperature;
  if (f.websiteStatus && (WEBSITE_STATUSES as readonly string[]).includes(f.websiteStatus)) query.websiteStatus = f.websiteStatus;
  if (f.hasEmail) query.email = { $exists: true, $nin: ['', null] };
  if (f.hasPhone) query.phone = { $exists: true, $nin: ['', null] };
  if (and.length) query.$and = and;
  return query;
}

// Canonical string for SearchGrant hashing — same filters+page → same grant.
export function queryKey(f: SearchFilters): string {
  return JSON.stringify({
    q: (f.q || '').trim().toLowerCase(), category: (f.category || '').trim().toLowerCase(),
    city: (f.city || '').trim().toLowerCase(),
    minRating: f.minRating || 0, minReviews: f.minReviews || 0,
    temperature: f.temperature || '', websiteStatus: f.websiteStatus || '',
    hasEmail: !!f.hasEmail, hasPhone: !!f.hasPhone, page: f.page || 1,
  });
}

// ── Facets — what the dropdowns offer. Aggregated from 1.1M source leads.
// Three layers: in-memory (10 min) → facetscache collection (24h, cron-warmed
// by /api/cron/facets) → live aggregation as last resort.
export interface Facets {
  categories: { v: string; n: number }[];
  cities: { v: string; n: number }[];
  total: number;
}
let facetsCache: { at: number; value: Facets } | null = null;

// Aggregation stages that turn matched docs into category / city buckets.
// A leading $match is prepended so the same stages serve both the global
// facets and the filter-constrained ones.
function categoryStages(match: Document) {
  return [
    { $match: { ...match, category: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$category', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 80 },
    { $project: { _id: 0, v: '$_id', n: 1 } },
  ];
}
function cityStages(match: Document) {
  return [
    { $match: { ...match, address: { $type: 'string', $ne: '' } } },
    { $project: { parts: { $split: ['$address', ', '] } } },
    { $match: { $expr: { $gte: [{ $size: '$parts' }, 3] } } },
    { $project: {
      label: { $concat: [
        { $arrayElemAt: ['$parts', -3] }, ', ',
        { $arrayElemAt: [{ $split: [{ $arrayElemAt: ['$parts', -2] }, ' '] }, 0] },
      ] },
    } },
    { $group: { _id: '$label', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 80 },
    { $project: { _id: 0, v: '$_id', n: 1 } },
  ];
}

export async function getFacets(): Promise<Facets> {
  if (facetsCache && Date.now() - facetsCache.at < 10 * 60_000) return facetsCache.value;
  const { FacetsCache } = await import('./models');
  const stored = await FacetsCache.findOne({ key: 'facets' }).lean() as { value: Facets; updatedAt: Date } | null;
  if (stored && Date.now() - new Date(stored.updatedAt).getTime() < 24 * 3600_000) {
    facetsCache = { at: Date.now(), value: stored.value };
    return stored.value;
  }
  const value = await computeFacets();
  await FacetsCache.updateOne({ key: 'facets' }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
  facetsCache = { at: Date.now(), value };
  return value;
}

// Faceted (dependent) counts: each dropdown reflects the OTHER active filters
// but not its own, so the category list stays switchable while city counts
// narrow to the picked category. Short-lived per-filter-signature cache keeps
// rapid dropdown toggling off the source DB.
const FACET_KEYS = ['q', 'category', 'city', 'minRating', 'minReviews', 'temperature', 'websiteStatus', 'hasEmail', 'hasPhone'] as const;
const filteredFacetsCache = new Map<string, { at: number; value: Facets }>();

function facetSignature(f: SearchFilters): string {
  return JSON.stringify({
    q: (f.q || '').trim().toLowerCase(), category: f.category || '', city: (f.city || '').trim().toLowerCase(),
    minRating: f.minRating || 0, minReviews: f.minReviews || 0,
    temperature: f.temperature || '', websiteStatus: f.websiteStatus || '',
    hasEmail: !!f.hasEmail, hasPhone: !!f.hasPhone,
  });
}

export async function getFacetsFiltered(f: SearchFilters): Promise<Facets> {
  // No facet-relevant filter set → the global cached facets are already correct.
  if (!FACET_KEYS.some((k) => f[k])) return getFacets();

  const sig = facetSignature(f);
  const hit = filteredFacetsCache.get(sig);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  const col = await leadsCollection();
  // Category buckets exclude the category filter; city buckets exclude the city
  // filter. Everything else constrains both, and the total reflects all filters.
  const catMatch = buildQuery({ ...f, category: undefined });
  const cityMatch = buildQuery({ ...f, city: undefined });
  const [categories, cities, total] = await Promise.all([
    col.aggregate(categoryStages(catMatch), { allowDiskUse: true }).toArray(),
    col.aggregate(cityStages(cityMatch), { allowDiskUse: true }).toArray(),
    col.countDocuments(buildQuery(f)),
  ]);
  const value: Facets = {
    categories: categories as Facets['categories'],
    cities: cities as Facets['cities'],
    total,
  };

  if (filteredFacetsCache.size > 200) filteredFacetsCache.clear(); // bounded
  filteredFacetsCache.set(sig, { at: Date.now(), value });
  return value;
}

// Full aggregation — used by getFacets on cold cache and by the daily cron.
export async function computeFacets(): Promise<Facets> {
  const col = await leadsCollection();
  const [categories, cities, total] = await Promise.all([
    col.aggregate(categoryStages({}), { allowDiskUse: true }).toArray(),
    col.aggregate(cityStages({}), { allowDiskUse: true }).toArray(),
    col.estimatedDocumentCount(),
  ]);
  return {
    categories: categories as Facets['categories'],
    cities: cities as Facets['cities'],
    total,
  };
}

export async function searchLeads(f: SearchFilters) {
  const col = await leadsCollection();
  const query = buildQuery(f);
  const page = Math.max(1, f.page || 1);
  const [items, total] = await Promise.all([
    col.find(query)
      .sort({ leadScore: -1, _id: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray(),
    col.countDocuments(query),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getSourceLead(id: string): Promise<Document | null> {
  if (!ObjectId.isValid(id)) return null;
  const col = await leadsCollection();
  const doc = await col.findOne({ _id: new ObjectId(id) });
  return doc ? validateSourceLead(doc) : null;
}

// ── Schema-drift guard. The source DB belongs to the GridLeads pipeline —
// a field rename over there must NOT silently break masking or leak data.
// Coerces wrong types to safe values and logs each drifted field once.
const STRING_FIELDS = ['name', 'category', 'address', 'phone', 'email', 'website',
  'mapsUrl', 'websiteStatus', 'leadTemperature', 'topPitch',
  'aiSummary', 'aiPainPoints', 'aiAdvantages', 'aiPitch'] as const;
const NUMBER_FIELDS = ['rating', 'reviewCount', 'leadScore', 'opportunityScore'] as const;
const driftLogged = new Set<string>();

export function validateSourceLead(doc: Document): Document {
  const out: Document = { _id: doc._id };
  for (const f of STRING_FIELDS) {
    const v = doc[f];
    if (v == null) { out[f] = ''; continue; }
    if (typeof v !== 'string') {
      if (!driftLogged.has(f)) {
        driftLogged.add(f);
        console.error(JSON.stringify({ event: 'source_schema_drift', field: f, gotType: typeof v }));
      }
      out[f] = String(v);
    } else out[f] = v;
  }
  for (const f of NUMBER_FIELDS) {
    const v = doc[f];
    if (v == null) { out[f] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      if (!driftLogged.has(f)) {
        driftLogged.add(f);
        console.error(JSON.stringify({ event: 'source_schema_drift', field: f, gotType: typeof v }));
      }
      const n = Number(v);
      out[f] = Number.isFinite(n) ? n : null;
    } else out[f] = v;
  }
  return out;
}

// Snapshot stored on the Unlock — what the user paid for survives a source
// delete. Contact fields included; masking still happens in shapeLead by scope.
export function snapshotFromDoc(doc: Document): Document {
  const snap: Document = {};
  for (const f of [...STRING_FIELDS, ...NUMBER_FIELDS]) snap[f] = doc[f];
  return snap;
}

// Lead by id with unlock-snapshot fallback (source row deleted → paid data stays).
export async function getLeadOrSnapshot(id: string, userId: unknown): Promise<Document | null> {
  const doc = await getSourceLead(id);
  if (doc) return doc;
  if (!ObjectId.isValid(id)) return null;
  const { Unlock } = await import('./models');
  const unlock = await Unlock.findOne({ userId, leadId: new ObjectId(id), snapshot: { $ne: null } })
    .sort({ createdAt: -1 }).lean() as { snapshot: Document } | null;
  if (!unlock?.snapshot) return null;
  return validateSourceLead({ _id: new ObjectId(id), ...unlock.snapshot });
}

// "123 Main St, Houston, TX 77002, USA" → "Houston, TX 77002, USA" (street dropped)
// "123 Main St, Houston, TX 77002, USA" → "Houston, TX 77002, USA" (street dropped).
// Used for the display `city` field in shapeLead and CSV export.
export function cityPart(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(', ') : '';
}

// Just the city token (the component after the street) — for tx descriptions
// and similar-lead matching. "123 Main St, Houston, TX 77002, USA" → "Houston".
export function cityName(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[1] || '';
}

function maskName(name?: string): string {
  if (!name) return '•••';
  return name.slice(0, 2) + '•'.repeat(Math.min(12, Math.max(4, name.length - 2)));
}

export interface UnlockFlags { lead: boolean; contact: boolean; }

// Shape a source lead for the API response according to what the user paid for.
export function shapeLead(doc: Document, u: UnlockFlags) {
  const base = {
    id: String(doc._id),
    name: u.lead ? (doc.name || '') : maskName(doc.name),
    category: doc.category || '',
    rating: doc.rating ?? null,
    reviewCount: doc.reviewCount ?? null,
    city: cityPart(doc.address),
    leadScore: doc.leadScore ?? null,
    leadTemperature: doc.leadTemperature || '',
    opportunityScore: doc.opportunityScore ?? null,
    hasPhone: !!doc.phone, hasEmail: !!doc.email, hasWebsite: !!doc.website,
    unlocked: u,
  };
  if (!u.lead) return base;
  const full = {
    ...base,
    address: doc.address || '',
    mapsUrl: doc.mapsUrl || '',
    websiteStatus: doc.websiteStatus || '',
    topPitch: doc.topPitch || '',
    aiSummary: doc.aiSummary || '',
    aiPainPoints: doc.aiPainPoints || '',
    aiAdvantages: doc.aiAdvantages || '',
    aiPitch: doc.aiPitch || '',
  };
  if (!u.contact) return full;
  return { ...full, phone: doc.phone || '', email: doc.email || '', website: doc.website || '' };
}
