'use client';

import { create } from 'zustand';
import type { Folder, FolderAggregate, Lead, ProjectSummary, SidebarPayload } from './types';
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

// the "folder" key of the projects that are in no folder
export const ROOT_FOLDER = '__root__';

const EMPTY_AGG: FolderAggregate = { projects: 0, zero: 0, total: 0, noWebsite: 0, hot: 0, email: 0, emailMiss: 0, emailTodo: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };

// The sidebar is lazy: the store starts with the folders and one row of sums
// per folder (GET /api/sidebar, ~250 KB). The projects of a folder are fetched
// when it is opened. Loading all 240k projects up front was 19-65 MB of JSON
// and seconds of main-thread work on every visit.
interface GridState {
  folders: Record<string, Folder>;
  own: Record<string, FolderAggregate | null>; // per folder: sums over the projects directly in it
  missing: Record<string, number | null>;      // per folder: accurate coverage gap (server-computed)
  ungrouped: FolderAggregate;                  // sums over the projects in no folder
  all: FolderAggregate;                        // sums over every project
  facets: SidebarPayload['facets'];
  summaries: Record<string, ProjectSummary>;   // keyed by query — only the projects loaded so far
  folderState: Record<string, 'loading' | 'loaded' | 'error'>; // by folder id / ROOT_FOLDER
  hydrated: boolean;

  hydrate(): Promise<void>;
  refresh(): Promise<void>;
  loadFolder(id: string): Promise<void>;

  createFolder(name: string, parentId?: string | null): void;
  renameFolder(id: string, name: string): void;
  deleteFolder(id: string): void;
  setFolderCollapsed(id: string, collapsed: boolean): void;
  moveFolder(id: string, parentId: string | null): void;
  moveFolders(ids: string[], parentId: string | null): void;
  setFolderIcon(id: string, icon: string): void;
  setFoldersIcon(ids: string[], icon: string): void;
  reorderFolders(ids: string[]): void;

  renameProject(query: string, name: string): void;
  deleteProject(query: string): void;
  renameProjects(queries: string[], name: string): void;
  deleteProjects(queries: string[]): void;
  moveProjects(queries: string[], folderId: string | null): void;

  importMerge(data: ExportBundle): Promise<void>;
}

const swallow = () => {};

// the store fields a sidebar payload fills
function fromSidebar(sb: SidebarPayload) {
  const folders: Record<string, Folder> = {};
  const own: Record<string, FolderAggregate | null> = {};
  const missing: Record<string, number | null> = {};
  for (const { own: o, missing: m, ...f } of sb.folders) { folders[f.id] = f; own[f.id] = o; missing[f.id] = m; }
  return { folders, own, missing, ungrouped: sb.ungrouped || EMPTY_AGG, all: sb.all || EMPTY_AGG, facets: sb.facets || { types: [], regions: [], countries: [] } };
}

// does a loaded project belong to the list of this folder key?
function inFolder(p: ProjectSummary, id: string, folders: Record<string, Folder>) {
  return id === ROOT_FOLDER ? !(p.folderId && folders[p.folderId]) : p.folderId === id;
}

