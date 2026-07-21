'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGrid, downloadJson, downloadText, exportCsv, bundleToRows } from '@/lib/store';
import { api } from '@/lib/api';
import { type LeadRow, type ProjectSummary, type WebsiteStatus, SALES_STATUSES, SALES_COLOR, SALES_NEEDS_DATE } from '@/lib/types';
import { googleCalendarUrl } from '@/lib/gcal';
import { BIZ_TYPES } from '@/lib/bizTypes';
import { ALL_REGIONS, STATE_REGIONS } from '@/lib/regionNames';
import { COUNTRY_CITIES, COUNTRY_NAMES } from '@/lib/countries';
import { STATE_PLACE_COUNTS, CITY_AREA_COUNTS } from '@/lib/coverageCounts';
import DuplicatesModal from './DuplicatesModal';
import ImportModal from './ImportModal';
import MapModal from './MapModal';
import FolderInfoModal from './FolderInfoModal';
import CategoryFilter from './CategoryFilter';
import ComboFilter from './ComboFilter';
import LeadDetailModal from './LeadDetailModal';
import ReviewsModal from './ReviewsModal';
import IconPicker from './IconPicker';
import CallsModal from './CallsModal';
import StatsModal from './StatsModal';
import ReviewsView from './ReviewsView';
import OrganizeModal from './OrganizeModal';

// folder names look like "<City...> Restaurants" — drop the last word for the city
const cityFromFolderName = (name: string) => { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? p.slice(0, -1).join(' ') : (name || ''); };

// thousands separator with a dot: 520343 → "520.343"
const fmtNum = (n: number) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ── folder coverage helpers (shared by the cheap badge + the accurate match) ──
const covNorm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const COV_STATE_SET = new Set(STATE_REGIONS.map(covNorm));
const COV_STATE_KEY: Record<string, string> = {}; STATE_REGIONS.forEach((s) => { COV_STATE_KEY[covNorm(s)] = s; });
// States sorted longest-first so "West Virginia" wins over "Virginia".
const COV_STATE_DESC = [...STATE_REGIONS].map(covNorm).sort((a, b) => b.length - a.length);
// Extract the US state a folder name STARTS WITH ("Alabama Physical Therapy" →
// "alabama"). The old covRegionOf dropped only the last word, so any 2+ word
// business type ("Physical Therapy") broke state detection → the badge fell to
// the city branch and showed a wrong (>51) missing count.
const covStateOf = (name: string): string | null => {
  const n = covNorm(name);
  for (const sk of COV_STATE_DESC) if (n === sk || n.startsWith(sk + ' ')) return sk;
  return null;
};
const COV_CITY_SET = new Set<string>(); for (const c of COUNTRY_NAMES) for (const city of (COUNTRY_CITIES[c] || [])) COV_CITY_SET.add(covNorm(city));
const COV_COUNTRIES_DESC = [...COUNTRY_NAMES].sort((a, b) => b.length - a.length);
const covRegionOf = (name: string) => { const w = String(name || '').trim().split(/\s+/); return w.length > 1 ? w.slice(0, -1).join(' ') : (name || ''); };
const covCountryPrefix = (name: string) => { const n = covNorm(name); return COV_COUNTRIES_DESC.find((c) => n.startsWith(covNorm(c) + ' ')); };

// project query = "<business type> near <city...> <state/country>" → parse type + region
const MULTI_REGIONS = ['New York', 'New Jersey', 'New Mexico', 'New Hampshire', 'North Carolina', 'North Dakota', 'South Carolina', 'South Dakota', 'Rhode Island', 'West Virginia', 'District of Columbia', 'Hong Kong', 'Costa Rica', 'Puerto Rico', 'New Orleans'];
const MULTI_REGIONS_LC = MULTI_REGIONS.map((m) => m.toLowerCase());
function parseProject(q: string): { type: string; region: string } {
  const s = String(q || '').trim();
  if (!s) return { type: '', region: '' };
  const lc = s.toLowerCase();
  const ni = lc.indexOf(' near ');
  const type = ni >= 0 ? s.slice(0, ni + 5) : s.split(/\s+/).slice(0, 2).join(' ');
  let region = '';
  for (let i = 0; i < MULTI_REGIONS_LC.length; i++) { if (lc === MULTI_REGIONS_LC[i] || lc.endsWith(' ' + MULTI_REGIONS_LC[i])) { region = MULTI_REGIONS[i]; break; } }
  if (!region) { const w = s.split(/\s+/); region = w[w.length - 1]; }
  return { type: type.trim(), region: region.trim() };
}
import TagsCell from './TagsCell';

