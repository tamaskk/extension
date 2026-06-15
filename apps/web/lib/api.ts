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
  sort?: string;
  dir?: number;
  page?: number;
  pageSize?: number;
}

export interface DupeGroup { name: string; address?: string; items: { project: string; key: string; name: string; category?: string; rating?: number; reviewCount?: number; checked?: boolean }[]; }

export interface GeoPoint {
  lat: number; lng: number; name: string;
  category?: string; rating?: number | null; reviewCount?: number | null;
  phone?: string; website?: string; websiteStatus: string;
  mapsUrl?: string; opportunityScore?: number; leadTemperature?: string;
}

export const api = {
  getFolders: () => jget('/api/folders'),
  getProjects: () => jget('/api/projects'),

  getLeads: (q: LeadsQuery): Promise<{ rows: LeadRow[]; total: number }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    if (q.sort) p.set('sort', q.sort);
    if (q.dir) p.set('dir', String(q.dir));
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    return jget('/api/leads?' + p.toString());
  },

  getDuplicates: (): Promise<DupeGroup[]> => jget('/api/duplicates'),
  getGeo: (q: { project?: string | null; folder?: string | null; filter?: string; search?: string }): Promise<{ points: GeoPoint[]; total: number; capped: boolean }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    return jget('/api/geo?' + p.toString());
  },
  exportBundle: (opts: { queries?: string[]; folderId?: string }) => jsend('/api/export', 'POST', opts),

  createFolder: (id: string, name: string, createdAt: string) => jsend('/api/folders', 'POST', { id, name, createdAt }),
  renameFolder: (id: string, name: string) => jsend('/api/folders', 'PATCH', { id, name }),
  setFolderCollapsed: (id: string, collapsed: boolean) => jsend('/api/folders', 'PATCH', { id, collapsed }),
  deleteFolder: (id: string) => jsend('/api/folders', 'DELETE', { id }),
  reorderFolders: (ids: string[]) => jsend('/api/folders', 'PATCH', { order: ids }),

  renameProject: (query: string, name: string) => jsend('/api/projects', 'PATCH', { query, name }),
  renameProjects: (queries: string[], name: string) => jsend('/api/projects', 'PATCH', { queries, name }),
  moveProjects: (queries: string[], folderId: string | null) => jsend('/api/projects', 'PATCH', { queries, folderId }),
  deleteProjects: (queries: string[]) => jsend('/api/projects', 'DELETE', { queries }),

  setChecked: (project: string, dedupKey: string, checked: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, checked }),
  setTags: (project: string, dedupKey: string, tags: string[]) => jsend('/api/leads', 'PATCH', { project, dedupKey, tags }),
  deleteRecords: (items: { query: string; key: string }[]) => jsend('/api/leads', 'DELETE', { items }),

  getTags: (): Promise<{ tags: { name: string; color: string }[] }> => jget('/api/tags'),
  createTag: (name: string, color: string) => jsend('/api/tags', 'POST', { name, color }),
  deleteTag: (name: string) => jsend('/api/tags', 'DELETE', { name }),

  sync: (bundle: unknown) => jsend('/api/sync', 'POST', bundle),

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
