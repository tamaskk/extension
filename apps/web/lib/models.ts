import mongoose, { Schema, model, models } from 'mongoose';

// ── Folder ───────────────────────────────────────────────────────────────
const FolderSchema = new Schema({
  folderId: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  collapsed: { type: Boolean, default: true },
  order: { type: Number, default: 0 }, // manual drag-and-drop ordering
  parentId: { type: String, default: null, index: true }, // null = root; otherwise nested under this folder
}, { versionKey: false });

// ── Project (one Google Maps search) ─────────────────────────────────────
const ProjectSchema = new Schema({
  query: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  folderId: { type: String, default: null, index: true },
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
  tags: { type: [String], default: [] },
  salesStatus: { type: String, default: '' }, // sales pipeline stage
  salesDate: { type: String, default: '' },   // date for callback / follow-up / meeting stages

  hasBookingHint: Schema.Types.Mixed,
  scrapedAt: String,
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
LeadSchema.index({ tags: 1 }); // tag filtering

export const Folder = models.Folder || model('Folder', FolderSchema);
export const Project = models.Project || model('Project', ProjectSchema);
export const Lead = models.Lead || model('Lead', LeadSchema);
export const Tag = models.Tag || model('Tag', TagSchema);

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

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...CORS, ...(init?.headers || {}) },
  });
}

export { mongoose };
