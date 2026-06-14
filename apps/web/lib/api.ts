'use client';

import type { LeadRow } from './types';

async function jget(url: string) { const r = await fetch(url); return r.json(); }
async function jsend(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export interface LeadsQuery {
  project?: string | null;
  filter?: string;
  search?: string;
  sort?: string;
  dir?: number;
  page?: number;
  pageSize?: number;
}

export interface DupeGroup { name: string; address?: string; items: { project: string; key: string; name: string; category?: string; rating?: number; reviewCount?: number; checked?: boolean }[]; }

export const api = {
  getFolders: () => jget('/api/folders'),
  getProjects: () => jget('/api/projects'),

  getLeads: (q: LeadsQuery): Promise<{ rows: LeadRow[]; total: number }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    if (q.sort) p.set('sort', q.sort);
    if (q.dir) p.set('dir', String(q.dir));
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    return jget('/api/leads?' + p.toString());
  },

  getDuplicates: (): Promise<DupeGroup[]> => jget('/api/duplicates'),
  exportBundle: (opts: { queries?: string[]; folderId?: string }) => jsend('/api/export', 'POST', opts),

  createFolder: (id: string, name: string, createdAt: string) => jsend('/api/folders', 'POST', { id, name, createdAt }),
  renameFolder: (id: string, name: string) => jsend('/api/folders', 'PATCH', { id, name }),
  setFolderCollapsed: (id: string, collapsed: boolean) => jsend('/api/folders', 'PATCH', { id, collapsed }),
  deleteFolder: (id: string) => jsend('/api/folders', 'DELETE', { id }),

  renameProject: (query: string, name: string) => jsend('/api/projects', 'PATCH', { query, name }),
  renameProjects: (queries: string[], name: string) => jsend('/api/projects', 'PATCH', { queries, name }),
  moveProjects: (queries: string[], folderId: string | null) => jsend('/api/projects', 'PATCH', { queries, folderId }),
  deleteProjects: (queries: string[]) => jsend('/api/projects', 'DELETE', { queries }),

  setChecked: (project: string, dedupKey: string, checked: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, checked }),
  deleteRecords: (items: { query: string; key: string }[]) => jsend('/api/leads', 'DELETE', { items }),

  sync: (bundle: unknown) => jsend('/api/sync', 'POST', bundle),
};
