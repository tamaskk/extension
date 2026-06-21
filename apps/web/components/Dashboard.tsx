'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGrid, downloadJson, downloadText, exportCsv, bundleToRows } from '@/lib/store';
import { api } from '@/lib/api';
import { type LeadRow, type ProjectSummary, type WebsiteStatus, SALES_STATUSES, SALES_COLOR, SALES_NEEDS_DATE } from '@/lib/types';
import { googleCalendarUrl } from '@/lib/gcal';
import DuplicatesModal from './DuplicatesModal';
import ImportModal from './ImportModal';
import MapModal from './MapModal';
import FolderInfoModal from './FolderInfoModal';
import CategoryFilter from './CategoryFilter';
import LeadDetailModal from './LeadDetailModal';
import IconPicker from './IconPicker';

// folder names look like "<City...> Restaurants" — drop the last word for the city
const cityFromFolderName = (name: string) => { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? p.slice(0, -1).join(' ') : (name || ''); };
import TagsCell from './TagsCell';

type SortType = 'has' | 'str' | 'num' | 'temp';
const SORTABLE: Record<string, SortType> = {
  checked: 'has', name: 'str', category: 'str', rating: 'num', reviewCount: 'num',
  phone: 'has', email: 'has', websiteStatus: 'str',
  opportunityScore: 'num', leadScore: 'num', leadTemperature: 'temp', address: 'str',
};
const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : 1);
const byOrder = (a: { order?: number; createdAt: string }, b: { order?: number; createdAt: string }) => ((a.order ?? 0) - (b.order ?? 0)) || (a.createdAt < b.createdAt ? -1 : 1);
const PAGE_SIZES = [10, 20, 50, 100, 200, 500, 1000];

const STATUS_MAP: Record<string, [string, string]> = {
  HAS_WEBSITE: ['green', 'Has site'], NO_WEBSITE: ['red', 'No website'],
  FACEBOOK_ONLY: ['blue', 'Facebook only'], INSTAGRAM_ONLY: ['pink', 'Instagram only'],
  BROKEN: ['amber', 'Broken'], DOMAIN_EXPIRED: ['amber', 'Expired'],
  DOMAIN_PARKED: ['amber', 'Parked'], UNDER_CONSTRUCTION: ['amber', 'Under constr.'],
  NOT_WORKING: ['amber', 'Not working'], REDIRECTS: ['amber', 'Redirects'],
};
function StatusChip({ s }: { s: WebsiteStatus }) {
  const [cls, label] = STATUS_MAP[s] || ['gray', s || '—'];
  return <span className={`chip ${cls}`}>{label}</span>;
}

const STATUS_OPTIONS = Object.keys(STATUS_MAP) as WebsiteStatus[];
// editable website-status chip (a select styled like the chip)
function StatusSelect({ value, onChange }: { value: WebsiteStatus; onChange: (s: WebsiteStatus) => void }) {
  const [cls] = STATUS_MAP[value] || ['gray'];
  return (
    <select className={`status-sel chip ${cls}`} value={value || 'NO_WEBSITE'} title="Click to change status"
      onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value as WebsiteStatus)}>
      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_MAP[s][1]}</option>)}
    </select>
  );
}
// editable sales-pipeline status: a colored chip-select (empty = no status yet)
function SalesSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const color = SALES_COLOR[value] || '';
  return (
    <select className={`sales-sel ${value ? 'set' : ''}`} value={value || ''} title="Set sales status"
      style={value ? { background: color, color: '#fff', borderColor: color } : undefined}
      onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Status</option>
      {SALES_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
// editable opportunity score: progress bar + a number input you can type into
function OppEdit({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { const n = parseInt(v, 10); if (!isNaN(n) && n !== value) onCommit(n); else setV(String(value)); };
  return (
    <div className="opp">
      <div className="track"><div className="fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
      <input className="opp-input" type="number" min={0} max={100} value={v}
        onClick={(e) => e.stopPropagation()} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

const DROPDOWN_SORT: Record<string, [string, number]> = {
  opportunity_desc: ['opportunityScore', -1], score_desc: ['leadScore', -1],
  rating_desc: ['rating', -1], rating_asc: ['rating', 1],
  reviews_desc: ['reviewCount', -1], name_asc: ['name', 1],
};
// All reorderable columns (the far-left select-all checkbox stays fixed).
const ALL_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'checked', label: 'Checked', sortable: true }, { key: 'name', label: 'Business', sortable: true },
  { key: 'category', label: 'Category', sortable: true }, { key: 'rating', label: '★', sortable: true },
  { key: 'reviewCount', label: 'Reviews', sortable: true }, { key: 'phone', label: 'Phone', sortable: true },
  { key: 'email', label: 'Email', sortable: true }, { key: 'websiteStatus', label: 'Website', sortable: true },
  { key: 'opportunityScore', label: 'Opportunity', sortable: true }, { key: 'leadTemperature', label: 'Temp', sortable: true },
  { key: 'address', label: 'Location', sortable: true }, { key: 'tags', label: 'Tags', sortable: false },
  { key: 'salesStatus', label: 'Status', sortable: true }, { key: 'maps', label: 'Maps', sortable: false },
];
const COL_BY_KEY: Record<string, { key: string; label: string; sortable: boolean }> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c]));
const DEFAULT_COLS = ALL_COLUMNS.map((c) => c.key);
const COLS_LS = 'gridleads_cols';