export const useGrid = create<GridState>()((set, get) => ({
  folders: {},
  own: {},
  missing: {},
  ungrouped: EMPTY_AGG,
  all: EMPTY_AGG,
  facets: { types: [], regions: [], countries: [] },
  summaries: {},
  folderState: {},
  hydrated: false,

  // Stale-while-revalidate: show what the browser already has in its HTTP cache
  // (no network, so the sidebar appears at once), then revalidate. When the
  // ETags match, the content is the same and the store is left alone.
  hydrate: async () => {
    const cached = await api.getSidebarFrom('force-cache');
    set({ ...fromSidebar(cached.data), hydrated: true });
    const fresh = await api.getSidebarFrom('no-cache');
    if (!fresh.etag || fresh.etag !== cached.etag) set(fromSidebar(fresh.data));
  },
  // After an edit and on the Refresh button: take the server's sidebar and
  // reload every folder that is open in the store, so local optimistic state
  // gives way to what the server has.
  refresh: async () => {
    const sb = fromSidebar((await api.getSidebarFrom('no-cache')).data);
    const ids = Object.keys(get().folderState).filter((id) => get().folderState[id] === 'loaded' && (id === ROOT_FOLDER || sb.folders[id]));
    const lists = await Promise.all(ids.map((id) => api.getFolderProjects(id).catch(() => null)));
    const summaries: Record<string, ProjectSummary> = {};
    const folderState: GridState['folderState'] = {};
    lists.forEach((list, i) => {
      if (!list) return; // failed: leave it unloaded, opening the folder asks again
      folderState[ids[i]] = 'loaded';
      for (const p of list) summaries[p.query] = p;
    });
    set({ ...sb, summaries, folderState });
  },
  // Fetch the projects of one folder once. A failure is remembered as 'error'
  // so the sidebar does not ask again on every render; Refresh clears it.
  loadFolder: async (id) => {
    if (get().folderState[id]) return;
    set((s) => ({ folderState: { ...s.folderState, [id]: 'loading' } }));
    try {
      const list = await api.getFolderProjects(id);
      set((s) => {
        const summaries: Record<string, ProjectSummary> = {};
        for (const q of Object.keys(s.summaries)) if (!inFolder(s.summaries[q], id, s.folders)) summaries[q] = s.summaries[q];
        for (const p of list) summaries[p.query] = p;
        return { summaries, folderState: { ...s.folderState, [id]: 'loaded' } };
      });
    } catch {
      set((s) => ({ folderState: { ...s.folderState, [id]: 'error' } }));
    }
  },

  createFolder: (name, parentId = null) => {
    const id = newId('f_'); const createdAt = new Date().toISOString();
    set((s) => ({ folders: { ...s.folders, [id]: { id, name: name.trim() || 'New folder', createdAt, collapsed: true, parentId: parentId || null } } }));
    api.createFolder(id, name.trim() || 'New folder', createdAt, parentId || null).catch(swallow);
  },
  renameFolder: (id, name) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, name } } } : {}; });
    api.renameFolder(id, name).catch(swallow);
  },
  deleteFolder: (id) => {
    set((s) => {
      const folders = { ...s.folders };
      const newParent = folders[id]?.parentId || null;
      delete folders[id];
      // sub-folders move up to the deleted folder's parent
      for (const fid of Object.keys(folders)) if (folders[fid].parentId === id) folders[fid] = { ...folders[fid], parentId: newParent };
      const summaries = { ...s.summaries };
      for (const q of Object.keys(summaries)) if (summaries[q].folderId === id) summaries[q] = { ...summaries[q], folderId: null };
      return { folders, summaries };
    });
    // its projects became ungrouped and the per-folder sums changed: reconcile
    api.deleteFolder(id).then(() => get().refresh()).catch(swallow);
  },
  setFolderCollapsed: (id, collapsed) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, collapsed } } } : {}; });
    api.setFolderCollapsed(id, collapsed).catch(swallow);
  },
  moveFolder: (id, parentId) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, parentId: parentId || null } } } : {}; });
    api.moveFolder(id, parentId).catch(swallow);
  },
  moveFolders: (ids, parentId) => {
    set((s) => { const folders = { ...s.folders }; for (const id of ids) if (folders[id]) folders[id] = { ...folders[id], parentId: parentId || null }; return { folders }; });
    api.moveFolders(ids, parentId).catch(swallow);
  },
  setFolderIcon: (id, icon) => {
    set((s) => { const f = s.folders[id]; return f ? { folders: { ...s.folders, [id]: { ...f, icon } } } : {}; });
    api.setFolderIcon(id, icon).catch(swallow);
  },
  setFoldersIcon: (ids, icon) => {
    set((s) => { const folders = { ...s.folders }; for (const id of ids) if (folders[id]) folders[id] = { ...folders[id], icon }; return { folders }; });
    api.setFoldersIcon(ids, icon).catch(swallow);
  },

  reorderFolders: (ids) => {
    set((s) => {
      const folders = { ...s.folders };
      ids.forEach((id, i) => { if (folders[id]) folders[id] = { ...folders[id], order: i }; });
      return { folders };
    });
    api.reorderFolders(ids).catch(swallow);
  },

  renameProject: (query, name) => {
    set((s) => { const p = s.summaries[query]; return p ? { summaries: { ...s.summaries, [query]: { ...p, name } } } : {}; });
    api.renameProject(query, name).catch(swallow);
  },
  deleteProject: (query) => {
    set((s) => { const summaries = { ...s.summaries }; delete summaries[query]; return { summaries }; });
    api.deleteProjects([query]).then(() => get().refresh()).catch(swallow); // the folder sums changed
  },
  renameProjects: (queries, name) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) if (summaries[q]) summaries[q] = { ...summaries[q], name }; return { summaries }; });
    api.renameProjects(queries, name).catch(swallow);
  },
  deleteProjects: (queries) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) delete summaries[q]; return { summaries }; });
    api.deleteProjects(queries).then(() => get().refresh()).catch(swallow); // the folder sums changed
  },
  moveProjects: (queries, folderId) => {
    set((s) => { const summaries = { ...s.summaries }; for (const q of queries) if (summaries[q]) summaries[q] = { ...summaries[q], folderId: folderId || null }; return { summaries }; });
    // The moved projects may not all be loaded here (picked from a search), and
    // both folders' sums changed: reconcile lists and sums with the server.
    api.moveProjects(queries, folderId).then(() => get().refresh()).catch(swallow);
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