type SortType = 'has' | 'str' | 'num' | 'temp' | 'date';
const SORTABLE: Record<string, SortType> = {
  checked: 'has', name: 'str', category: 'str', rating: 'num', reviewCount: 'num',
  phone: 'has', email: 'has', websiteStatus: 'str',
  opportunityScore: 'num', leadScore: 'num', leadTemperature: 'temp', address: 'str',
  scrapedAt: 'date',
};
const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : 1);
// folders sort alphabetically by name (default), natural + case-insensitive
const byName = (a: { name?: string; createdAt: string }, b: { name?: string; createdAt: string }) =>
  (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }) || byCreated(a, b);
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
  date_desc: ['scrapedAt', -1], date_asc: ['scrapedAt', 1],
};
// All reorderable columns (the far-left select-all checkbox stays fixed).
const ALL_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'checked', label: 'Checked', sortable: true }, { key: 'name', label: 'Business', sortable: true },
  { key: 'category', label: 'Category', sortable: true }, { key: 'rating', label: '★', sortable: true },
  { key: 'reviewCount', label: 'Reviews', sortable: true }, { key: 'phone', label: 'Phone', sortable: true },
  { key: 'email', label: 'Email', sortable: true }, { key: 'websiteStatus', label: 'Website', sortable: true },
  { key: 'opportunityScore', label: 'Opportunity', sortable: true }, { key: 'leadTemperature', label: 'Temp', sortable: true },
  { key: 'address', label: 'Location', sortable: true }, { key: 'scrapedAt', label: 'Date', sortable: true },
  { key: 'tags', label: 'Tags', sortable: false },
  { key: 'salesStatus', label: 'Status', sortable: true }, { key: 'maps', label: 'Maps', sortable: false },
  { key: 'online', label: 'OP', sortable: false }, { key: 'call', label: 'Call', sortable: true },
];
const COL_BY_KEY: Record<string, { key: string; label: string; sortable: boolean }> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c]));
const DEFAULT_COLS = ALL_COLUMNS.map((c) => c.key);
const COLS_LS = 'gridleads_cols';
const HIDDEN_LS = 'gridleads_hidden_cols';