export default function Dashboard() {
  const folders = useGrid((s) => s.folders);
  const summaries = useGrid((s) => s.summaries);
  const hydrated = useGrid((s) => s.hydrated);
  const actions = useGrid((s) => s);

  const [mounted, setMounted] = useState(false);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'nowebsite' | 'haswebsite' | 'hot' | 'email'>('all');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [sortKey, setSortKey] = useState('opportunityScore');
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set());
  const [sideFilter, setSideFilter] = useState('');
  const [rowSel, setRowSel] = useState<Set<string>>(new Set());
  const [sidebarW, setSidebarW] = useState(264);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [infoFolder, setInfoFolder] = useState<{ name: string; cities: string[]; names: string[]; folderCount: number; projectCount: number } | null>(null);
  const [detailRow, setDetailRow] = useState<LeadRow | null>(null);
  const [recalc, setRecalc] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageRows, setPageRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tagReg, setTagReg] = useState<Record<string, string>>({}); // tag name → color
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_COLS);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const lastChecked = useRef<string | null>(null);
  const lastCheckedFolder = useRef<string | null>(null);
  const dragColKey = useRef<string | null>(null);
  const dragFolderId = useRef<string | null>(null);
  const dragFolderIds = useRef<string[] | null>(null); // multi-folder drag payload
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const saved = parseInt(localStorage.getItem('gridleads_sw') || '', 10);
    if (saved >= 200 && saved <= 560) setSidebarW(saved);
    // restore saved column order, dropping unknown keys and appending any new ones
    try {
      const arr = JSON.parse(localStorage.getItem(COLS_LS) || 'null');
      if (Array.isArray(arr)) {
        const filtered = arr.filter((k: string) => COL_BY_KEY[k]);
        setColumnOrder([...filtered, ...DEFAULT_COLS.filter((k) => !filtered.includes(k))]);
      }
    } catch { /* keep default */ }
    useGrid.getState().hydrate().catch(() => {});
    api.getTags().then((r) => { const m: Record<string, string> = {}; (r.tags || []).forEach((t) => { m[t.name] = t.color; }); setTagReg(m); }).catch(() => {});
  }, []);

  const orderedColumns = useMemo(() => columnOrder.map((k) => COL_BY_KEY[k]).filter(Boolean), [columnOrder]);
  const dropColumn = (targetKey: string) => {
    const from = dragColKey.current; dragColKey.current = null; setDragOverCol(null);
    if (!from || from === targetKey) return;
    setColumnOrder((prev) => {
      const ids = prev.slice();
      const fi = ids.indexOf(from), ti = ids.indexOf(targetKey);
      if (fi < 0 || ti < 0) return prev;
      ids.splice(fi, 1);
      const nti = ids.indexOf(targetKey);
      ids.splice(fi < ti ? nti + 1 : nti, 0, from);
      localStorage.setItem(COLS_LS, JSON.stringify(ids));
      return ids;
    });
  };
  const resetColumns = () => { setColumnOrder(DEFAULT_COLS); localStorage.removeItem(COLS_LS); };

  const tagNames = useMemo(() => Object.keys(tagReg).sort((a, b) => a.localeCompare(b)), [tagReg]);
  const createTag = useCallback((name: string, color: string) => {
    setTagReg((m) => ({ ...m, [name]: color }));
    api.createTag(name, color).catch(() => {});
  }, []);
  const setRowTags = useCallback((r: LeadRow, tags: string[]) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, tags } : x)));
    api.setTags(r._project, r._key, tags).catch(() => {});
  }, []);
  const addRowTag = useCallback((r: LeadRow, name: string) => { const cur = r.tags || []; if (!cur.includes(name)) setRowTags(r, [...cur, name]); }, [setRowTags]);
  const removeRowTag = useCallback((r: LeadRow, name: string) => setRowTags(r, (r.tags || []).filter((t) => t !== name)), [setRowTags]);

  // debounce the search box
  useEffect(() => { const t = setTimeout(() => setDebTerm(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  // any change that affects the result set goes back to page 1
  useEffect(() => { setPage(1); }, [activeProject, activeFolder, filter, debTerm, sortKey, sortDir, pageSize, selectedCats]);
  // category options are scope-specific, so reset the picks when the scope changes
  useEffect(() => { setSelectedCats([]); }, [activeProject, activeFolder]);

  const catsKey = selectedCats.join('');
  // ----- server-side page fetch -----
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setLoading(true);
    api.getLeads({ project: activeProject, folder: activeFolder, filter, search: debTerm, categories: selectedCats, sort: sortKey, dir: sortDir, page, pageSize })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows || []).map((r: any) => ({ ...r, _project: r.project, _key: r.dedupKey })) as LeadRow[];
        setPageRows(rows);
        setTotal(res.total || 0);
      })
      .catch(() => { if (!cancelled) { setPageRows([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeProject, activeFolder, filter, debTerm, catsKey, sortKey, sortDir, page, pageSize, reloadKey]);

  const summariesArr = useMemo(() => Object.values(summaries), [summaries]);
  const folderList = useMemo(() => Object.values(folders), [folders]);

  // ----- sidebar tree (folders can nest inside folders) -----
  const tree = useMemo(() => {
    const exists: Record<string, boolean> = {};
    folderList.forEach((f) => { exists[f.id] = true; });
    // folders grouped by parent
    const childrenOf: Record<string, typeof folderList> = {};
    const roots: typeof folderList = [];
    folderList.slice().sort(byOrder).forEach((f) => {
      const pid = f.parentId && exists[f.parentId] ? f.parentId : '';
      if (pid) (childrenOf[pid] = childrenOf[pid] || []).push(f);
      else roots.push(f);
    });
    // projects grouped by folder
    const projsOf: Record<string, ProjectSummary[]> = {};
    const ungrouped: ProjectSummary[] = [];
    summariesArr.forEach((p) => {
      if (p.folderId && exists[p.folderId]) (projsOf[p.folderId] = projsOf[p.folderId] || []).push(p);
      else ungrouped.push(p);
    });
    Object.keys(projsOf).forEach((k) => projsOf[k].sort(byCreated));
    ungrouped.sort(byCreated);
    // recursive total (a folder's own projects + every descendant folder's)
    const totalOf: Record<string, number> = {};
    const computeTotal = (f: typeof folderList[number]): number => {
      let t = (projsOf[f.id] || []).reduce((s, p) => s + p.total, 0);
      for (const c of (childrenOf[f.id] || [])) t += computeTotal(c);
      totalOf[f.id] = t; return t;
    };
    roots.forEach(computeTotal);
    // descendant ids per folder (for stats scope)
    const descOf: Record<string, Set<string>> = {};
    const computeDesc = (f: typeof folderList[number]): Set<string> => {
      const set = new Set<string>([f.id]);
      for (const c of (childrenOf[f.id] || [])) computeDesc(c).forEach((id) => set.add(id));
      descOf[f.id] = set; return set;
    };
    roots.forEach(computeDesc);
    // per-folder counts of nested sub-folders and projects (for the sidebar badges)
    const folderCountOf: Record<string, number> = {};
    const projCountOf: Record<string, number> = {};
    for (const id of Object.keys(descOf)) {
      const set = descOf[id];
      folderCountOf[id] = set.size - 1; // descendants, excluding self
      let pc = 0; set.forEach((did) => { pc += (projsOf[did] || []).length; });
      projCountOf[id] = pc;
    }
    // visible project order (respects collapse) — for shift-click range select
    const order: string[] = [];
    const walk = (f: typeof folderList[number]) => {
      if (f.collapsed) return;
      (childrenOf[f.id] || []).forEach(walk);
      (projsOf[f.id] || []).forEach((p) => order.push(p.query));
    };
    roots.forEach(walk);
    ungrouped.forEach((p) => order.push(p.query));
    // flat list with depth (for the "Move to…" dropdown)
    const flat: { f: typeof folderList[number]; depth: number }[] = [];
    const flatten = (f: typeof folderList[number], depth: number) => { flat.push({ f, depth }); (childrenOf[f.id] || []).forEach((c) => flatten(c, depth + 1)); };
    roots.forEach((f) => flatten(f, 0));
    return { childrenOf, roots, projsOf, ungrouped, totalOf, descOf, folderCountOf, projCountOf, order, flat };
  }, [summariesArr, folderList]);

  // ----- sidebar text filter (matches folder & project names; reveals matches) -----
  const sideQuery = sideFilter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sideQuery) return null;
    const showFolder = new Set<string>();
    const showProject = new Set<string>();
    const visit = (f: typeof folderList[number], ancestorMatched: boolean): boolean => {
      const nameMatch = f.name.toLowerCase().includes(sideQuery);
      const sub = ancestorMatched || nameMatch; // matched folder → show everything inside it
      let anyDesc = false;
      for (const c of (tree.childrenOf[f.id] || [])) if (visit(c, sub)) anyDesc = true;
      for (const p of (tree.projsOf[f.id] || [])) {
        if (sub || p.name.toLowerCase().includes(sideQuery) || p.query.toLowerCase().includes(sideQuery)) { showProject.add(p.query); anyDesc = true; }
      }
      const shown = nameMatch || anyDesc || ancestorMatched;
      if (shown) showFolder.add(f.id);
      return shown;
    };
    tree.roots.forEach((f) => visit(f, false));
    tree.ungrouped.forEach((p) => { if (p.name.toLowerCase().includes(sideQuery) || p.query.toLowerCase().includes(sideQuery)) showProject.add(p.query); });
    // visible project order in RENDER order (folders force-expanded) — for shift-range select
    const order: string[] = [];
    const collect = (f: typeof folderList[number]) => {
      if (!showFolder.has(f.id)) return;
      (tree.childrenOf[f.id] || []).forEach(collect);
      (tree.projsOf[f.id] || []).forEach((p) => { if (showProject.has(p.query)) order.push(p.query); });
    };
    tree.roots.forEach(collect);
    tree.ungrouped.forEach((p) => { if (showProject.has(p.query)) order.push(p.query); });
    return { showFolder, showProject, order };
  }, [sideQuery, tree]);

  // ----- widgets (full scope, from summaries) -----
  const stats = useMemo(() => {
    const scope = activeFolder ? summariesArr.filter((p) => p.folderId && (tree.descOf[activeFolder]?.has(p.folderId) ?? p.folderId === activeFolder))
      : activeProject ? (summaries[activeProject] ? [summaries[activeProject]] : [])
      : summariesArr;
    const total = scope.reduce((s, p) => s + p.total, 0);
    const noweb = scope.reduce((s, p) => s + p.noWebsite, 0);
    const hot = scope.reduce((s, p) => s + p.hot, 0);
    const email = scope.reduce((s, p) => s + p.email, 0);
    const oppSum = scope.reduce((s, p) => s + (p.oppSum || 0), 0);
    return { total, noweb, hot, email, avg: total ? Math.round(oppSum / total) : 0 };
  }, [activeProject, activeFolder, summaries, summariesArr, tree]);

  const title = activeFolder ? `📁 ${folders[activeFolder]?.name || 'Folder'}`
    : activeProject === null ? 'All leads'
    : (summaries[activeProject]?.name || activeProject);
  const totalAll = summariesArr.reduce((s, p) => s + p.total, 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // ----- selection (sidebar projects) -----
  const toggleSelect = (q: string, checked: boolean, shift: boolean) => {
    const next = new Set(selected);
    const order = filtered ? filtered.order : tree.order; // shift-range over what's actually visible
    if (shift && lastChecked.current) {
      const a = order.indexOf(lastChecked.current);
      const b = order.indexOf(q);
      if (a !== -1 && b !== -1) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) { if (checked) next.add(order[i]); else next.delete(order[i]); } }
    } else if (checked) next.add(q); else next.delete(q);
    lastChecked.current = q;
    setSelected(next);
  };

  // ----- selection (sidebar folders) -----
  const folderOrder = useMemo(() => tree.flat.map((x) => x.f.id), [tree]);
  const toggleFolderSelect = (id: string, checked: boolean, shift: boolean) => {
    const next = new Set(selFolders);
    if (shift && lastCheckedFolder.current) {
      const a = folderOrder.indexOf(lastCheckedFolder.current);
      const b = folderOrder.indexOf(id);
      if (a !== -1 && b !== -1) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) { if (checked) next.add(folderOrder[i]); else next.delete(folderOrder[i]); } }
    } else if (checked) next.add(id); else next.delete(id);
    lastCheckedFolder.current = id;
    setSelFolders(next);
  };

  const clickHeader = (key: string) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(SORTABLE[key] === 'num' || SORTABLE[key] === 'temp' ? -1 : 1); }
  };

  // ----- resizable sidebar -----
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) setSidebarW(Math.max(200, Math.min(560, e.clientX))); };
    const up = () => { if (!dragging.current) return; dragging.current = false; document.body.classList.remove('resizing'); setSidebarW((w) => { localStorage.setItem('gridleads_sw', String(w)); return w; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  // ----- exports (server builds the bundle) -----
  const exportJsonScope = async (opts: { queries?: string[]; folderId?: string }, hint: string) => {
    const bundle = await api.exportBundle(opts); downloadJson(bundle, hint);
  };
  const exportCsvScope = async (opts: { queries?: string[]; folderId?: string }, hint: string) => {
    const bundle = await api.exportBundle(opts); downloadText(exportCsv(bundleToRows(bundle)), 'text/csv;charset=utf-8', hint, 'csv');
  };

  const moveSelected = (folderId: string | null) => { if (!selected.size) return; actions.moveProjects([...selected], folderId); setSelected(new Set()); };
  const setChecked = (r: LeadRow, checked: boolean) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, checked } : x)));
    api.setChecked(r._project, r._key, checked).catch(() => {});
  };
  const setRowStatus = (r: LeadRow, websiteStatus: WebsiteStatus) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, websiteStatus } : x)));
    api.setWebsiteStatus(r._project, r._key, websiteStatus).catch(() => {});
  };
  const setRowSales = (r: LeadRow, salesStatus: string) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, salesStatus } : x)));
    api.updateLeadField(r._project, r._key, 'salesStatus', salesStatus).catch(() => {});
  };
  const setRowSalesDate = (r: LeadRow, salesDate: string) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, salesDate } : x)));
    api.updateLeadField(r._project, r._key, 'salesDate', salesDate).catch(() => {});
  };
  const setRowOpportunity = (r: LeadRow, n: number) => {
    const v = Math.max(0, Math.min(100, Math.round(n || 0)));
    const leadTemperature = (v >= 70 ? 'HOT' : v >= 40 ? 'WARM' : 'COLD') as LeadRow['leadTemperature'];
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, opportunityScore: v, leadTemperature } : x)));
    api.setOpportunity(r._project, r._key, v).catch(() => {});
  };
  const refreshAll = () => { actions.refresh().catch(() => {}); setReloadKey((k) => k + 1); };

  // delete the rows ticked with the left-most (selection) checkbox
  const deleteSelectedRows = async () => {
    if (!rowSel.size) return;
    if (!confirm(`Delete ${rowSel.size} selected lead(s)? This removes them from the database.`)) return;
    const items = [...rowSel].map((id) => { const i = id.indexOf('|'); return { query: id.slice(0, i), key: id.slice(i + 1) }; });
    setPageRows((rows) => rows.filter((r) => !rowSel.has(`${r._project}|${r._key}`)));
    setRowSel(new Set());
    await api.deleteRecords(items).catch(() => {});
    actions.refresh().catch(() => {}); // refresh sidebar counts
    setReloadKey((k) => k + 1);        // refresh table total / page
  };

  // Recompute every lead's opportunity score with the new engine, chunk by chunk.
  const runRecalc = async () => {
    if (recalc?.running) return;
    if (!confirm('Recalculate the opportunity score for ALL leads with the new ranking system? This updates every stored business.')) return;
    setRecalc({ running: true, done: 0, total: 0 });
    let after: string | null = null, done = 0, total = 0;
    try {
      for (;;) {
        const res = await api.recalcScores(after);
        if (!res || !res.ok) throw new Error('recalc failed');
        done += res.processed;
        if (res.total != null) total = res.total;
        setRecalc({ running: true, done, total });
        if (res.done || !res.lastId) break;
        after = res.lastId;
      }
      setRecalc({ running: false, done, total });
      setReloadKey((k) => k + 1); // reload the table with new scores
      actions.refresh().catch(() => {});
      setTimeout(() => setRecalc(null), 4000);
    } catch {
      setRecalc({ running: false, done, total });
      setTimeout(() => setRecalc(null), 5000);
    }
  };

  // drag a folder ONTO another folder → nest it inside (or onto "All leads" → root)
  const isDescendant = (maybeChild: string, ancestor: string): boolean => {
    let cur = folders[maybeChild]; const guard = new Set<string>();
    while (cur && cur.parentId) {
      if (guard.has(cur.id)) break; guard.add(cur.id);
      if (cur.parentId === ancestor) return true;
      cur = folders[cur.parentId];
    }
    return false;
  };
  // valid targets for moving a set of folders into `targetId` (drops cycles / no-ops)
  const validMoveIds = (ids: string[], targetId: string | null) =>
    ids.filter((id) => id !== targetId
      && !(targetId && isDescendant(targetId, id)) // can't move into your own descendant
      && (folders[id]?.parentId || null) !== (targetId || null)); // not already there
  const nestFolder = (targetId: string | null) => {
    const ids = dragFolderIds.current || (dragFolderId.current ? [dragFolderId.current] : []);
    dragFolderId.current = null; dragFolderIds.current = null; setDragOverId(null);
    if (!ids.length) return;
    if (targetId && ids.includes(targetId)) return; // don't drop a group onto one of its own members
    const valid = validMoveIds(ids, targetId);
    if (!valid.length) return;
    actions.moveFolders(valid, targetId);
    if (targetId && folders[targetId]?.collapsed) actions.setFolderCollapsed(targetId, false); // reveal the drop
    setSelFolders(new Set());
  };
  const moveSelectedFolders = (targetId: string | null) => {
    const ids = [...selFolders];
    if (targetId && ids.includes(targetId)) return;
    const valid = validMoveIds(ids, targetId);
    if (valid.length) { actions.moveFolders(valid, targetId); if (targetId && folders[targetId]?.collapsed) actions.setFolderCollapsed(targetId, false); }
    setSelFolders(new Set());
  };
  // gather the cities present beneath a folder (from every descendant folder's name)
  const openFolderInfo = (f: typeof folderList[number]) => {
    const ids = tree.descOf[f.id] ? [...tree.descOf[f.id]] : [f.id];
    const childIds = ids.filter((id) => id !== f.id);
    const cities = childIds.map((id) => cityFromFolderName(folders[id]?.name || '')).filter(Boolean);
    // every folder + project name inside (so place detection works when the
    // children are projects like "plumbers near Abbeville city alamaba")
    const names: string[] = [];
    childIds.forEach((id) => { const n = folders[id]?.name; if (n) names.push(n); });
    ids.forEach((id) => (tree.projsOf[id] || []).forEach((p) => { if (p.name) names.push(p.name); if (p.query) names.push(p.query); }));
    const projectCount = ids.reduce((s, id) => s + (tree.projsOf[id]?.length || 0), 0);
    setInfoFolder({ name: f.name, cities, names, folderCount: childIds.length, projectCount });
  };
  const deleteSelectedFolders = () => {
    if (!confirm(`Delete ${selFolders.size} selected folder(s)? Sub-folders move up to their parent and projects go back to ungrouped (leads kept).`)) return;
    [...selFolders].forEach((id) => actions.deleteFolder(id));
    setSelFolders(new Set());
  };

  // render one body cell by column key (order-independent)
  const renderCell = (key: string, r: LeadRow) => {
    switch (key) {
      case 'checked': return <td key={key} className="cb"><input type="checkbox" className="rowcheck" checked={!!r.checked} onChange={(e) => setChecked(r, (e.target as HTMLInputElement).checked)} /></td>;
      case 'name': return <td key={key}><div className="bizcell"><span className="bizname" title={r.name}>{r.name}</span><span className="bizopen" title="Show all details" onClick={(e) => { e.stopPropagation(); setDetailRow(r); }}>↗</span></div></td>;
      case 'category': return <td key={key} className="muted">{r.category}</td>;
      case 'rating': return <td key={key}>{r.rating ?? '—'}</td>;
      case 'reviewCount': return <td key={key} className="muted">{r.reviewCount ?? '—'}</td>;
      case 'phone': return <td key={key}>{r.phone || <span className="muted">—</span>}</td>;
      case 'email': return <td key={key}>{r.email || <span className="muted">—</span>}</td>;
      case 'websiteStatus': return <td key={key}><div className="status-cell"><StatusSelect value={r.websiteStatus} onChange={(s) => setRowStatus(r, s)} />{r.website && <a className="mlink wlink" href={r.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={r.website}>↗</a>}</div></td>;
      case 'opportunityScore': return <td key={key}><OppEdit value={r.opportunityScore || 0} onCommit={(n) => setRowOpportunity(r, n)} /></td>;
      case 'leadTemperature': return <td key={key}><span className={`temp ${r.leadTemperature}`}>{r.leadTemperature || ''}</span></td>;
      case 'address': return <td key={key} className="muted loc" title={r.address || ''}>{r.address || ''}</td>;
      case 'tags': return <td key={key} className="tagstd"><TagsCell tags={r.tags || []} registry={tagReg} allNames={tagNames} onAdd={(name) => addRowTag(r, name)} onRemove={(name) => removeRowTag(r, name)} onCreate={createTag} /></td>;
      case 'salesStatus': return <td key={key}><div className="sales-cell"><SalesSelect value={r.salesStatus || ''} onChange={(s) => setRowSales(r, s)} />{SALES_NEEDS_DATE.has(r.salesStatus || '') && <input type="datetime-local" className="sales-date" value={r.salesDate || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setRowSalesDate(r, e.target.value)} />}{r.salesDate && SALES_NEEDS_DATE.has(r.salesStatus || '') && <a className="cal-btn" href={googleCalendarUrl({ title: `${r.salesStatus} — ${r.name}`, when: r.salesDate, location: r.address })} target="_blank" rel="noreferrer" title="Add to Google Calendar" onClick={(e) => e.stopPropagation()}>📅</a>}</div></td>;
      case 'maps': return <td key={key}>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">open ↗</a> : ''}</td>;
      default: return null;
    }
  };

  // ----- recursive sidebar render (nested folders) -----
  const renderProject = (p: ProjectSummary, depth: number) => (
    <div key={p.query} className={`navitem proj ${activeProject === p.query ? 'active' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => { setActiveProject(p.query); setActiveFolder(null); }}>
      <input type="checkbox" className="proj-check" checked={selected.has(p.query)} onChange={() => {}} onClick={(e) => { e.stopPropagation(); toggleSelect(p.query, !selected.has(p.query), e.shiftKey); }} />
      <span className="ni-name" title={p.name}>{p.name}</span>
      <span className="ni-right">
        <span className={`badge ${p.noWebsite ? 'accent' : ''}`}>{p.total}</span>
        <span className="edit" onClick={(e) => { e.stopPropagation(); const n = prompt('Rename project:', p.name); if (n && n.trim()) actions.renameProject(p.query, n.trim()); }}>✎</span>
        <span className="del" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete project "${p.query}" and all its leads?`)) { actions.deleteProject(p.query); setSelected((s) => { const n = new Set(s); n.delete(p.query); return n; }); if (activeProject === p.query) setActiveProject(null); setReloadKey((k) => k + 1); } }}>✕</span>
      </span>
    </div>
  );
  const renderFolder = (f: typeof folderList[number], depth: number): React.ReactNode => {
    if (filtered && !filtered.showFolder.has(f.id)) return null;
    const kids = (tree.childrenOf[f.id] || []).filter((c) => !filtered || filtered.showFolder.has(c.id));
    const projs = (tree.projsOf[f.id] || []).filter((p) => !filtered || filtered.showProject.has(p.query));
    const open = filtered ? true : !f.collapsed; // force-expand while filtering
    return (
      <div key={f.id}>
        <div
          className={`folder ${activeFolder === f.id ? 'active' : ''} ${selFolders.has(f.id) ? 'selected' : ''} ${dragOverId === f.id ? 'dragover' : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable
          onDragStart={(e) => { dragFolderId.current = f.id; dragFolderIds.current = (selFolders.has(f.id) && selFolders.size > 1) ? [...selFolders] : [f.id]; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== f.id) setDragOverId(f.id); }}
          onDragLeave={() => setDragOverId((cur) => (cur === f.id ? null : cur))}
          onDrop={(e) => { e.preventDefault(); nestFolder(f.id); }}
          onDragEnd={() => { dragFolderId.current = null; dragFolderIds.current = null; setDragOverId(null); }}
          onClick={() => { setActiveFolder(f.id); setActiveProject(null); }}
        >
          <input type="checkbox" className="folder-check" checked={selFolders.has(f.id)} onChange={() => {}} onClick={(e) => { e.stopPropagation(); toggleFolderSelect(f.id, !selFolders.has(f.id), e.shiftKey); }} />
          <span className="caret" onClick={(e) => { e.stopPropagation(); actions.setFolderCollapsed(f.id, !f.collapsed); }}>{(kids.length || projs.length) ? (open ? '▾' : '▸') : '·'}</span>
          <span className="fname" title={f.name}>{f.icon || '📁'} {f.name}</span>
          <span className="ni-right">
            <span className="badge">{tree.totalOf[f.id] ?? 0}</span>
            {(tree.folderCountOf[f.id] || 0) > 0 && <span className="cnt-badge gold" title={`${tree.folderCountOf[f.id]} sub-folder(s)`}>{tree.folderCountOf[f.id]}</span>}
            {(tree.projCountOf[f.id] || 0) > 0 && <span className="cnt-badge green" title={`${tree.projCountOf[f.id]} project(s)`}>{tree.projCountOf[f.id]}</span>}
            <IconPicker trigger={<span className="ficon" title="Change folder icon">🎨</span>} onPick={(ic) => actions.setFolderIcon(f.id, ic)} />
            <span className="finfo" title="City coverage — which cities are missing?" onClick={(e) => { e.stopPropagation(); openFolderInfo(f); }}>ⓘ</span>
            <span className="fadd" title="New sub-folder" onClick={(e) => { e.stopPropagation(); const n = prompt(`New folder inside "${f.name}":`); if (n && n.trim()) { actions.createFolder(n.trim(), f.id); if (f.collapsed) actions.setFolderCollapsed(f.id, false); } }}>＋</span>
            <span className="fexport" title="Export folder (JSON)" onClick={(e) => { e.stopPropagation(); exportJsonScope({ folderId: f.id }, f.name); }}>⤓</span>
            <span className="fedit" onClick={(e) => { e.stopPropagation(); const n = prompt('Rename folder:', f.name); if (n && n.trim()) actions.renameFolder(f.id, n.trim()); }}>✎</span>
            <span className="fdel" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this folder? Sub-folders move up to its parent and its projects go back to ungrouped (leads kept).')) actions.deleteFolder(f.id); }}>✕</span>
          </span>
        </div>
        {open && (
          <>
            {kids.map((c) => renderFolder(c, depth + 1))}
            {projs.map((p) => renderProject(p, depth + 1))}
          </>
        )}
      </div>
    );
  };

  if (!mounted) return null;
  if (!hydrated) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--muted)' }}>Loading from database…</div>;

  return (
    <div className="app" style={{ '--sw': `${sidebarW}px` } as React.CSSProperties}>
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">◧ GridLeads</div>
        <div className="side-h">
          <span>Projects <span className="side-count">{folderList.length} folder{folderList.length === 1 ? '' : 's'} · {summariesArr.length} project{summariesArr.length === 1 ? '' : 's'}</span></span>
          <span className="side-tools">
            <button className="mini" title="New folder" onClick={() => { const n = prompt('Folder name:'); if (n && n.trim()) actions.createFolder(n.trim()); }}>＋</button>
            <button className="mini" title="Import JSON" onClick={() => setImportOpen(true)}>⤴</button>
            <button className="mini" title="Export all (JSON)" onClick={() => exportJsonScope({}, 'all')}>⤓</button>
          </span>
        </div>

        <div className="side-filter-wrap">
          <input className="side-filter" type="search" placeholder="Filter folders & projects…" value={sideFilter} onChange={(e) => setSideFilter(e.target.value)} />
          {sideFilter && <span className="side-filter-x" title="Clear" onClick={() => setSideFilter('')}>✕</span>}
        </div>
        {filtered && filtered.showProject.size > 0 && (() => {
          const projs = [...filtered.showProject];
          const allSel = projs.every((q) => selected.has(q));
          return (
            <label className="side-selectall">
              <input type="checkbox" checked={allSel} onChange={() => setSelected((prev) => { const n = new Set(prev); if (allSel) projs.forEach((q) => n.delete(q)); else projs.forEach((q) => n.add(q)); return n; })} />
              Select all {projs.length} filtered project{projs.length === 1 ? '' : 's'}
            </label>
          );
        })()}

        {selected.size > 0 && (
          <div className="bulkbar">
            <div className="bulk-row"><b>{selected.size}</b>&nbsp;selected <span className="bulk-clear" onClick={() => setSelected(new Set())}>clear</span></div>
            <div className="bulk-row">
              <select className="bulk-select" value="" onChange={(e) => { const v = e.target.value; if (v) moveSelected(v === '__root__' ? null : v); }}>
                <option value="">Move to…</option>
                <option value="__root__">↥ Ungrouped (root)</option>
                {tree.flat.map(({ f, depth }) => <option key={f.id} value={f.id}>{' '.repeat(depth * 2)}📁 {f.name}</option>)}
              </select>
            </div>
            <div className="bulk-row">
              <button className="mini" onClick={() => { const n = prompt(`Rename ${selected.size} selected project(s) to:`); if (n && n.trim()) { actions.renameProjects([...selected], n.trim()); setSelected(new Set()); } }}>Rename</button>
              <button className="mini" onClick={() => exportJsonScope({ queries: [...selected] }, `${selected.size}-projects`)}>Export</button>
              <button className="mini danger" onClick={() => { if (confirm(`Delete ${selected.size} selected project(s) and all their leads?`)) { actions.deleteProjects([...selected]); setSelected(new Set()); setReloadKey((k) => k + 1); } }}>Delete</button>
            </div>
          </div>
        )}

        {selFolders.size > 0 && (
          <div className="bulkbar">
            <div className="bulk-row"><b>{selFolders.size}</b>&nbsp;folder(s) selected <span className="bulk-clear" onClick={() => setSelFolders(new Set())}>clear</span></div>
            <div className="bulk-row">
              <select className="bulk-select" value="" onChange={(e) => { const v = e.target.value; if (v) moveSelectedFolders(v === '__root__' ? null : v); }}>
                <option value="">Move into…</option>
                <option value="__root__">↥ Top level (root)</option>
                {tree.flat.filter(({ f }) => !selFolders.has(f.id)).map(({ f, depth }) => <option key={f.id} value={f.id}>{' '.repeat(depth * 2)}📁 {f.name}</option>)}
              </select>
            </div>
            <div className="bulk-row">
              <IconPicker trigger={<button className="mini">🎨 Icon</button>} onPick={(ic) => { actions.setFoldersIcon([...selFolders], ic); }} />
              <span className="bulk-hint">drag to move all</span>
              <button className="mini danger" onClick={deleteSelectedFolders}>Delete</button>
            </div>
          </div>
        )}

        <nav className="nav">
          <div
            className={`navitem all ${activeProject === null && activeFolder === null ? 'active' : ''} ${dragOverId === '__root__' ? 'dragover' : ''}`}
            onClick={() => { setActiveProject(null); setActiveFolder(null); }}
            onDragOver={(e) => { if (!dragFolderId.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== '__root__') setDragOverId('__root__'); }}
            onDragLeave={() => setDragOverId((cur) => (cur === '__root__' ? null : cur))}
            onDrop={(e) => { e.preventDefault(); nestFolder(null); }}
            title="Drop a folder here to move it to the top level"
          >
            <span className="ni-name">All leads</span><span className="badge">{totalAll}</span>
          </div>
          {tree.roots.map((f) => renderFolder(f, 0))}
          {tree.ungrouped.filter((p) => !filtered || filtered.showProject.has(p.query)).map((p) => renderProject(p, 0))}
          {filtered && filtered.showFolder.size === 0 && filtered.showProject.size === 0 && (
            <div className="side-empty">No folders or projects match “{sideFilter.trim()}”.</div>
          )}
        </nav>

        <div className="side-foot">Each Google Maps search is saved as a project.</div>
        <div className="resizer" onMouseDown={(e) => { dragging.current = true; document.body.classList.add('resizing'); e.preventDefault(); }} />
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <input className="search" type="search" placeholder="Search businesses, category, city, phone…" value={term} onChange={(e) => setTerm(e.target.value)} />
          <select className="select" onChange={(e) => { const m = DROPDOWN_SORT[e.target.value]; if (m) { setSortKey(m[0]); setSortDir(m[1]); } }}>
            <option value="opportunity_desc">Sort: Opportunity ↓</option>
            <option value="score_desc">Lead score ↓</option>
            <option value="rating_desc">Highest rating</option>
            <option value="rating_asc">Lowest rating</option>
            <option value="reviews_desc">Most reviews</option>
            <option value="name_asc">Name A–Z</option>
          </select>
          <button className="btn" onClick={refreshAll}>⟳ Refresh</button>
          <button className="btn" onClick={runRecalc} disabled={!!recalc?.running} title="Recompute opportunity scores for all leads with the new ranking">
            {recalc?.running ? `⏳ ${recalc.total ? Math.round((recalc.done / recalc.total) * 100) : 0}%` : '★ Recalc scores'}
          </button>
          <button className="btn" onClick={() => setDupesOpen(true)}>⧉ Duplicates</button>
          <button className="btn" onClick={() => setMapOpen(true)}>🗺 Map</button>
          <button className="btn" onClick={() => exportJsonScope(activeProject ? { queries: [activeProject] } : {}, activeProject || 'all')}>⤓ Export JSON</button>
          <button className="btn primary" onClick={() => exportCsvScope(activeProject ? { queries: [activeProject] } : {}, activeProject || 'all')}>⤓ Export CSV</button>
        </header>

        <div className="filters">
          {([['all', 'All'], ['nowebsite', 'No website'], ['haswebsite', 'Has website'], ['hot', '🔥 Hot'], ['email', 'Email found']] as const).map(([key, label]) => (
            <button key={key} className={`chipbtn ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
          <CategoryFilter project={activeProject} folder={activeFolder} value={selectedCats} onChange={setSelectedCats} />
          {rowSel.size > 0 && (
            <span className="rowsel-bar">
              <b>{rowSel.size}</b>&nbsp;selected
              <button className="chipbtn danger" onClick={deleteSelectedRows}>🗑 Delete</button>
              <span className="rowsel-clear" onClick={() => setRowSel(new Set())}>clear</span>
            </span>
          )}
          <div className="spacer" />
          {recalc && (
            <span className="recalc-status">
              {recalc.running ? `Recalculating… ${recalc.done.toLocaleString()}${recalc.total ? ` / ${recalc.total.toLocaleString()}` : ''}` : `✓ Recalculated ${recalc.done.toLocaleString()} leads`}
            </span>
          )}
          {columnOrder.join() !== DEFAULT_COLS.join() && <button className="chipbtn reset-cols" title="Reset column order" onClick={resetColumns}>↺ Columns</button>}
          <span className="title">{title}</span>
        </div>

        <section className="widgets">
          <div className="widget"><div className="w-num">{stats.total}</div><div className="w-label">Total leads</div></div>
          <div className="widget"><div className="w-num accent">{stats.noweb}</div><div className="w-label">No website</div></div>
          <div className="widget"><div className="w-num hot">{stats.hot}</div><div className="w-label">Hot leads</div></div>
          <div className="widget"><div className="w-num">{stats.email}</div><div className="w-label">Emails found</div></div>
          <div className="widget"><div className="w-num">{stats.avg}</div><div className="w-label">Avg opportunity</div></div>
        </section>

        <section className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th className="cb"><input type="checkbox" onChange={(e) => setRowSel((e.target as HTMLInputElement).checked ? new Set(pageRows.map((r) => `${r._project}|${r._key}`)) : new Set())} /></th>
                {orderedColumns.map((c) => (
                  <th
                    key={c.key}
                    className={`col-h ${c.sortable ? 'sortable' : ''} ${sortKey === c.key ? 'active' : ''} ${dragColKey.current === c.key ? 'col-dragging' : ''} ${dragOverCol === c.key ? 'col-dragover' : ''}`}
                    draggable
                    onDragStart={(e) => { dragColKey.current = c.key; e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== c.key) setDragOverCol(c.key); }}
                    onDragLeave={() => setDragOverCol((cur) => (cur === c.key ? null : cur))}
                    onDrop={(e) => { e.preventDefault(); dropColumn(c.key); }}
                    onDragEnd={() => { dragColKey.current = null; setDragOverCol(null); }}
                    onClick={() => c.sortable && clickHeader(c.key)}
                    title="Drag to reorder"
                  >
                    <span className="col-grip">⋮⋮</span>{c.label}{c.sortable && sortKey === c.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const id = `${r._project}|${r._key}`;
                return (
                  <tr key={id} title={r.topPitch || undefined}>
                    <td className="cb"><input type="checkbox" className="selcheck" checked={rowSel.has(id)} onChange={(e) => setRowSel((s) => { const n = new Set(s); if ((e.target as HTMLInputElement).checked) n.add(id); else n.delete(id); return n; })} /></td>
                    {columnOrder.map((k) => renderCell(k, r))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && total === 0 && (
            <div className="empty">No leads here. Sync from the GridLeads extension, or use ⤴ Import to load a JSON export.</div>
          )}
        </section>

        <footer className="foot pager">
          <span>{loading ? 'Loading…' : `${total.toLocaleString()} leads`}</span>
          <div className="pager-ctrls">
            <label className="muted">Rows:&nbsp;
              <select className="pager-size" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="pgbtn" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
            <button className="pgbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span className="muted">Page {page} / {pageCount}</span>
            <button className="pgbtn" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next ›</button>
            <button className="pgbtn" disabled={page >= pageCount} onClick={() => setPage(pageCount)}>»</button>
          </div>
        </footer>
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}

      {infoFolder && <FolderInfoModal name={infoFolder.name} cities={infoFolder.cities} names={infoFolder.names} folderCount={infoFolder.folderCount} projectCount={infoFolder.projectCount} onClose={() => setInfoFolder(null)} />}

      {detailRow && (
        <LeadDetailModal
          row={detailRow}
          registry={tagReg}
          tagNames={tagNames}
          onCreateTag={createTag}
          onSaved={(field, value) => setPageRows((rows) => rows.map((x) => (x._project === detailRow._project && x._key === detailRow._key ? { ...x, [field]: value } : x)))}
          onClose={() => setDetailRow(null)}
        />
      )}

      {mapOpen && (
        <MapModal
          onClose={() => setMapOpen(false)}
          title={title}
          project={activeProject}
          folder={activeFolder}
          filter={filter}
          search={debTerm}
          categories={selectedCats}
        />
      )}

      {dupesOpen && (
        <DuplicatesModal
          onClose={() => setDupesOpen(false)}
          onGoto={(q) => { setActiveProject(q); setDupesOpen(false); }}
          onChanged={() => { actions.refresh().catch(() => {}); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
