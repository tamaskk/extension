import mongoose, { Schema, model, models } from 'mongoose';

// ── Folder ───────────────────────────────────────────────────────────────
const FolderSchema = new Schema({
  folderId: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  collapsed: { type: Boolean, default: true },
  order: { type: Number, default: 0 }, // manual drag-and-drop ordering
  parentId: { type: String, default: null, index: true }, // null = root; otherwise nested under this folder
  icon: { type: String, default: '' }, // optional emoji icon (business-type)
}, { versionKey: false });

// ── Project (one Google Maps search) ─────────────────────────────────────
const ProjectSchema = new Schema({
  query: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  folderId: { type: String, default: null, index: true },
  population: { type: Number, default: null }, // for State-mode projects: the place's population
}, { versionKey: false });

// ── Lead (a scraped business) — separate collection, scales past 16MB/project
const LeadSchema = new Schema({
  project: { type: String, required: true, index: true },
  dedupKey: { type: String, required: true },
  placeId: String,
  cid: String,
  name: String,
  category: String,
  rating: { type: Number, default: null },
  reviewCount: { type: Number, default: null },
  phone: String,
  website: String,
  email: String,
  address: String,
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  mapsUrl: String,
  websiteStatus: String,
  leadScore: Number,
  leadTemperature: String,
  opportunityScore: Number,
  topPitch: String,
  checked: { type: Boolean, default: false },
  call: { type: Boolean, default: false }, // flagged for calling — shown in the Calls modal
  tags: { type: [String], default: [] },
  salesStatus: { type: String, default: '' }, // sales pipeline stage
  salesDate: { type: String, default: '' },   // date for callback / follow-up / meeting stages
  notes: { type: String, default: '' },       // free-form notes (auto-saved from the detail panel)

  // ── review scraping (separate Review collection holds the texts) ──────────
  reviewsScrapedAt: { type: String, default: '' }, // ISO when reviews were scraped; '' = not done yet (skip-if-done flag)
  reviewsCount: { type: Number, default: null },   // how many review rows we actually stored
  reviewsError: { type: String, default: '' },     // last scrape error (so failures can be retried/inspected)

  // ── AI insights (generated locally via the Claude CLI — see /api/enrich) ─────
  aiSummary: { type: String, default: '' },
  aiPainPoints: { type: String, default: '' },
  aiAdvantages: { type: String, default: '' },
  aiPitch: { type: String, default: '' },
  aiAt: { type: String, default: '' },             // ISO when generated; '' = not yet (skip-if-done)

  hasBookingHint: Schema.Types.Mixed,
  scrapedAt: String,
}, { versionKey: false });

// ── Review (one Google Maps review for a business) — separate collection ──
const ReviewSchema = new Schema({
  project: { type: String, required: true },              // owning project (Lead.project)
  dedupKey: { type: String, required: true, index: true }, // the business id (globally single-homed); join key
  cid: String,
  placeId: String,
  reviewId: { type: String, default: '' },                // Google's review id when available — per-review dedup
  author: { type: String, default: '' },
  authorUrl: { type: String, default: '' },
  rating: { type: Number, default: null },
  text: { type: String, default: '' },
  relativeTime: { type: String, default: '' },            // e.g. "2 weeks ago" as scraped
  ownerResponse: { type: String, default: '' },
  scrapedAt: String,                                      // ISO when this review row was saved
}, { versionKey: false });

// ── ProjectStat (precomputed per-project lead counters) ──────────────────
// The sidebar/stat-tile numbers come from here instead of a live $group over
// 1.2M+ leads. Write paths call recomputeProjectStats() (lib/projectStats.ts)
// for the projects they touched; the ⟳ Recount button rebuilds everything.
const ProjectStatSchema = new Schema({
  project: { type: String, required: true, unique: true, index: true },
  total: { type: Number, default: 0 },
  noWebsite: { type: Number, default: 0 },
  hot: { type: Number, default: 0 },
  email: { type: Number, default: 0 },
  reviews: { type: Number, default: 0 },      // leads with ≥1 scraped review
  reviewsSum: { type: Number, default: 0 },   // total scraped review rows
  ai: { type: Number, default: 0 },           // leads with AI analysis
  oppSum: { type: Number, default: 0 },       // sum of opportunityScore (avg = oppSum/total)
  updatedAt: String,
}, { versionKey: false });