// dropdown to show/hide table columns
function ColumnsMenu({ order, hidden, onToggle, onAll, onReset }:
  { order: string[]; hidden: Set<string>; onToggle: (k: string) => void; onAll: (show: boolean) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const shown = order.filter((k) => !hidden.has(k)).length;
  return (
    <div className="colmenu" ref={ref}>
      <button className={`chipbtn ${hidden.size ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} title="Show / hide columns">⚙ Columns{hidden.size ? ` (${shown})` : ''}</button>
      {open && (
        <div className="colmenu-pop" onClick={(e) => e.stopPropagation()}>
          <div className="colmenu-bar"><span>Show columns</span><span className="colmenu-links"><button className="cf-link" onClick={() => onAll(true)}>All</button><button className="cf-link" onClick={() => onAll(false)}>None</button></span></div>
          <div className="colmenu-list">
            {order.map((k) => { const c = COL_BY_KEY[k]; if (!c) return null; return (
              <label key={k} className="colmenu-row">
                <input type="checkbox" checked={!hidden.has(k)} onChange={() => onToggle(k)} />
                <span>{c.label}</span>
              </label>
            ); })}
          </div>
          <button className="colmenu-reset" onClick={onReset}>↺ Reset order &amp; show all</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const folders = useGrid((s) => s.folders);
  const summaries = useGrid((s) => s.summaries);
  const hydrated = useGrid((s) => s.hydrated);
  const actions = useGrid((s) => s);

  const [mounted, setMounted] = useState(false);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'nowebsite' | 'haswebsite' | 'hot' | 'email' | 'hasreviews' | 'hasai'>('all');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selTypes, setSelTypes] = useState<string[]>([]);
  const [selRegions, setSelRegions] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [sortKey, setSortKey] = useState('opportunityScore');
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set());
  const [sideFilter, setSideFilter] = useState('');
  const [rowSel, setRowSel] = useState<Set<string>>(new Set());
  const [sidebarW, setSidebarW] = useState(264);
  const [covData, setCovData] = useState<{ places: Record<string, [string, number][]>; areas: Record<string, Record<string, string[]>> } | null>(null);
  const [panelW, setPanelW] = useState(440);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [dupesOpen, setDupesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [view, setView] = useState<'leads' | 'map' | 'stats' | 'reviews'>('leads');
  const [infoFolder, setInfoFolder] = useState<{ name: string; cities: string[]; names: string[]; regions: string[]; folderCount: number; projectCount: number } | null>(null);
  const [detailRow, setDetailRow] = useState<LeadRow | null>(null);
  const [reviewRow, setReviewRow] = useState<LeadRow | null>(null);
  const [reviewTab, setReviewTab] = useState<'info' | 'reviews' | 'emails'>('info');
  const [callsOpen, setCallsOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [callCount, setCallCount] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);
  const [recalc, setRecalc] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [recounting, setRecounting] = useState(false); // full rebuild of the cached per-project counters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageRows, setPageRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tagReg, setTagReg] = useState<Record<string, string>>({}); // tag name → color
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_COLS);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
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
    const savedPw = parseInt(localStorage.getItem('gridleads_pw') || '', 10);
    if (savedPw >= 320 && savedPw <= 760) setPanelW(savedPw);
    if (localStorage.getItem('gridleads_collapsed') === '1') setCollapsed(true);
    // restore saved column order, dropping unknown keys and appending any new ones
    try {
      const arr = JSON.parse(localStorage.getItem(COLS_LS) || 'null');
      if (Array.isArray(arr)) {
        const filtered = arr.filter((k: string) => COL_BY_KEY[k]);
        setColumnOrder([...filtered, ...DEFAULT_COLS.filter((k) => !filtered.includes(k))]);
      }
    } catch { /* keep default */ }
    try { const h = JSON.parse(localStorage.getItem(HIDDEN_LS) || 'null'); if (Array.isArray(h)) setHiddenCols(new Set(h.filter((k: string) => COL_BY_KEY[k]))); } catch { /* */ }
    useGrid.getState().hydrate().catch(() => {});
    api.getTags().then((r) => { const m: Record<string, string> = {}; (r.tags || []).forEach((t) => { m[t.name] = t.color; }); setTagReg(m); }).catch(() => {});
  }, []);

  const orderedColumns = useMemo(() => columnOrder.map((k) => COL_BY_KEY[k]).filter((c) => c && !hiddenCols.has(c.key)), [columnOrder, hiddenCols]);
  const visibleKeys = useMemo(() => columnOrder.filter((k) => !hiddenCols.has(k)), [columnOrder, hiddenCols]);
  const persistHidden = (next: Set<string>) => { setHiddenCols(next); localStorage.setItem(HIDDEN_LS, JSON.stringify([...next])); };
  const toggleColumn = (k: string) => { const n = new Set(hiddenCols); if (n.has(k)) n.delete(k); else n.add(k); persistHidden(n); };
  const setAllColumns = (show: boolean) => persistHidden(show ? new Set() : new Set(columnOrder));
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
  const resetColumns = () => { setColumnOrder(DEFAULT_COLS); localStorage.removeItem(COLS_LS); persistHidden(new Set()); };

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
  useEffect(() => { setPage(1); }, [activeProject, activeFolder, filter, debTerm, sortKey, sortDir, pageSize, selectedCats, selTypes, selRegions]);
  // category options are scope-specific, so reset the picks when the scope changes
  useEffect(() => { setSelectedCats([]); }, [activeProject, activeFolder]);
  const refreshCallCount = useCallback(() => {
    api.getCallCount().then((r) => setCallCount(r.total || 0)).catch(() => {});
    api.getCheckedCount().then((r) => setCheckedCount(r.total || 0)).catch(() => {});
  }, []);
  useEffect(() => { if (hydrated) refreshCallCount(); }, [hydrated, reloadKey, refreshCallCount]);
  // close the mobile drawer whenever a scope is picked
  useEffect(() => { setSidebarOpen(false); }, [activeProject, activeFolder]);
  const uncheckAllLeads = async () => {
    if (!checkedCount) return;
    if (!confirm(`Clear the Checked status on all ${checkedCount.toLocaleString()} checked lead(s)?`)) return;
    setPageRows((rows) => rows.map((x) => (x.checked ? { ...x, checked: false } : x)));
    setCheckedCount(0);
    await api.uncheckAll().catch(() => {});
    setReloadKey((k) => k + 1);
  };

  const catsKey = selectedCats.join('');
  // ----- server-side page fetch -----
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setLoading(true);
    api.getLeads({ project: activeProject, folder: activeFolder, filter, search: debTerm, categories: selectedCats, ptypes: selTypes, pregions: selRegions, sort: sortKey, dir: sortDir, page, pageSize })
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
  }, [hydrated, activeProject, activeFolder, filter, debTerm, catsKey, selTypes.join('|'), selRegions.join('|'), sortKey, sortDir, page, pageSize, reloadKey]);

  const summariesArr = useMemo(() => Object.values(summaries), [summaries]);
  const folderList = useMemo(() => Object.values(folders), [folders]);

  // parse every project into {type, region} for matching; dropdown options come
  // from the canonical batch lists (BIZ_TYPES + countries/state_json), merged with
  // anything actually present in the data so old/typo values stay selectable.
  const projFacets = useMemo(() => {
    const dataTypes = new Set<string>(); const dataRegions = new Set<string>();
    for (const p of summariesArr) { const r = parseProject(p.query); if (r.type) dataTypes.add(r.type); if (r.region) dataRegions.add(r.region); }
    const types = [...new Set([...BIZ_TYPES, ...dataTypes])].sort((a, b) => a.localeCompare(b));
    const regions = [...new Set([...ALL_REGIONS, ...dataRegions])].sort((a, b) => a.localeCompare(b));
    return { types, regions };
  }, [summariesArr]);
  const typeSel = selTypes[0] || '';
  const regionSel = selRegions[0] || '';

  // ----- sidebar tree (folders can nest inside folders) -----
  const tree = useMemo(() => {
    const exists: Record<string, boolean> = {};
    folderList.forEach((f) => { exists[f.id] = true; });
    // folders grouped by parent
    const childrenOf: Record<string, typeof folderList> = {};
    const roots: typeof folderList = [];
    folderList.slice().sort(byName).forEach((f) => {
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
    const zeroCountOf: Record<string, number> = {}; // projects with 0 leads (orange badge)
    for (const id of Object.keys(descOf)) {
      const set = descOf[id];
      folderCountOf[id] = set.size - 1; // descendants, excluding self
      let pc = 0, zc = 0;
      set.forEach((did) => (projsOf[did] || []).forEach((p) => { pc++; if (!p.total) zc++; }));
      projCountOf[id] = pc; zeroCountOf[id] = zc;
    }
    // coverage "missing" per folder (red badge) — CHEAP estimate (reference count −
    // present count). The accurate, modal-matching number replaces it once the full
    // reference lists are lazy-loaded (see `accurateMissing`).
    const missingOf: Record<string, number | null> = {};
    for (const f of folderList) {
      let miss: number | null = null;
      const cp = covCountryPrefix(f.name);
      if (cp) {
        const kids = childrenOf[f.id] || [];
        // State detection by prefix (robust to multi-word business types).
        const stateKids = kids.map((k) => covStateOf(k.name)).filter(Boolean) as string[];
        if (covNorm(cp) === 'usa' && stateKids.length > 0 && stateKids.length >= kids.length / 2) {
          miss = Math.max(0, STATE_REGIONS.length - new Set(stateKids).size); // missing US states (of 51)
        } else {
          const cities = COUNTRY_CITIES[cp] || [];
          const citySet = new Set(cities.map(covNorm));
          const kidRegions = kids.map((k) => covNorm(covRegionOf(k.name)));
          const present = new Set(kidRegions.filter((r) => citySet.has(r))).size;
          miss = Math.max(0, cities.length - present); // missing cities
        }
      } else {
        const reg = covStateOf(f.name) || covNorm(covRegionOf(f.name));
        if (COV_STATE_SET.has(reg) && STATE_PLACE_COUNTS[reg] != null) miss = Math.max(0, STATE_PLACE_COUNTS[reg] - (projCountOf[f.id] || 0));
        else if (COV_CITY_SET.has(reg) && CITY_AREA_COUNTS[reg] != null) miss = Math.max(0, CITY_AREA_COUNTS[reg] - (projCountOf[f.id] || 0));
      }
      missingOf[f.id] = miss;
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
    return { childrenOf, roots, projsOf, ungrouped, totalOf, descOf, folderCountOf, projCountOf, zeroCountOf, missingOf, order, flat };
  }, [summariesArr, folderList]);

  // lazy-load the full reference lists (states + country areas) once, so the red
  // "missing" badge can be computed the SAME way the coverage modal does.
  useEffect(() => {
    let cancelled = false;
    Promise.all([import('@/lib/states'), import('@/lib/countryAreas')])
      .then(([s, a]) => { if (!cancelled) setCovData({ places: s.STATE_PLACES, areas: a.COUNTRY_AREAS_BY_FILE }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // accurate per-folder "missing" for state/city folders — matches the coverage
  // modal exactly (token-in-haystack against the real reference list).
  const accurateMissing = useMemo(() => {
    const out: Record<string, number> = {};
    if (!covData) return out;
    const placesByNorm: Record<string, string[]> = {};
    for (const [st, arr] of Object.entries(covData.places)) placesByNorm[covNorm(st)] = arr.map((x) => x[0]);
    const areasByNorm: Record<string, string[]> = {};
    for (const file of Object.values(covData.areas)) for (const [city, arr] of Object.entries(file)) if (!areasByNorm[covNorm(city)]) areasByNorm[covNorm(city)] = arr;
    for (const f of folderList) {
      if (covCountryPrefix(f.name)) continue; // roots keep the cheap estimate
      const reg = covStateOf(f.name) || covNorm(covRegionOf(f.name)); // prefix state match (multi-word types)
      const refNames = (COV_STATE_SET.has(reg) && placesByNorm[reg]) ? placesByNorm[reg] : areasByNorm[reg];
      if (!refNames) continue;
      const ids = tree.descOf[f.id] || new Set([f.id]);
      let blob = '';
      ids.forEach((did) => {
        for (const p of (tree.projsOf[did] || [])) { if (p.name) blob += ' ' + covNorm(p.name) + ' '; if (p.query) blob += ' ' + covNorm(p.query) + ' '; }
        if (did !== f.id && folders[did]) blob += ' ' + covNorm(covRegionOf(folders[did].name)) + ' ';
      });
      let present = 0;
      for (const nm of refNames) { const p = ' ' + covNorm(nm) + ' '; if (p.length > 2 && blob.includes(p)) present++; }
      out[f.id] = Math.max(0, refNames.length - present);
    }
    return out;
  }, [covData, tree, folderList, folders]);

  // ----- sidebar filter: text + business-type + state/country (reveals matches) -----
  const sideQuery = sideFilter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sideQuery && !typeSel && !regionSel) return null;
    const showFolder = new Set<string>();
    const showProject = new Set<string>();
    const tl = typeSel.toLowerCase(); const rl = regionSel.toLowerCase();
    const facetOk = (q: string) => { if (!typeSel && !regionSel) return true; const lc = q.toLowerCase(); return (!typeSel || lc.startsWith(tl)) && (!regionSel || lc === rl || lc.endsWith(' ' + rl)); };
    const projOk = (p: ProjectSummary, textFromAncestor: boolean) => {
      const textOk = textFromAncestor || !sideQuery || p.name.toLowerCase().includes(sideQuery) || p.query.toLowerCase().includes(sideQuery);
      return textOk && facetOk(p.query);
    };
    const visit = (f: typeof folderList[number], ancestorMatched: boolean): boolean => {
      const nameMatch = !!sideQuery && f.name.toLowerCase().includes(sideQuery);
      const sub = ancestorMatched || nameMatch; // matched folder name → its projects pass the text test
      let anyDesc = false;
      for (const c of (tree.childrenOf[f.id] || [])) if (visit(c, sub)) anyDesc = true;
      for (const p of (tree.projsOf[f.id] || [])) if (projOk(p, sub)) { showProject.add(p.query); anyDesc = true; }
      if (anyDesc) showFolder.add(f.id);
      return anyDesc;
    };
    tree.roots.forEach((f) => visit(f, false));
    tree.ungrouped.forEach((p) => { if (projOk(p, false)) showProject.add(p.query); });
    const order: string[] = [];
    const collect = (f: typeof folderList[number]) => {
      if (!showFolder.has(f.id)) return;
      (tree.childrenOf[f.id] || []).forEach(collect);
      (tree.projsOf[f.id] || []).forEach((p) => { if (showProject.has(p.query)) order.push(p.query); });
    };
    tree.roots.forEach(collect);
    tree.ungrouped.forEach((p) => { if (showProject.has(p.query)) order.push(p.query); });
    return { showFolder, showProject, order };
  }, [sideQuery, typeSel, regionSel, tree, projFacets]);

  // ----- widgets (full scope, from summaries) -----
  const stats = useMemo(() => {
    const scope = activeFolder ? summariesArr.filter((p) => p.folderId && (tree.descOf[activeFolder]?.has(p.folderId) ?? p.folderId === activeFolder))
      : activeProject ? (summaries[activeProject] ? [summaries[activeProject]] : [])
      : summariesArr;
    const total = scope.reduce((s, p) => s + p.total, 0);
    const noweb = scope.reduce((s, p) => s + p.noWebsite, 0);
    const hot = scope.reduce((s, p) => s + p.hot, 0);
    const email = scope.reduce((s, p) => s + p.email, 0);
    const reviews = scope.reduce((s, p) => s + (p.reviews || 0), 0);
    const reviewsSum = scope.reduce((s, p) => s + (p.reviewsSum || 0), 0);
    const ai = scope.reduce((s, p) => s + (p.ai || 0), 0);
    const oppSum = scope.reduce((s, p) => s + (p.oppSum || 0), 0);
    return { total, noweb, hot, email, reviews, reviewsSum, ai, avg: total ? Math.round(oppSum / total) : 0 };
  }, [activeProject, activeFolder, summaries, summariesArr, tree]);
  const globalTotal = useMemo(() => summariesArr.reduce((s, p) => s + (p.total || 0), 0), [summariesArr]);
  const scopeName = activeFolder ? (folders[activeFolder]?.name || 'this folder') : activeProject ? (summaries[activeProject]?.name || activeProject) : '';

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
    else { setSortKey(key); setSortDir(SORTABLE[key] === 'num' || SORTABLE[key] === 'temp' || SORTABLE[key] === 'date' ? -1 : 1); }
  };

  // ----- resizable sidebar + right detail panel -----
  const dragging = useRef(false);
  const draggingPanel = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current) setSidebarW(Math.max(200, Math.min(560, e.clientX)));
      if (draggingPanel.current) setPanelW(Math.max(320, Math.min(760, window.innerWidth - e.clientX - 12)));
    };
    const up = () => {
      if (dragging.current) { dragging.current = false; document.body.classList.remove('resizing'); setSidebarW((w) => { localStorage.setItem('gridleads_sw', String(w)); return w; }); }
      if (draggingPanel.current) { draggingPanel.current = false; document.body.classList.remove('resizing'); setPanelW((w) => { localStorage.setItem('gridleads_pw', String(w)); return w; }); }
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const setCol = (v: boolean) => { setCollapsed(v); try { localStorage.setItem('gridleads_collapsed', v ? '1' : '0'); } catch { /* */ } };
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const on = () => setIsMobile(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // ----- exports (server builds the bundle) -----
  const exportJsonScope = async (opts: { queries?: string[]; folderId?: string }, hint: string) => {
    const bundle = await api.exportBundle(opts); downloadJson(bundle, hint);
  };

  const moveSelected = (folderId: string | null) => { if (!selected.size) return; actions.moveProjects([...selected], folderId); setSelected(new Set()); };
  const setChecked = (r: LeadRow, checked: boolean) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, checked } : x)));
    if (!!r.checked !== checked) setCheckedCount((c) => Math.max(0, c + (checked ? 1 : -1)));
    api.setChecked(r._project, r._key, checked).catch(() => {});
  };
  const setCall = (r: LeadRow, call: boolean) => {
    setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, call } : x)));
    setCallCount((c) => Math.max(0, c + (call ? 1 : -1)));
    api.setCall(r._project, r._key, call).catch(() => {});
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
  // Rebuild every cached per-project counter from the live leads collection.
  // Chunked: each request covers a slice of the project-key space (a full pass
  // exceeds the 60s serverless limit), looping until the server reports done.
  const fullRecount = async () => {
    let after: string | null | undefined; let at: string | undefined;
    for (;;) {
      const res = await api.refreshProjectStats({ after, at });
      if (!res?.ok) throw new Error(res?.error || 'recount failed');
      if (res.done) return;
      after = res.after; at = res.at;
    }
  };
  const runRecount = async () => {
    if (recounting) return;
    setRecounting(true);
    try { await fullRecount(); await actions.refresh(); setReloadKey((k) => k + 1); }
    catch { /* leave old numbers up */ }
    finally { setRecounting(false); }
  };

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
      fullRecount().then(() => actions.refresh()).catch(() => {}); // scores changed → recount cached counters
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
    // children are projects like "plumbers near Abbeville city Alabama")
    const names: string[] = [];
    // precise region set (project suffix + sub-folder name) — avoids matching a state
    // name that only appears as a CITY in another state's project (e.g. Washington, IN)
    const regions = new Set<string>();
    childIds.forEach((id) => { const n = folders[id]?.name; if (n) { names.push(n); const c = cityFromFolderName(n); if (c) regions.add(c); } });
    ids.forEach((id) => (tree.projsOf[id] || []).forEach((p) => { if (p.name) names.push(p.name); if (p.query) { names.push(p.query); const r = parseProject(p.query).region; if (r) regions.add(r); } }));
    const projectCount = ids.reduce((s, id) => s + (tree.projsOf[id]?.length || 0), 0);
    setInfoFolder({ name: f.name, cities, names, regions: [...regions], folderCount: childIds.length, projectCount });
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
      case 'name': return <td key={key}><div className="bizcell"><span className="bizname" title={r.name}>{r.name}</span>{!!(r.reviewsCount && r.reviewsCount > 0) && <span className="bizreviews" title={`Show ${r.reviewsCount} scraped review${r.reviewsCount === 1 ? '' : 's'}`} onClick={(e) => { e.stopPropagation(); setReviewTab('reviews'); setReviewRow(r); }}>💬 {r.reviewsCount}</span>}<span className="bizopen" title="Show all details" onClick={(e) => { e.stopPropagation(); setDetailRow(r); }}>↗</span></div></td>;
      case 'category': return <td key={key} className="muted">{r.category}</td>;
      case 'rating': return <td key={key}>{r.rating != null ? <span className="rate-cell"><span className="rate-star">★</span> {r.rating}</span> : <span className="muted">—</span>}</td>;
      case 'reviewCount': return <td key={key} className="muted">{r.reviewCount ?? '—'}</td>;
      case 'phone': return <td key={key}>{r.phone || <span className="muted">—</span>}</td>;
      case 'email': return <td key={key}>{r.email || <span className="muted">—</span>}</td>;
      case 'websiteStatus': return <td key={key}><div className="status-cell"><StatusSelect value={r.websiteStatus} onChange={(s) => setRowStatus(r, s)} />{r.website && <a className="mlink wlink" href={r.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={r.website}>↗</a>}</div></td>;
      case 'opportunityScore': return <td key={key}><OppEdit value={r.opportunityScore || 0} onCommit={(n) => setRowOpportunity(r, n)} /></td>;
      case 'leadTemperature': return <td key={key}><span className={`temp ${r.leadTemperature}`}>{r.leadTemperature || ''}</span></td>;
      case 'address': return <td key={key} className="muted loc" title={r.address || ''}>{r.address || ''}</td>;
      case 'scrapedAt': return <td key={key} className="muted" title={r.scrapedAt || ''}>{r.scrapedAt ? new Date(r.scrapedAt).toLocaleDateString() : '—'}</td>;
      case 'tags': return <td key={key} className="tagstd"><TagsCell tags={r.tags || []} registry={tagReg} allNames={tagNames} onAdd={(name) => addRowTag(r, name)} onRemove={(name) => removeRowTag(r, name)} onCreate={createTag} /></td>;
      case 'salesStatus': return <td key={key}><div className="sales-cell"><SalesSelect value={r.salesStatus || ''} onChange={(s) => setRowSales(r, s)} />{SALES_NEEDS_DATE.has(r.salesStatus || '') && <input type="datetime-local" className="sales-date" value={r.salesDate || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setRowSalesDate(r, e.target.value)} />}{r.salesDate && SALES_NEEDS_DATE.has(r.salesStatus || '') && <a className="cal-btn" href={googleCalendarUrl({ title: `${r.salesStatus} — ${r.name}`, when: r.salesDate, location: r.address })} target="_blank" rel="noreferrer" title="Add to Google Calendar" onClick={(e) => e.stopPropagation()}>📅</a>}</div></td>;
      case 'maps': return <td key={key}>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">open ↗</a> : ''}</td>;
      case 'online': return <td key={key}>{r.website ? <a className="mlink" href={r.website} target="_blank" rel="noreferrer" title={r.website} onClick={(e) => e.stopPropagation()}>open ↗</a> : ''}</td>;
      case 'call': return <td key={key} className="cb"><input type="checkbox" className="callcheck" checked={!!r.call} onChange={(e) => setCall(r, (e.target as HTMLInputElement).checked)} /></td>;
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
            {(() => { const m = accurateMissing[f.id] ?? tree.missingOf[f.id]; return (m || 0) > 0 ? <span className="cnt-badge red" title={`${m} missing (not yet scraped vs the full list)`}>{m}</span> : null; })()}
            {(tree.folderCountOf[f.id] || 0) > 0 && <span className="cnt-badge gold" title={`${tree.folderCountOf[f.id]} sub-folder(s)`}>{tree.folderCountOf[f.id]}</span>}
            {(tree.projCountOf[f.id] || 0) > 0 && <span className="cnt-badge green" title={`${tree.projCountOf[f.id]} project(s)`}>{tree.projCountOf[f.id]}</span>}
            {(tree.zeroCountOf[f.id] || 0) > 0 && <span className="cnt-badge orange" title={`${tree.zeroCountOf[f.id]} projekt 0 leaddel`}>{tree.zeroCountOf[f.id]}</span>}
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
  if (!hydrated) return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✦</span> GridLeads</div>
        <nav className="navrail">
          {[['🧾', 'Leads'], ['🗺️', 'Map'], ['📊', 'Stats'], ['💬', 'Reviews'], ['📞', 'Calls'], ['⧉', 'Duplicates'], ['🗂️', 'Organize']].map(([ic, label], i) => (
            <div className={`navrail-item ${i === 0 ? 'active' : ''}`} key={label}><span className="ic">{ic}</span> {label}</div>
          ))}
          <div className="navrail-sep" />
          <div className="navrail-item"><span className="ic">⤴</span> Import</div>
          <div className="navrail-item"><span className="ic">⤓</span> Export</div>
        </nav>
        <div className="side-h"><span>Projects</span></div>
        <div className="side-filter-wrap"><div className="skel-bar" style={{ height: 32 }} /></div>
        <div className="nav" style={{ gap: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="skel-bar" style={{ height: 30, width: `${68 + ((i * 11) % 30)}%` }} />)}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="skel-bar" style={{ flex: 1, height: 36 }} />
          <div className="skel-bar" style={{ width: 130, height: 36 }} />
          <div className="spacer" />
          <div className="skel-bar" style={{ width: 90, height: 36 }} />
          <div className="skel-bar" style={{ width: 90, height: 36 }} />
        </header>
        <div className="filters">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel-bar" style={{ width: 78, height: 28, borderRadius: 20 }} />)}
        </div>
        <section className="widgets">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="widget" key={i}><div className="skel-bar" style={{ height: 26, width: '55%' }} /><div className="skel-bar" style={{ height: 11, width: '40%', marginTop: 9 }} /></div>
          ))}
        </section>
        <section className="tablewrap">
          <div className="skel-bar" style={{ height: 40, borderRadius: '12px', marginBottom: 6 }} />
          {Array.from({ length: 14 }).map((_, i) => <div key={i} className="skel-bar" style={{ height: 42, marginBottom: 6, opacity: Math.max(0.25, 1 - i * 0.06) }} />)}
        </section>
      </main>
    </div>
  );

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} ${reviewRow ? 'with-panel' : ''}`} style={{ '--sw': `${collapsed && !isMobile ? 64 : sidebarW}px`, '--pw': `${panelW}px` } as React.CSSProperties}>
      <div className="side-backdrop" onClick={() => setSidebarOpen(false)} />

      {/* SIDEBAR — collapsed icon rail (desktop only) */}
      {collapsed && !isMobile && (
        <aside className="sidebar collapsed">
          <button className="brand-mark only" title="Expand sidebar" onClick={() => setCol(false)}>✦</button>
          <div className="crail">
            <button className={`crail-i ${view === 'leads' ? 'active' : ''}`} title="Leads" onClick={() => setView('leads')}>🧾</button>
            <button className={`crail-i ${view === 'map' ? 'active' : ''}`} title="Map" onClick={() => setView('map')}>🗺️</button>
            <button className={`crail-i ${view === 'stats' ? 'active' : ''}`} title="Stats" onClick={() => setView('stats')}>📊</button>
            <button className={`crail-i ${view === 'reviews' ? 'active' : ''}`} title="Reviews" onClick={() => setView('reviews')}>💬</button>
            <button className="crail-i" title="Calls" onClick={() => setCallsOpen(true)}>📞</button>
            <button className="crail-i" title="Duplicates" onClick={() => setDupesOpen(true)}>⧉</button>
            <button className="crail-i" title="Organize" onClick={() => setOrganizeOpen(true)}>🗂️</button>
            <div className="crail-sep" />
            {tree.roots.map((f) => (
              <button key={f.id} className={`crail-i ${activeFolder === f.id ? 'active' : ''}`} title={f.name} onClick={() => { setActiveProject(null); setActiveFolder(f.id); setView('leads'); }}>{f.icon || '📁'}</button>
            ))}
            {tree.ungrouped.length > 0 && (
              <button className="crail-chip" title={`${tree.ungrouped.length} project${tree.ungrouped.length === 1 ? '' : 's'} with no folder`} onClick={() => setCol(false)}>+{tree.ungrouped.length}</button>
            )}
          </div>
          <button className="crail-expand" title="Expand sidebar" onClick={() => setCol(false)}>»</button>
        </aside>
      )}

      {/* SIDEBAR — full (also used on mobile, where collapse is disabled) */}
      {(!collapsed || isMobile) && (
      <aside className="sidebar">
        <div className="sidebar-scroll">
        <div className="brand"><span className="brand-mark">✦</span> GridLeads <button className="side-collapse" title="Collapse sidebar" onClick={() => setCol(true)}>«</button></div>

        <nav className="navrail">
          <button className={`navrail-item ${view === 'leads' ? 'active' : ''}`} onClick={() => { setView('leads'); setSidebarOpen(false); }}><span className="ic">🧾</span> Leads</button>
          <button className={`navrail-item ${view === 'map' ? 'active' : ''}`} onClick={() => { setView('map'); setSidebarOpen(false); }}><span className="ic">🗺️</span> Map</button>
          <button className={`navrail-item ${view === 'stats' ? 'active' : ''}`} onClick={() => { setView('stats'); setSidebarOpen(false); }}><span className="ic">📊</span> Stats</button>
          <button className={`navrail-item ${view === 'reviews' ? 'active' : ''}`} onClick={() => { setView('reviews'); setSidebarOpen(false); }}><span className="ic">💬</span> Reviews</button>
          <button className="navrail-item" onClick={() => setCallsOpen(true)}><span className="ic">📞</span> Calls{callCount > 0 && <span className="nb">{callCount.toLocaleString()}</span>}</button>
          <button className="navrail-item" onClick={() => setDupesOpen(true)}><span className="ic">⧉</span> Duplicates</button>
          <button className="navrail-item" onClick={() => setOrganizeOpen(true)}><span className="ic">🗂️</span> Organize</button>
          <div className="navrail-sep" />
          <button className="navrail-item" onClick={() => setImportOpen(true)}><span className="ic">⤴</span> Import</button>
          <button className="navrail-item" onClick={() => exportJsonScope({}, 'all')}><span className="ic">⤓</span> Export</button>
          <div className="navrail-sep" />
          <button className="navrail-item" onClick={async () => { await fetch('/api/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/login'; }}><span className="ic">🚪</span> Log out</button>
        </nav>

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
        <div className="side-facets">
          <ComboFilter value={typeSel} options={projFacets.types} placeholder="All business types" onChange={(v) => setSelTypes(v ? [v] : [])} />
          <ComboFilter value={regionSel} options={projFacets.regions} placeholder="All states / countries" onChange={(v) => setSelRegions(v ? [v] : [])} />
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
        </div>
        <div className="resizer" onMouseDown={(e) => { dragging.current = true; document.body.classList.add('resizing'); e.preventDefault(); }} />
      </aside>
      )}

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <button className="hamburger" title="Projects" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
          <input className="search" type="search" placeholder="Search businesses, category, city, phone…" value={term} onChange={(e) => setTerm(e.target.value)} />
          <select className="select" onChange={(e) => { const m = DROPDOWN_SORT[e.target.value]; if (m) { setSortKey(m[0]); setSortDir(m[1]); } }}>
            <option value="opportunity_desc">Sort: Opportunity ↓</option>
            <option value="score_desc">Lead score ↓</option>
            <option value="rating_desc">Highest rating</option>
            <option value="rating_asc">Lowest rating</option>
            <option value="reviews_desc">Most reviews</option>
            <option value="name_asc">Name A–Z</option>
            <option value="date_desc">Date: newest first</option>
            <option value="date_asc">Date: oldest first</option>
          </select>
          <div className="spacer" />
          <button className="btn" onClick={refreshAll} title="Reload data">⟳ Refresh</button>
          <button className="btn" onClick={runRecount} disabled={recounting} title="Rebuild the cached project counters from the live leads (use if the numbers look stale)">{recounting ? '⏳ Counting…' : 'Σ Recount'}</button>
          <button className="btn" onClick={runRecalc} disabled={!!recalc?.running} title="Recompute opportunity scores for all leads with the new ranking">
            {recalc?.running ? `⏳ ${recalc.total ? Math.round((recalc.done / recalc.total) * 100) : 0}%` : '★ Recalc'}
          </button>
          {checkedCount > 0 && <button className="btn" onClick={uncheckAllLeads} title="Clear the Checked status on all checked leads">☐ Uncheck {checkedCount.toLocaleString()}</button>}
        </header>

        {view === 'map' && (
          <MapModal
            inline
            onClose={() => setView('leads')}
            onOpenCrm={(name) => { setView('leads'); setTerm(name); setActiveProject(null); setActiveFolder(null); }}
            title={title}
            project={activeProject}
            folder={activeFolder}
            filter={filter}
            search={debTerm}
            categories={selectedCats}
            ptypes={selTypes}
            pregions={selRegions}
          />
        )}

        {view === 'stats' && <StatsModal inline folders={folderList.slice().sort(byName)} onClose={() => setView('leads')} />}

        {view === 'reviews' && <ReviewsView />}

        {view === 'leads' && <>
        <div className="filters">
          <div className="filterchips">
            {([['all', 'All'], ['nowebsite', 'No website'], ['haswebsite', 'Has website'], ['hot', '🔥 Hot'], ['email', 'Email found'], ['hasreviews', '💬 Has reviews'], ['hasai', '✨ Has AI']] as const).map(([key, label]) => (
              <button key={key} className={`chipbtn ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
            ))}
            <CategoryFilter project={activeProject} folder={activeFolder} value={selectedCats} onChange={setSelectedCats} />
          </div>
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
          <ColumnsMenu order={columnOrder} hidden={hiddenCols} onToggle={toggleColumn} onAll={setAllColumns} onReset={resetColumns} />
          <span className="title">{title}</span>
        </div>

        {(activeFolder || activeProject) && (
          <div className="widgets-scope">
            Stats for <b>{scopeName}</b> — <button className="linkbtn" onClick={() => { setActiveFolder(null); setActiveProject(null); }}>show all {globalTotal.toLocaleString()} leads</button>
          </div>
        )}
        <section className="widgets">
          <div className="widget"><span className="w-ic blue">📋</span><div className="w-body"><div className="w-num">{fmtNum(stats.total)}</div><div className="w-label">{(activeFolder || activeProject) ? 'Leads in view' : 'Total leads'}</div></div></div>
          <div className="widget"><span className="w-ic rose">🚫</span><div className="w-body"><div className="w-num rose">{fmtNum(stats.noweb)}</div><div className="w-label">No website</div></div></div>
          <div className="widget"><span className="w-ic amber">🔥</span><div className="w-body"><div className="w-num amber">{fmtNum(stats.hot)}</div><div className="w-label">Hot leads</div></div></div>
          <div className="widget"><span className="w-ic green">💬</span><div className="w-body"><div className="w-num green">{fmtNum(stats.reviews)} <span className="w-sub">({fmtNum(stats.reviewsSum)})</span></div><div className="w-label">Has reviews</div></div></div>
          <div className="widget"><span className="w-ic violet">✨</span><div className="w-body"><div className="w-num violet">{fmtNum(stats.ai)}</div><div className="w-label">Has AI Analysis</div></div></div>
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
                  <tr key={id} title={r.topPitch || undefined} className={`rowclick ${r.call ? 'callrow' : ''}`}
                    onClick={(e) => { const el = e.target as HTMLElement; if (el.closest('input,select,textarea,a,button,label,.tags-cell')) return; setReviewTab('info'); setReviewRow(r); }}>
                    <td className="cb"><input type="checkbox" className="selcheck" checked={rowSel.has(id)} onChange={(e) => setRowSel((s) => { const n = new Set(s); if ((e.target as HTMLInputElement).checked) n.add(id); else n.delete(id); return n; })} /></td>
                    {visibleKeys.map((k) => renderCell(k, r))}
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
        </>}
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}

      {infoFolder && <FolderInfoModal name={infoFolder.name} cities={infoFolder.cities} names={infoFolder.names} regions={infoFolder.regions} folderCount={infoFolder.folderCount} projectCount={infoFolder.projectCount} onClose={() => setInfoFolder(null)} />}

      {organizeOpen && <OrganizeModal onClose={() => setOrganizeOpen(false)} onDone={() => { actions.refresh().catch(() => {}); setReloadKey((k) => k + 1); }} />}

      {callsOpen && <CallsModal onClose={() => setCallsOpen(false)} onToggleCall={(r, call) => {
        setPageRows((rows) => rows.map((x) => (x._project === r._project && x._key === r._key ? { ...x, call } : x)));
        setCallCount((c) => Math.max(0, c + (call ? 1 : -1)));
        api.setCall(r._project, r._key, call).catch(() => {});
      }} />}

      {reviewRow && <ReviewsModal key={`${reviewRow._project}|${reviewRow._key}`} lead={reviewRow} initialTab={reviewTab} onClose={() => setReviewRow(null)} onEditAll={(l) => { setReviewRow(null); setDetailRow(l); }} onResizeStart={() => { draggingPanel.current = true; document.body.classList.add('resizing'); }} />}
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
