'use client';

import { create } from 'zustand';
import type { Folder, Lead, ProjectSummary } from './types';
import { api } from './api';

function newId(prefix: string) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export interface ExportBundle {
  gridleads: number;
  exportedAt: string;
  folders: Record<string, Folder>;
  projects: Record<string, unknown>;
}

interface GridState {
  folders: Record<string, Folder>;
  summaries: Record<string, ProjectSummary>; // keyed by query — sidebar + widgets
  hydrated: boolean;

  hydrate(): Promise<void>;
  refresh(): Promise<void>;

  createFolder(name: string): void;
  renameFolder(id: string, name: string): void;
  deleteFolder(id: string): void;
  setFolderCollapsed(id: string, collapsed: boolean): void;

  renameProject(query: string, name: string): void;
  deleteProject(query: string): void;
  renameProjects(queries: string[], name: string): void;
  deleteProjects(queries: string[]): void;
  moveProjects(queries: string[], folderId: string | null): void;

  importMerge(data: ExportBundle): Promise<void>;
}

const swallow = () => {};
const toMap = <T extends { query?: string; id?: string }>(arr: T[], key: 'query' | 'id') => {
  const m: Record<string, T> = {};
  for (const x of arr || []) m[(x as Record<string, string>)[key]] = x;
  return m;
};

export const useGrid = create<GridState>()((set, get) => ({
  folders: {},
  summaries: {},
  hydrated: false,

  hydrate: async () => {
    const [folders, projects] = await Promise.all([api.getFolders(), api.getProjects()]);
    set({ folders: toMap(folders, 'id'), summaries: toMap(projects, 'query'), hydrated: true });
  },
  refresh: async () => {
    const [folders, projects] = await Promise.all([api.getFolders(), api.getProjects()]);
    set({ folders: toMap(folders, 'id'), summaries: toMap(projects, 'query') });
  },

  createFolder: (name) => {
    const id = newId('f_'); const createdAt = new Date().toISOString();
    set((s) => ({ folders: { ...s.folders, [id]: { id, name: name.trim() || 'New folder', createdAt, collapsed: true } } }));
    api.createFolder(id, name.trim() || 'New folder', createdAt).catch(swallow);
  },
  renameFolder: (id, name) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, name } } } : {}; });
    api.renameFolder(id, name).catch(swallow);
  },
  deleteFolder: (id) => {
    set((s) => {
      const folders = { ...s.folders }; delete folders[id];
      const summaries = { ...s.summaries };
      for (const q of Object.keys(summaries)) if (summaries[q].folderId === id) summaries[q] = { ...summaries[q], folderId: null };
      return { folders, summaries };
    });
    api.deleteFolder(id).catch(swallow);
  },
  setFolderCollapsed: (id, collapsed) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, collapsed } } } : {}; });
    api.setFolderCollapsed(id, collapsed).catch(swallow);
  },

  renameProject: (query, name) => {
    set((s) => { const p = s.summaries[query]; return p ? { summaries: { ...s.summaries, [query]: { ...p, name } } } : {}; });
    api.renameProject(query, name).catch(swallow);
  },
  deleteProject: (query) => {
    set((s) => { const summaries = { ...s.summaries }; delete summaries[query]; return { summaries }; });
    api.deleteProjects([query]).catch(swallow);
  },
  renameProjects: (queries, name) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) if (summaries[q]) summaries[q] = { ...summaries[q], name }; return { summaries }; });
    api.renameProjects(queries, name).catch(swallow);
  },
  deleteProjects: (queries) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) delete summaries[q]; return { summaries }; });
    api.deleteProjects(queries).catch(swallow);
  },
  moveProjects: (queries, folderId) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) if (summaries[q]) summaries[q] = { ...summaries[q], folderId: folderId || null }; return { summaries }; });
    api.moveProjects(queries, folderId).catch(swallow);
  },

  importMerge: async (data) => {
    await api.sync(data).catch(swallow);
    await get().hydrate();
  },
}));

export function downloadJson(data: unknown, hint: string) {
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gridleads-${slug(hint)}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadText(text: string, mime: string, hint: string, ext: string) {
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gridleads-${slug(hint)}-${stamp}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCsv(rows: Lead[]): string {
  const COLUMNS: [keyof Lead, string][] = [
    ['name', 'Business'], ['category', 'Category'], ['rating', 'Rating'], ['reviewCount', 'Reviews'],
    ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['websiteStatus', 'Website Status'],
    ['leadScore', 'Lead Score'], ['leadTemperature', 'Temperature'], ['opportunityScore', 'Opportunity Score'],
    ['topPitch', 'Top Pitch'], ['address', 'Address'], ['lat', 'Lat'], ['lng', 'Lng'], ['mapsUrl', 'Maps URL'],
  ];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const str = String(v);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const header = COLUMNS.map((c) => c[1]).join(',');
  const body = rows.map((r) => COLUMNS.map((c) => esc(r[c[0]])).join(',')).join('\n');
  return header + '\n' + body;
}

// flatten an export bundle's projects.records into a flat lead array (for CSV)
export function bundleToRows(bundle: ExportBundle): Lead[] {
  const out: Lead[] = [];
  for (const p of Object.values(bundle.projects || {}) as { records?: Record<string, Lead> }[]) {
    for (const r of Object.values(p.records || {})) out.push(r);
  }
  return out;
}
