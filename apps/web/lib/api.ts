'use client';

import type { LeadRow } from './types';

async function jget(url: string) { const r = await fetch(url); return r.json(); }
async function jsend(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export interface LeadsQuery {
  project?: string | null;
  folder?: string | null;
  filter?: string;
  search?: string;
  categories?: string[];
  ptypes?: string[];
  pregions?: string[];
  sort?: string;
  dir?: number;
  page?: number;
  pageSize?: number;
}

export interface DupeGroup { name: string; address?: string; items: { project: string; key: string; name: string; category?: string; rating?: number; reviewCount?: number; checked?: boolean }[]; }

export interface ReviewListRow {
  id: string; dedupKey: string; businessName: string; address: string; project: string;
  author: string; authorUrl: string; rating: number | null; text: string;
  relativeTime: string; ownerResponse: string; scrapedAt: string;
}

export interface OrganizeMove { query: string; from: string; createdAt: string; }
export interface OrganizeSub { name: string; status: 'created' | 'reparented' | 'existing'; fromParent?: string; movedCount: number; alreadyHere: number; moved: OrganizeMove[]; }
export interface OrganizeRoot { name: string; icon: string; created: boolean; movedCount: number; subs: OrganizeSub[]; }

export interface GeoPoint {
  lat: number; lng: number; name: string;
  category?: string; rating?: number | null; reviewCount?: number | null;
  phone?: string; website?: string; websiteStatus: string;
  mapsUrl?: string; opportunityScore?: number; leadTemperature?: string;
}

export const api = {
  getFolders: () => jget('/api/folders'),
  getProjects: () => jget('/api/projects'),
  getGroups: () => jget('/api/groups') as Promise<{ ok: boolean; groups: { groupId: string; name: string; createdAt: string; count: number }[] }>,
  getGroupLeads: (id: string, page = 1, pageSize = 100) =>
    jget(`/api/groups?id=${encodeURIComponent(id)}&page=${page}&pageSize=${pageSize}`) as Promise<{ ok: boolean; name?: string; rows: any[]; total: number; error?: string }>,
  createGroup: (name: string, opts: { keys?: string[]; fromChecked?: boolean } = {}) =>
    jsend('/api/groups', 'POST', { name, ...opts }) as Promise<{ ok: boolean; groupId?: string; count?: number; error?: string }>,
  renameGroup: (id: string, name: string) => jsend('/api/groups', 'PATCH', { id, name }),
  addToGroup: (id: string, opts: { keys?: string[]; fromChecked?: boolean }) =>
    jsend('/api/groups', 'PATCH', { id, add: opts.keys || [], fromChecked: !!opts.fromChecked }) as Promise<{ ok: boolean; added?: number; error?: string }>,
  removeFromGroup: (id: string, keys: string[]) => jsend('/api/groups', 'PATCH', { id, remove: keys }),
  deleteGroup: (id: string) => jsend('/api/groups', 'DELETE', { id }),
  refreshProjectStats: (body: { after?: string | null; at?: string } = {}) =>
    jsend('/api/projects/refresh', 'POST', body) as Promise<{ ok: boolean; done?: boolean; after?: string | null; at?: string; projects?: number; error?: string }>,

  getLeads: (q: LeadsQuery): Promise<{ rows: LeadRow[]; total: number }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    (q.categories || []).forEach((c) => p.append('cat', c));
    (q.ptypes || []).forEach((t) => p.append('ptype', t));
    (q.pregions || []).forEach((r) => p.append('pregion', r));
    if (q.sort) p.set('sort', q.sort);
    if (q.dir) p.set('dir', String(q.dir));
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    return jget('/api/leads?' + p.toString());
  },

  getDuplicates: (): Promise<DupeGroup[]> => jget('/api/duplicates'),
  getCategories: (q: { project?: string | null; folder?: string | null }): Promise<{ categories: { category: string; count: number }[] }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    return jget('/api/categories?' + p.toString());
  },
  getGeo: (q: { project?: string | null; folder?: string | null; filter?: string; search?: string; categories?: string[]; ptypes?: string[]; pregions?: string[] }): Promise<{ points: GeoPoint[]; total: number; capped: boolean }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    (q.categories || []).forEach((c) => p.append('cat', c));
    (q.ptypes || []).forEach((t) => p.append('ptype', t));
    (q.pregions || []).forEach((r) => p.append('pregion', r));
    return jget('/api/geo?' + p.toString());
  },
  getStats: (q: { project?: string | null; folder?: string | null; granularity?: 'day' | 'hour' }): Promise<{ buckets: { key: string; count: number }[]; gran: string; total: number; metrics?: { total: number; noWebsite: number; hot: number; email: number; reviews: number; reviewsSum: number; ai: number; avgOpp: number } }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.granularity) p.set('granularity', q.granularity);
    return jget('/api/stats?' + p.toString());
  },
  getProjectFacets: (q: { project?: string | null; folder?: string | null }): Promise<{ types: { value: string; count: number }[]; regions: { value: string; count: number }[] }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    return jget('/api/projectfacets?' + p.toString());
  },
  exportBundle: (opts: { queries?: string[]; folderId?: string }) => jsend('/api/export', 'POST', opts),

  createFolder: (id: string, name: string, createdAt: string, parentId: string | null = null) => jsend('/api/folders', 'POST', { id, name, createdAt, parentId }),
  renameFolder: (id: string, name: string) => jsend('/api/folders', 'PATCH', { id, name }),
  setFolderCollapsed: (id: string, collapsed: boolean) => jsend('/api/folders', 'PATCH', { id, collapsed }),
  moveFolder: (id: string, parentId: string | null) => jsend('/api/folders', 'PATCH', { id, parentId }),
  moveFolders: (ids: string[], parentId: string | null) => jsend('/api/folders', 'PATCH', { ids, parentId }),
  setFolderIcon: (id: string, icon: string) => jsend('/api/folders', 'PATCH', { id, icon }),
  setFoldersIcon: (ids: string[], icon: string) => jsend('/api/folders', 'PATCH', { ids, icon }),
  deleteFolder: (id: string) => jsend('/api/folders', 'DELETE', { id }),
  reorderFolders: (ids: string[]) => jsend('/api/folders', 'PATCH', { order: ids }),

  renameProject: (query: string, name: string) => jsend('/api/projects', 'PATCH', { query, name }),
  renameProjects: (queries: string[], name: string) => jsend('/api/projects', 'PATCH', { queries, name }),
  moveProjects: (queries: string[], folderId: string | null) => jsend('/api/projects', 'PATCH', { queries, folderId }),
  deleteProjects: (queries: string[]) => jsend('/api/projects', 'DELETE', { queries }),

  setChecked: (project: string, dedupKey: string, checked: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, checked }),
  setCall: (project: string, dedupKey: string, call: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, call }),
  getCallCount: (): Promise<{ total: number }> => jget('/api/calls?count=1'),
  getCheckedCount: (): Promise<{ total: number }> => jget('/api/leads?countChecked=1'),
  uncheckAll: (): Promise<{ ok: boolean; updated: number }> => jsend('/api/leads', 'PATCH', { uncheckAll: true }),
  getCalls: (): Promise<{ rows: LeadRow[]; total: number; capped?: boolean }> => jget('/api/calls'),
  setWebsiteStatus: (project: string, dedupKey: string, websiteStatus: string) => jsend('/api/leads', 'PATCH', { project, dedupKey, websiteStatus }),
  setOpportunity: (project: string, dedupKey: string, opportunityScore: number) => jsend('/api/leads', 'PATCH', { project, dedupKey, opportunityScore }),
  updateLeadField: (project: string, dedupKey: string, field: string, value: unknown) => jsend('/api/leads', 'PATCH', { project, dedupKey, field, value }),
  setTags: (project: string, dedupKey: string, tags: string[]) => jsend('/api/leads', 'PATCH', { project, dedupKey, tags }),
  deleteRecords: (items: { query: string; key: string }[]) => jsend('/api/leads', 'DELETE', { items }),

  getReviews: (dedupKey: string): Promise<{ ok: boolean; total: number; rows: import('./types').ReviewRow[] }> =>
    jget('/api/reviews?dedupKey=' + encodeURIComponent(dedupKey)),

  // Reviews view — paginated list with geo/business filters
  getReviewList: (q: { page?: number; pageSize?: number; dedupKey?: string; country?: string; state?: string; city?: string; search?: string }): Promise<{ ok: boolean; rows: ReviewListRow[]; total: number; page: number; pageSize: number }> => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    if (q.dedupKey) p.set('dedupKey', q.dedupKey);
    if (q.country) p.set('country', q.country);
    if (q.state) p.set('state', q.state);
    if (q.city) p.set('city', q.city);
    if (q.search) p.set('search', q.search);
    return jget('/api/reviews/list?' + p.toString());
  },
  getReviewBusinesses: (q: string): Promise<{ ok: boolean; businesses: { dedupKey: string; name: string; address: string; reviewsCount: number }[] }> =>
    jget('/api/reviews/businesses?q=' + encodeURIComponent(q)),

  // AI insights for one lead via the local Claude CLI (localhost only — see /api/enrich)
  enrichLead: (dedupKey: string): Promise<{ ok: boolean; error?: string; ai?: { aiSummary: string; aiPainPoints: string; aiAdvantages: string; aiPitch: string; aiAt: string } }> =>
    jsend('/api/enrich', 'POST', { dedupKey }),

  getTags: (): Promise<{ tags: { name: string; color: string }[] }> => jget('/api/tags'),
  createTag: (name: string, color: string) => jsend('/api/tags', 'POST', { name, color }),
  deleteTag: (name: string) => jsend('/api/tags', 'DELETE', { name }),

  sync: (bundle: unknown) => jsend('/api/sync', 'POST', bundle),

  recalcScores: (after: string | null): Promise<{ ok: boolean; processed: number; lastId: string | null; done: boolean; total?: number }> =>
    jsend('/api/recalc', 'POST', { after }),

  // Auto-organize: re-file projects into "<region> <vertical>" folders nested
  // under "<country> <vertical>" roots. Pass { dryRun:true } for a preview.
  organize: (opts: { dryRun?: boolean; cleanup?: boolean } = {}): Promise<{
    ok: boolean; dryRun: boolean; totalProjects: number; foldersCreated: string[];
    foldersReparented: number; projectsMoved: number; foldersDeleted: string[];
    unmatched: number; sampleUnmatched: string[]; error?: string;
    plan: { roots: OrganizeRoot[] };
  }> => jsend('/api/organize', 'POST', opts),

  // Chunked sync — splits big bundles so no request exceeds the serverless body
  // limit (Vercel ~4.5MB). Returns aggregate counts.
  syncBundleChunked: async (
    bundle: { folders?: Record<string, unknown>; projects?: Record<string, { query: string; name?: string; createdAt?: string; folderId?: string | null; records?: Record<string, unknown> }> },
    onProgress?: (done: number, total: number) => void,
    chunkSize = 500,
  ) => {
    const folders = bundle.folders || {};
    const projects = Object.values(bundle.projects || {});
    let sentFolders = false, projCount = 0, added = 0, updated = 0, skippedDuplicates = 0;
    if (Object.keys(folders).length) { await jsend('/api/sync', 'POST', { gridleads: 1, folders, projects: {} }); sentFolders = true; }
    for (const p of projects) {
      const meta = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId };
      const entries = Object.entries(p.records || {});
      if (!entries.length) {
        await jsend('/api/sync', 'POST', { gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: {} } } });
        sentFolders = true;
      } else {
        for (let i = 0; i < entries.length; i += chunkSize) {
          const chunk = Object.fromEntries(entries.slice(i, i + chunkSize));
          const j = await jsend('/api/sync', 'POST', { gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: chunk } } });
          sentFolders = true;
          if (j) { added += j.added || 0; updated += j.updated || 0; skippedDuplicates += j.skippedDuplicates || 0; }
        }
      }
      projCount++;
      if (onProgress) onProgress(projCount, projects.length);
    }
    return { ok: true, projects: projCount, added, updated, skippedDuplicates };
  },
};