// ── LeadGroup (a named, hand-picked set of leads) ────────────────────────
// Created from the currently-checked leads; members are dedupKeys (globally
// single-homed per the cross-project dedup rule, so no project needed).
const LeadGroupSchema = new Schema({
  groupId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  createdAt: String,
  keys: { type: [String], default: [] },
}, { versionKey: false });

// ── Tag (a reusable, colored label) — registry shared across all leads ────
const TagSchema = new Schema({
  name: { type: String, required: true, unique: true, index: true },
  color: { type: String, default: '#6366f1' },
}, { versionKey: false });

LeadSchema.index({ project: 1, dedupKey: 1 }, { unique: true });
LeadSchema.index({ dedupKey: 1 }); // cross-project duplicate lookups
LeadSchema.index({ websiteStatus: 1 });
LeadSchema.index({ leadTemperature: 1 });
// sort indexes (server-side pagination ordering)
LeadSchema.index({ opportunityScore: 1 });
LeadSchema.index({ leadScore: 1 });
LeadSchema.index({ rating: 1 });
LeadSchema.index({ reviewCount: 1 });
LeadSchema.index({ scrapedAt: 1 }); // Date column sort
LeadSchema.index({ tags: 1 }); // tag filtering
LeadSchema.index({ call: 1 }); // calls modal
LeadSchema.index({ reviewsScrapedAt: 1, scrapedAt: -1 }); // "next business without reviews, most recent first"
LeadSchema.index({ reviewsCount: 1 }); // businesses-with-reviews lookup (Reviews view autocomplete)

ReviewSchema.index({ dedupKey: 1 });                  // all reviews for a business
ReviewSchema.index({ project: 1, dedupKey: 1 });      // scoped lookup matching Lead's key
// idempotent re-saves: never store the same Google review twice for a business
// (partial filter so rows WITHOUT a reviewId can still be inserted without colliding on '')
ReviewSchema.index({ dedupKey: 1, reviewId: 1 }, { unique: true, partialFilterExpression: { reviewId: { $gt: '' } } });

export const Folder = models.Folder || model('Folder', FolderSchema);
export const Project = models.Project || model('Project', ProjectSchema);
export const Lead = models.Lead || model('Lead', LeadSchema);
export const ProjectStat = models.ProjectStat || model('ProjectStat', ProjectStatSchema);
export const LeadGroup = models.LeadGroup || model('LeadGroup', LeadGroupSchema);
export const Tag = models.Tag || model('Tag', TagSchema);
export const Review = models.Review || model('Review', ReviewSchema);

export const NO_SITE = ['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING'];

// A folder id plus every folder nested beneath it (any depth). Used so that
// selecting a parent folder scopes leads to all its sub-folders too.
export async function descendantFolderIds(rootId: string): Promise<string[]> {
  const all = await Folder.find().select('folderId parentId -_id').lean() as { folderId: string; parentId?: string | null }[];
  const childrenOf: Record<string, string[]> = {};
  for (const f of all) { const p = f.parentId || ''; (childrenOf[p] = childrenOf[p] || []).push(f.folderId); }
  const out: string[] = []; const stack = [rootId];
  while (stack.length) { const id = stack.pop() as string; out.push(id); for (const c of (childrenOf[id] || [])) stack.push(c); }
  return out;
}

// shared CORS headers so the Chrome extension can call these endpoints
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Apply business-type (project starts-with) + region (project ends-with) facet
// filters onto a Mongo `match`, combining with any existing project scope.
export function applyProjectFacets(match: Record<string, unknown>, ptypes: string[], pregions: string[]) {
  if (!ptypes.length && !pregions.length) return;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = ptypes.length ? new RegExp('^(' + ptypes.map(esc).join('|') + ')', 'i') : null;
  const endRe = pregions.length ? new RegExp('(^|\\s)(' + pregions.map(esc).join('|') + ')$', 'i') : null;
  const test = (q: string) => (!startRe || startRe.test(q)) && (!endRe || endRe.test(q));
  const cur = match.project as unknown;
  if (cur && typeof cur === 'object' && Array.isArray((cur as { $in?: string[] }).$in)) {
    match.project = { $in: (cur as { $in: string[] }).$in.filter(test) };
  } else if (typeof cur === 'string') {
    if (!test(cur)) match.project = ' __none__';
  } else {
    const conds: Record<string, unknown>[] = [];
    if (startRe) conds.push({ project: startRe });
    if (endRe) conds.push({ project: endRe });
    if (conds.length) match.$and = ((match.$and as Record<string, unknown>[]) || []).concat(conds);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...CORS, ...(init?.headers || {}) },
  });
}

export { mongoose };
