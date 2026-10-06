'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGrid, ROOT_FOLDER, downloadJson, downloadText, exportCsv, bundleToRows } from '@/lib/store';
import { api } from '@/lib/api';
import { type FolderAggregate, type LeadRow, type ProjectSummary, type WebsiteStatus, SALES_STATUSES, SALES_COLOR, SALES_NEEDS_DATE } from '@/lib/types';
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
import GroupsView from './GroupsView';
import VapiCallModal from './VapiCallModal';
import CategoriesView from './CategoriesView';
import NotesView from './NotesView';
import ChangelogView from './ChangelogView';
import OutreachSenders from './OutreachSenders';
import SequencesView from './SequencesView';
import EnrollModal from './EnrollModal';
import RepliesView from './RepliesView';
import OutreachReport from './OutreachReport';
import CoverageMatrix from './CoverageMatrix';
import CampaignToday from './CampaignToday';
import WarmupConsole from './WarmupConsole';
import { parseProjectGeo } from '@/lib/projectGeo';
import { rowOffsets, visibleRange } from '@/lib/windowing.mjs';
import { covNorm, makeCoverage } from '@/lib/coverage.mjs';
import LeadSearchModal from './LeadSearchModal';
import OrganizeModal from './OrganizeModal';

// folder names look like "<City...> Restaurants" — drop the last word for the city
const cityFromFolderName = (name: string) => { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? p.slice(0, -1).join(' ') : (name || ''); };

// thousands separator with a dot: 520343 → "520.343"
const fmtNum = (n: number) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ── folder coverage helpers for the cheap badge (lib/coverage.mjs; the accurate
// number comes from the server with the sidebar payload) ──
const COVERAGE = makeCoverage({ stateRegions: STATE_REGIONS, countryNames: COUNTRY_NAMES });
const COV_STATE_SET: Set<string> = COVERAGE.stateSet;
const covStateOf: (name: string) => string | null = COVERAGE.covStateOf;
const covRegionOf: (name: string) => string = COVERAGE.covRegionOf;
const covCountryPrefix: (name: string) => string | undefined = COVERAGE.covCountryPrefix;
const COV_CITY_SET = new Set<string>(); for (const c of COUNTRY_NAMES) for (const city of (COUNTRY_CITIES[c] || [])) COV_CITY_SET.add(covNorm(city));

const NO_AGG: FolderAggregate = { projects: 0, zero: 0, total: 0, noWebsite: 0, hot: 0, email: 0, emailMiss: 0, emailTodo: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };
const addAgg = (a: FolderAggregate, b: FolderAggregate | null | undefined): FolderAggregate => {
  if (!b) return a;
  const out = { ...a };
  for (const k of Object.keys(NO_AGG) as (keyof FolderAggregate)[]) out[k] = a[k] + (b[k] || 0);
  return out;
};

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

// Sidebar windowing. The row heights must match `.side-rows` in globals.css:
// rows are positioned by these numbers, not by measuring the DOM.
const SIDE_PROJECT_H = 33;
const SIDE_FOLDER_H = 34;
const SIDE_GAP = 4;
const SIDE_OVERSCAN = 20;  // rows rendered beyond the viewport on each side
const SIDE_SCROLL_STEP = 200; // re-window only after this many px of scroll (well inside the overscan)
const UNGROUPED_LS = 'gridleads_ungrouped';

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

// "🗂 Group" button with a dropdown: add the given leads to an existing group
// or create a new one. Leads come either as dedupKeys (row selection) or as
// the server-side set of checked leads (fromChecked).
function GroupPickBtn({ label, className = 'chipbtn', alignRight = false, keys, fromChecked = false, onDone }:
  { label: string; className?: string; alignRight?: boolean; keys?: () => string[]; fromChecked?: boolean; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<{ groupId: string; name: string; count: number }[] | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    api.getGroups().then((r) => setGroups(r.groups || [])).catch(() => setGroups([]));
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const opts = () => (fromChecked ? { fromChecked: true } : { keys: keys ? keys() : [] });
  const addTo = async (g: { groupId: string; name: string }) => {
    setOpen(false);
    const r = await api.addToGroup(g.groupId, opts()).catch(() => null);
    if (r?.ok) { alert(`Added ${r.added?.toLocaleString() || ''} lead(s) to "${g.name}".`); onDone?.(); }
    else alert(r?.error || 'Adding to the group failed.');
  };
  const createNew = async () => {
    setOpen(false);
    const name = prompt('New group name:');
    if (!name || !name.trim()) return;
    const r = await api.createGroup(name.trim(), opts()).catch(() => null);
    if (r?.ok) { alert(`Group "${name.trim()}" created with ${r.count?.toLocaleString()} lead(s).`); onDone?.(); }
    else alert(r?.error || 'Creating the group failed.');
  };
  return (
    <span className="grouppick" ref={ref}>
      <button className={className} onClick={() => setOpen((o) => !o)} title="Add these leads to a group">{label}</button>
      {open && (
        <div className={`grouppick-pop ${alignRight ? 'right' : ''}`}>
          <button className="grouppick-opt new" onClick={createNew}>＋ New group…</button>
          {groups === null && <div className="grouppick-empty">Loading…</div>}
          {groups?.map((g) => (
            <button key={g.groupId} className="grouppick-opt" onClick={() => addTo(g)}>
              <span className="grouppick-name">🗂 {g.name}</span><span className="grouppick-count">{g.count.toLocaleString()}</span>
            </button>
          ))}
          {groups && !groups.length && <div className="grouppick-empty">No groups yet</div>}
        </div>
      )}
    </span>
  );
}

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
  const summaries = useGrid((s) => s.summaries); // only the projects of the folders opened so far
  const own = useGrid((s) => s.own);
  const missingMap = useGrid((s) => s.missing);
  const ungroupedAgg = useGrid((s) => s.ungrouped);
  const allAgg = useGrid((s) => s.all);
  const facets = useGrid((s) => s.facets);
  const folderState = useGrid((s) => s.folderState);
  const hydrated = useGrid((s) => s.hydrated);
  const actions = useGrid((s) => s);

  const [mounted, setMounted] = useState(false);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  // when set, the main leads table is scoped to this saved group's members
  const [activeGroup, setActiveGroup] = useState<{ groupId: string; name: string; count: number } | null>(null);
  const [vapiGroup, setVapiGroup] = useState<{ groupId: string; name: string } | null>(null); // Vapi calling modal target
  const [leadSearch, setLeadSearch] = useState<{ project?: string | null; folder?: string | null; label: string } | null>(null); // automated email research target
  const [filter, setFilter] = useState<'all' | 'nowebsite' | 'haswebsite' | 'hot' | 'email' | 'hasreviews' | 'hasai'>('all');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selTypes, setSelTypes] = useState<string[]>([]);
  const [selRegions, setSelRegions] = useState<string[]>([]);
  const [selCountry, setSelCountry] = useState('');
  const [emailF, setEmailF] = useState('');   // '' | has | none | todo | checked | failed
  const [phoneF, setPhoneF] = useState('');   // '' | has | none
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [sortKey, setSortKey] = useState('opportunityScore');
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set());
  const [sideFilter, setSideFilter] = useState('');
  const [rowSel, setRowSel] = useState<Set<string>>(new Set());
  const [sidebarW, setSidebarW] = useState(264);
  const [panelW, setPanelW] = useState(440);
  const [collapsed, setCollapsed] = useState(false);
  const [ungroupedOpen, setUngroupedOpen] = useState(false); // the "Ungrouped" sidebar group (projects with no folder)
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [dupesOpen, setDupesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [view, setView] = useState<'leads' | 'map' | 'stats' | 'reviews' | 'groups' | 'cats' | 'notes' | 'log' | 'senders' | 'sequences' | 'replies' | 'report' | 'control' | 'coverage' | 'campaign'>('leads');
  const [infoFolder, setInfoFolder] = useState<{ name: string; cities: string[]; names: string[]; regions: string[]; folderCount: number; projectCount: number } | null>(null);
  const [detailRow, setDetailRow] = useState<LeadRow | null>(null);
  const [reviewRow, setReviewRow] = useState<LeadRow | null>(null);
  const [reviewTab, setReviewTab] = useState<'info' | 'reviews' | 'emails'>('info');
  const [callsOpen, setCallsOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [callCount, setCallCount] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);
  const [enrollOpen, setEnrollOpen] = useState(false); // sequence enrolment modal
  const [recalc, setRecalc] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [recounting, setRecounting] = useState(false); // full rebuild of the cached per-project counters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageRows, setPageRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState<number | null>(null); // null while the count is still running
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false); // the lead page request failed (not the same as "no leads")
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
    if (localStorage.getItem(UNGROUPED_LS) === '1') setUngroupedOpen(true);
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
  useEffect(() => { setPage(1); }, [activeProject, activeFolder, activeGroup, filter, debTerm, sortKey, sortDir, pageSize, selectedCats, selTypes, selRegions, selCountry, emailF, phoneF]);
  // picking a project/folder scope leaves any group scope
  useEffect(() => { if (activeProject || activeFolder) setActiveGroup(null); }, [activeProject, activeFolder]);
  // category options are scope-specific, so reset the picks when the scope changes
  useEffect(() => { setSelectedCats([]); }, [activeProject, activeFolder]);
  const refreshCallCount = useCallback(() => {
    api.getCallCount().then((r) => setCallCount(r.total || 0)).catch(() => {});
    api.getCheckedCount().then((r) => setCheckedCount(r.total || 0)).catch(() => {});
  }, []);
  useEffect(() => { refreshCallCount(); }, [reloadKey, refreshCallCount]);
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
  // permanently delete every checked lead from the database
  const deleteAllChecked = async () => {
    if (!checkedCount) return;
    if (!confirm(`Delete all ${checkedCount.toLocaleString()} CHECKED lead(s) from the database? This cannot be undone.`)) return;
    const r = await api.deleteAllChecked().catch(() => null);
    if (!r?.ok) { alert('Deleting failed.'); return; }
    setCheckedCount(0);
    actions.refresh().catch(() => {});
    setReloadKey((k) => k + 1);
  };

  const catsKey = selectedCats.join('');
  // ----- server-side page fetch -----
  // Not gated on the store: the sidebar payload is megabytes and took 10-20 s
  // to arrive and render, while this request needs nothing from it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getLeads({ project: activeProject, folder: activeFolder, group: activeGroup?.groupId, filter, search: debTerm, categories: selectedCats, ptypes: selTypes, pregions: selRegions, country: selCountry, email: emailF, phone: phoneF, sort: sortKey, dir: sortDir, page, pageSize }, { total: false })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows || []).map((r: any) => ({ ...r, _project: r.project, _key: r.dedupKey })) as LeadRow[];
        setPageRows(rows);
        setLoadError('error' in res); // the route answers { rows: [], total: 0, error } on failure
      })
      .catch(() => { if (!cancelled) { setPageRows([]); setLoadError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, activeFolder, activeGroup?.groupId, filter, debTerm, catsKey, selTypes.join('|'), selRegions.join('|'), selCountry, emailF, phoneF, sortKey, sortDir, page, pageSize, reloadKey]);

  const summariesArr = useMemo(() => Object.values(summaries), [summaries]);
  const folderList = useMemo(() => Object.values(folders), [folders]);

  // Dropdown options: the canonical batch lists (BIZ_TYPES + countries/state_json)
  // merged with what occurs in the project queries (sent by the server), so old
  // or mistyped values stay selectable.
  const projFacets = useMemo(() => ({
    types: [...new Set([...BIZ_TYPES, ...facets.types])].sort((a, b) => a.localeCompare(b)),
    regions: [...new Set([...ALL_REGIONS, ...facets.regions])].sort((a, b) => a.localeCompare(b)),
  }), [facets]);
  const typeSel = selTypes[0] || '';
  const regionSel = selRegions[0] || '';
  const countryOpts = facets.countries; // [country, projects], most projects first

  // ----- sidebar tree (folders can nest inside folders) -----
  // Split by what each part depends on. Opening or closing a folder creates a new
  // `folders` object; as one big memo that regrouped all 240k projects and
  // recomputed every folder badge on each click.
  type FolderT = typeof folderList[number];

  // projects grouped by folderId — depends on the project list only
  const projIndex = useMemo(() => {
    const byFolder: Record<string, ProjectSummary[]> = {};
    const noFolder: ProjectSummary[] = [];
    for (const p of summariesArr) { if (p.folderId) (byFolder[p.folderId] = byFolder[p.folderId] || []).push(p); else noFolder.push(p); }
    Object.keys(byFolder).forEach((k) => byFolder[k].sort(byCreated));
    noFolder.sort(byCreated);
    return { byFolder, noFolder };
  }, [summariesArr]);

  // The shape of the folder tree. Open/closed state, icon and manual order are
  // left out on purpose, so toggling a folder invalidates nothing below. A new
  // folder property that changes the tree or its sort order must be added here.
  const folderShape = useMemo(() => folderList.map((f) => `${f.id}\u0001${f.parentId || ''}\u0001${f.name}\u0001${f.createdAt}`).join('\u0002'), [folderList]);

  // ids only: the folder objects themselves change on every toggle
  const folderTree = useMemo(() => {
    const exists = new Set(folderList.map((f) => f.id));
    const nameOf: Record<string, string> = {};
    folderList.forEach((f) => { nameOf[f.id] = f.name || ''; });
    const childIds: Record<string, string[]> = {};
    const rootIds: string[] = [];
    folderList.slice().sort(byName).forEach((f) => {
      const pid = f.parentId && exists.has(f.parentId) ? f.parentId : '';
      if (pid) (childIds[pid] = childIds[pid] || []).push(f.id);
      else rootIds.push(f.id);
    });
    // descendant ids per folder (for stats scope)
    const descOf: Record<string, Set<string>> = {};
    const computeDesc = (id: string): Set<string> => {
      const set = new Set<string>([id]);
      for (const c of (childIds[id] || [])) computeDesc(c).forEach((x) => set.add(x));
      descOf[id] = set; return set;
    };
    rootIds.forEach(computeDesc);
    const folderCountOf: Record<string, number> = {};
    for (const id of Object.keys(descOf)) folderCountOf[id] = descOf[id].size - 1; // descendants, excluding self
    // flat list with depth (for the "Move to…" dropdown)
    const flatIds: { id: string; depth: number }[] = [];
    const flatten = (id: string, depth: number) => { flatIds.push({ id, depth }); (childIds[id] || []).forEach((c) => flatten(c, depth + 1)); };
    rootIds.forEach((id) => flatten(id, 0));
    return { exists, nameOf, childIds, rootIds, descOf, folderCountOf, flatIds };
    // folderList is read through folderShape: same shape → same tree
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderShape]);

  // Per-folder numbers. The counts come from the server's per-folder sums (`own`);
  // project lists exist only for the folders that were opened.
  const folderTotals = useMemo(() => {
    const { exists, nameOf, childIds, descOf } = folderTree;
    const projsOf: Record<string, ProjectSummary[]> = {};
    const stray: ProjectSummary[] = []; // a folderId that no longer exists counts as ungrouped
    for (const fid of Object.keys(projIndex.byFolder)) {
      if (!exists.has(fid)) stray.push(...projIndex.byFolder[fid]);
      else if (folderState[fid] === 'loaded') projsOf[fid] = projIndex.byFolder[fid];
    }
    const ungrouped = folderState[ROOT_FOLDER] !== 'loaded' ? []
      : stray.length ? [...projIndex.noFolder, ...stray].sort(byCreated) : projIndex.noFolder;
    // recursive: a folder's own projects + every descendant folder's
    const totalOf: Record<string, number> = {};
    const projCountOf: Record<string, number> = {};
    const zeroCountOf: Record<string, number> = {}; // projects with 0 leads (orange badge)
    for (const id of Object.keys(descOf)) {
      let t = 0, pc = 0, zc = 0;
      descOf[id].forEach((did) => { const o = own[did]; if (o) { t += o.total; pc += o.projects; zc += o.zero; } });
      totalOf[id] = t; projCountOf[id] = pc; zeroCountOf[id] = zc;
    }
    // coverage "missing" per folder (red badge) — CHEAP estimate (reference count −
    // present count), used where the server sent no accurate number.
    const missingOf: Record<string, number | null> = {};
    for (const id of exists) {
      const name = nameOf[id];
      let miss: number | null = null;
      const cp = covCountryPrefix(name);
      if (cp) {
        const kidNames = (childIds[id] || []).map((k) => nameOf[k]);
        // State detection by prefix (robust to multi-word business types).
        const stateKids = kidNames.map((n) => covStateOf(n)).filter(Boolean) as string[];
        if (covNorm(cp) === 'usa' && stateKids.length > 0 && stateKids.length >= kidNames.length / 2) {
          miss = Math.max(0, STATE_REGIONS.length - new Set(stateKids).size); // missing US states (of 51)
        } else {
          const cities = COUNTRY_CITIES[cp] || [];
          const citySet = new Set(cities.map(covNorm));
          const kidRegions = kidNames.map((n) => covNorm(covRegionOf(n)));
          const present = new Set(kidRegions.filter((r) => citySet.has(r))).size;
          miss = Math.max(0, cities.length - present); // missing cities
        }
      } else {
        const reg = covStateOf(name) || covNorm(covRegionOf(name));
        if (COV_STATE_SET.has(reg) && STATE_PLACE_COUNTS[reg] != null) miss = Math.max(0, STATE_PLACE_COUNTS[reg] - (projCountOf[id] || 0));
        else if (COV_CITY_SET.has(reg) && CITY_AREA_COUNTS[reg] != null) miss = Math.max(0, CITY_AREA_COUNTS[reg] - (projCountOf[id] || 0));
      }
      missingOf[id] = miss;
    }
    return { projsOf, ungrouped, totalOf, projCountOf, zeroCountOf, missingOf };
  }, [projIndex, folderTree, own, folderState]);

  // the same tree with the current folder objects (774 folders: cheap on every toggle)
  const tree = useMemo(() => {
    const childrenOf: Record<string, FolderT[]> = {};
    for (const pid of Object.keys(folderTree.childIds)) childrenOf[pid] = folderTree.childIds[pid].map((id) => folders[id]).filter(Boolean);
    const roots = folderTree.rootIds.map((id) => folders[id]).filter(Boolean);
    const flat = folderTree.flatIds.map(({ id, depth }) => ({ f: folders[id], depth })).filter((x) => x.f);
    return { childrenOf, roots, flat, descOf: folderTree.descOf, folderCountOf: folderTree.folderCountOf, ...folderTotals };
  }, [folderTree, folderTotals, folders]);

  // ----- sidebar filter: text + business-type + state/country -----
  // Asked from the server (GET /api/projects?search=…): the browser holds only the
  // projects of opened folders. A folder whose NAME matches the text is shown too.
  const sideQuery = sideFilter.trim().toLowerCase();
  const filterOn = !!(sideQuery || typeSel || regionSel || selCountry);
  const filterKey = `${sideQuery}|${typeSel}|${regionSel}|${selCountry}`;
  const [sideSearch, setSideSearch] = useState<{ key: string; rows: ProjectSummary[]; total: number } | null>(null);
  useEffect(() => {
    if (!filterOn) { setSideSearch(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchProjects({ search: sideQuery, ptypes: selTypes, pregions: selRegions, country: selCountry })
        .then((r) => { if (!cancelled) setSideSearch({ key: filterKey, rows: r.rows, total: r.total }); })
        .catch(() => { if (!cancelled) setSideSearch({ key: filterKey, rows: [], total: 0 }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadKey]);
  const filtered = useMemo(() => {
    if (!filterOn) return null;
    const ready = !!sideSearch && sideSearch.key === filterKey;
    const rows = ready ? sideSearch.rows : [];
    const showFolder = new Set<string>();
    const showProject = new Set<string>();
    const hitsOf: Record<string, ProjectSummary[]> = {}; // matching projects by folder id ('' = no folder)
    // show a folder and every folder above it
    const reveal = (id: string) => { let cur = folders[id]; while (cur && !showFolder.has(cur.id)) { showFolder.add(cur.id); cur = cur.parentId ? folders[cur.parentId] : undefined as never; } };
    for (const p of rows) {
      showProject.add(p.query);
      const fid = p.folderId && folders[p.folderId] ? p.folderId : '';
      (hitsOf[fid] = hitsOf[fid] || []).push(p);
      if (fid) reveal(fid);
    }
    if (sideQuery) for (const f of folderList) if ((f.name || '').toLowerCase().includes(sideQuery)) reveal(f.id);
    return { showFolder, showProject, hitsOf, rows, total: ready ? sideSearch.total : 0, loading: !ready };
  }, [filterOn, filterKey, sideSearch, folders, folderList, sideQuery]);

  // ----- sidebar rows: the tree flattened to what is on screen -----
  // Folders respect open/closed (all matching folders are open while filtering).
  // Projects with no folder sit in one "Ungrouped" group, closed by default —
  // there are thousands of them and rendering each cost seconds per render.
  type SideRow = { kind: 'folder'; f: FolderT; depth: number } | { kind: 'project'; p: ProjectSummary; depth: number } | { kind: 'ungrouped' }
    | { kind: 'loading'; id: string; depth: number }; // an open folder whose projects are on their way
  const visibleRows = useMemo(() => {
    const rows: SideRow[] = [];
    const walk = (f: FolderT, depth: number) => {
      if (filtered && !filtered.showFolder.has(f.id)) return;
      rows.push({ kind: 'folder', f, depth });
      if (filtered) { // every shown folder is open while filtering; only the matches are listed
        for (const c of (tree.childrenOf[f.id] || [])) walk(c, depth + 1);
        for (const p of (filtered.hitsOf[f.id] || [])) rows.push({ kind: 'project', p, depth: depth + 1 });
        return;
      }
      if (f.collapsed) return;
      for (const c of (tree.childrenOf[f.id] || [])) walk(c, depth + 1);
      if (folderState[f.id] === 'loaded') for (const p of (tree.projsOf[f.id] || [])) rows.push({ kind: 'project', p, depth: depth + 1 });
      else if (own[f.id]?.projects) rows.push({ kind: 'loading', id: f.id, depth: depth + 1 });
    };
    tree.roots.forEach((f) => walk(f, 0));
    if (filtered) { // matches without a folder show whether or not the group is open
      for (const p of (filtered.hitsOf[''] || [])) rows.push({ kind: 'project', p, depth: 0 });
    } else if (ungroupedAgg.projects > 0) {
      rows.push({ kind: 'ungrouped' });
      if (ungroupedOpen) {
        if (folderState[ROOT_FOLDER] === 'loaded') for (const p of tree.ungrouped) rows.push({ kind: 'project', p, depth: 1 });
        else rows.push({ kind: 'loading', id: ROOT_FOLDER, depth: 1 });
      }
    }
    return rows;
  }, [tree, filtered, ungroupedOpen, folderState, own, ungroupedAgg]);
  // fetch the projects of every folder that is open and not here yet
  useEffect(() => {
    if (!hydrated) return;
    for (const f of folderList) if (!f.collapsed && own[f.id]?.projects && !folderState[f.id]) actions.loadFolder(f.id);
    if (ungroupedOpen && ungroupedAgg.projects > 0 && !folderState[ROOT_FOLDER]) actions.loadFolder(ROOT_FOLDER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, folderList, own, folderState, ungroupedOpen, ungroupedAgg]);
  // visible project order — for shift-click range select
  const visibleOrder = useMemo(() => { const o: string[] = []; for (const r of visibleRows) if (r.kind === 'project') o.push(r.p.query); return o; }, [visibleRows]);

  // Windowing: only the rows near the viewport are in the DOM (lib/windowing.mjs).
  const sideLayout = useMemo(() => {
    const heights = visibleRows.map((r) => (r.kind === 'project' || r.kind === 'loading' ? SIDE_PROJECT_H : SIDE_FOLDER_H));
    return { heights, layout: rowOffsets(heights, SIDE_GAP) };
  }, [visibleRows]);
  const sideScrollRef = useRef<HTMLDivElement>(null); // .sidebar-scroll: the element that scrolls
  const sideRowsRef = useRef<HTMLDivElement>(null);   // .side-rows: the windowed list inside it
  const [sideWin, setSideWin] = useState({ top: 0, height: 1000 });
  // where the viewport is relative to the list; rects, because the list starts
  // below the nav rail and the filters, whose height changes
  const measureSide = useCallback(() => {
    const sc = sideScrollRef.current, el = sideRowsRef.current;
    if (!sc || !el) return;
    const rawTop = sc.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const top = Math.floor(rawTop / SIDE_SCROLL_STEP) * SIDE_SCROLL_STEP;
    const height = sc.clientHeight + SIDE_SCROLL_STEP;
    setSideWin((w) => (w.top === top && w.height === height ? w : { top, height }));
  }, []);
  const sidebarShown = mounted && (!collapsed || isMobile);
  useEffect(() => {
    const sc = sideScrollRef.current;
    if (!sc) return;
    // No requestAnimationFrame throttle: measuring is two rects, and state only
    // changes once per SIDE_SCROLL_STEP px, so most scroll events re-render nothing.
    sc.addEventListener('scroll', measureSide, { passive: true });
    const ro = new ResizeObserver(measureSide);
    ro.observe(sc);
    return () => { sc.removeEventListener('scroll', measureSide); ro.disconnect(); };
  }, [sidebarShown, measureSide]);
  useLayoutEffect(() => { measureSide(); }); // rows above the list may have changed height in this render
  const sideRange = useMemo(() => visibleRange(sideLayout.layout, sideLayout.heights, sideWin.top, sideWin.height, SIDE_OVERSCAN), [sideLayout, sideWin]);
  const toggleUngrouped = () => setUngroupedOpen((v) => { try { localStorage.setItem(UNGROUPED_LS, v ? '0' : '1'); } catch { /* layout only */ } return !v; });

  // ----- widgets -----
  // From the per-folder sums when the scope is everything or a folder; a
  // project scope or a type / region / country filter is summed by the server.
  const facetOn = !!(typeSel || regionSel || selCountry);
  const statsLocal = useMemo<FolderAggregate | null>(() => {
    if (!hydrated || facetOn) return null;
    if (activeFolder) { let a = NO_AGG; (tree.descOf[activeFolder] || new Set([activeFolder])).forEach((id) => { a = addAgg(a, own[id]); }); return a; }
    if (activeProject) { const p = summaries[activeProject]; return p ? addAgg(NO_AGG, { ...NO_AGG, ...p, projects: 1, zero: p.total ? 0 : 1, emailMiss: p.emailMiss || 0, emailTodo: p.emailTodo || 0, reviews: p.reviews || 0, reviewsSum: p.reviewsSum || 0, ai: p.ai || 0, oppSum: p.oppSum || 0 }) : null; }
    return allAgg;
  }, [hydrated, facetOn, activeFolder, activeProject, tree, own, summaries, allAgg]);
  const statsKey = `${activeFolder || ''}|${activeProject || ''}|${typeSel}|${regionSel}|${selCountry}`;
  const [scopeStats, setScopeStats] = useState<{ key: string; agg: FolderAggregate } | null>(null);
  const needScopeStats = hydrated && !statsLocal;
  useEffect(() => {
    if (!needScopeStats) return;
    let cancelled = false;
    api.getScopeStats({ project: activeProject, folder: activeFolder, ptypes: selTypes, pregions: selRegions, country: selCountry })
      .then((agg) => { if (!cancelled) setScopeStats({ key: statsKey, agg }); })
      .catch(() => { /* the tiles stay at zero; the lead count falls back to the server */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needScopeStats, statsKey, reloadKey]);
  const statsAgg = statsLocal || (scopeStats && scopeStats.key === statsKey ? scopeStats.agg : null);
  const statsReady = !!statsAgg;
  const stats = useMemo(() => {
    const a = statsAgg || NO_AGG;
    return { total: a.total, noweb: a.noWebsite, hot: a.hot, email: a.email, emailMiss: a.emailMiss, emailTodo: a.emailTodo, reviews: a.reviews, reviewsSum: a.reviewsSum, ai: a.ai, avg: a.total ? Math.round(a.oppSum / a.total) : 0 };
  }, [statsAgg]);
  // Email tile: shows the precomputed project counters, and re-counts live from
  // the database when clicked (only these two numbers — nothing else reloads).
  const [emailLive, setEmailLive] = useState<{ email: number; miss: number } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const emailScope = `${activeFolder || ''}|${activeProject || ''}|${typeSel}|${regionSel}|${selCountry}`;
  const emailScopeRef = useRef(emailScope);
  useEffect(() => { emailScopeRef.current = emailScope; setEmailLive(null); }, [emailScope]); // other scope → the live numbers no longer apply
  const emailTile = emailLive || { email: stats.email, miss: stats.emailMiss };
  const refreshEmailTile = async () => {
    if (emailBusy) return;
    const scope = emailScope;
    setEmailBusy(true);
    try {
      const r = await api.getEmailCounts({ project: activeProject, folder: activeFolder, ptypes: selTypes, pregions: selRegions, country: selCountry });
      if (r?.ok && emailScopeRef.current === scope) setEmailLive({ email: r.email, miss: r.miss });
    } catch { /* keep the numbers already shown */ }
    setEmailBusy(false);
  };
  const globalTotal = allAgg.total;
  const scopeName = activeFolder ? (folders[activeFolder]?.name || 'this folder') : activeProject ? (summaries[activeProject]?.name || activeProject) : '';

  const title = activeFolder ? `📁 ${folders[activeFolder]?.name || 'Folder'}`
    : activeProject === null ? 'All leads'
    : (summaries[activeProject]?.name || activeProject);
  const totalAll = allAgg.total;
  // ----- lead count -----
  // Apart from the rows, so a slow count never holds the page back, and not
  // repeated when only the page or the sort changes. Where a chip (or one of
  // the email dropdown values) is the only filter, the number is already in the
  // project counters and no request is made at all.
  const countFromStats = (() => {
    if (!hydrated || !statsReady || debTerm || selectedCats.length || phoneF || activeGroup) return undefined;
    if (!emailF) return ({ all: stats.total, nowebsite: stats.noweb, hot: stats.hot, email: stats.email, hasreviews: stats.reviews, hasai: stats.ai } as Record<string, number | undefined>)[filter];
    if (filter !== 'all') return undefined;
    // `todo` is left to the server: ProjectStat.emailTodo is only filled for projects
    // recounted since that counter was added (the sum was 40 against 944,728 real)
    return ({ has: stats.email, miss: stats.emailMiss } as Record<string, number | undefined>)[emailF];
  })();
  useEffect(() => {
    if (countFromStats !== undefined) { setTotal(countFromStats); return; }
    let cancelled = false;
    setTotal(null);
    api.getLeadsTotal({ project: activeProject, folder: activeFolder, group: activeGroup?.groupId, filter, search: debTerm, categories: selectedCats, ptypes: selTypes, pregions: selRegions, country: selCountry, email: emailF, phone: phoneF })
      .then((res) => { if (!cancelled) setTotal(res.total || 0); })
      .catch(() => { if (!cancelled) setTotal(0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countFromStats, activeProject, activeFolder, activeGroup?.groupId, filter, debTerm, catsKey, selTypes.join('|'), selRegions.join('|'), selCountry, emailF, phoneF, reloadKey]);
  const pageCount = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  // with the count still running, "next" is allowed whenever the page came back full
  const isLastPage = pageCount !== null ? page >= pageCount : pageRows.length < pageSize;

  // ----- selection (sidebar projects) -----
  const toggleSelect = (q: string, checked: boolean, shift: boolean) => {
    const next = new Set(selected);
    const order = visibleOrder; // shift-range over what's actually visible
    if (shift && lastChecked.current) {
      const a = order.indexOf(lastChecked.current);
      const b = order.indexOf(q);
      if (a !== -1 && b !== -1) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) { if (checked) next.add(order[i]); else next.delete(order[i]); } }
    } else if (checked) next.add(q); else next.delete(q);
    lastChecked.current = q;
    setSelected(next);
  };

  // "Select all filtered": the sidebar lists only the first matches, so the full
  // set of queries is asked from the server (up to 5,000).
  const selectAllFiltered = async (unselect: boolean) => {
    let queries: string[];
    try { queries = (await api.searchProjectQueries({ search: sideQuery, ptypes: selTypes, pregions: selRegions, country: selCountry })).queries; }
    catch { alert('Could not select the filtered projects.'); return; }
    setSelected((prev) => { const n = new Set(prev); for (const q of queries) { if (unselect) n.delete(q); else n.add(q); } return n; });
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
  const openFolderInfo = async (f: typeof folderList[number]) => {
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
    // the projects of the whole subtree, by name only — most of them are not loaded here
    let projects: [string, string | 0][];
    try { projects = await api.getFolderProjectNames(f.id); } catch { alert('Could not load coverage.'); return; }
    for (const [query, name] of projects) {
      if (name) names.push(name);
      if (query) { names.push(query); const r = parseProject(query).region; if (r) regions.add(r); }
    }
    setInfoFolder({ name: f.name, cities, names, regions: [...regions], folderCount: childIds.length, projectCount: projects.length });
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
  // one folder row; its children are separate rows of `visibleRows`
  const renderFolderRow = (f: FolderT, depth: number): React.ReactNode => {
    const hasKids = filtered
      ? (tree.childrenOf[f.id] || []).some((c) => filtered.showFolder.has(c.id)) || !!(filtered.hitsOf[f.id] || []).length
      : !!((tree.childrenOf[f.id] || []).length || own[f.id]?.projects);
    const open = filtered ? true : !f.collapsed; // force-expand while filtering
    return (
        <div
          key={f.id}
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
          <span className="caret" onClick={(e) => { e.stopPropagation(); actions.setFolderCollapsed(f.id, !f.collapsed); }}>{hasKids ? (open ? '▾' : '▸') : '·'}</span>
          <span className="fname" title={f.name}>{f.icon || '📁'} {f.name}</span>
          <span className="ni-right">
            <span className="badge">{tree.totalOf[f.id] ?? 0}</span>
            {(() => { const m = missingMap[f.id] ?? tree.missingOf[f.id]; return (m || 0) > 0 ? <span className="cnt-badge red" title={`${m} missing (not yet scraped vs the full list)`}>{m}</span> : null; })()}
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
    );
  };
  const renderSideRow = (r: SideRow): React.ReactNode => {
    if (r.kind === 'folder') return renderFolderRow(r.f, r.depth);
    if (r.kind === 'project') return renderProject(r.p, r.depth);
    if (r.kind === 'loading') return (
      <div key={`load:${r.id}`} className="navitem proj" style={{ paddingLeft: 10 + r.depth * 14 }}>
        <span className="ni-name">{folderState[r.id] === 'error' ? 'Could not load projects. Use ⟳ Refresh.' : 'Loading…'}</span>
      </div>
    );
    return (
      <div key="__ungrouped__" className="folder" style={{ paddingLeft: 4 }} title="Projects with no folder" onClick={toggleUngrouped}>
        <span className="caret">{ungroupedOpen ? '▾' : '▸'}</span>
        <span className="fname">📁 Ungrouped</span>
        <span className="ni-right">
          <span className="badge">{ungroupedAgg.total}</span>
          <span className="cnt-badge green" title={`${ungroupedAgg.projects} project(s)`}>{ungroupedAgg.projects}</span>
        </span>
      </div>
    );
  };

  if (!mounted) return null;
  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} ${reviewRow ? 'with-panel' : ''}`} style={{ '--sw': `${collapsed && !isMobile ? 64 : sidebarW}px`, '--pw': `${panelW}px` } as React.CSSProperties}>
      <div className="side-backdrop" onClick={() => setSidebarOpen(false)} />

      {/* SIDEBAR — collapsed icon rail (desktop only) */}
      {collapsed && !isMobile && (
        <aside className="sidebar collapsed">
          <button className="brand-mark only" title="Expand sidebar" onClick={() => setCol(false)}>✦</button>
          <div className="crail">
            <button className={`crail-i ${view === 'leads' ? 'active' : ''}`} title="Leads" onClick={() => { setActiveGroup(null); setView('leads'); }}>🧾</button>
            <button className={`crail-i ${view === 'map' ? 'active' : ''}`} title="Map" onClick={() => setView('map')}>🗺️</button>
            <button className={`crail-i ${view === 'stats' ? 'active' : ''}`} title="Stats" onClick={() => setView('stats')}>📊</button>
            <button className={`crail-i ${view === 'reviews' ? 'active' : ''}`} title="Reviews" onClick={() => setView('reviews')}>💬</button>
            <button className={`crail-i ${view === 'groups' ? 'active' : ''}`} title="Groups" onClick={() => setView('groups')}>🗂</button>
            <button className={`crail-i ${view === 'cats' ? 'active' : ''}`} title="Categories" onClick={() => setView('cats')}>🏷</button>
            <button className={`crail-i ${view === 'notes' ? 'active' : ''}`} title="Notes" onClick={() => setView('notes')}>📝</button>
            <button className={`crail-i ${view === 'log' ? 'active' : ''}`} title="Changelog" onClick={() => setView('log')}>🕘</button>
            <button className={`crail-i ${view === 'coverage' ? 'active' : ''}`} title="Coverage" onClick={() => setView('coverage')}>🧩</button>
            <button className={`crail-i ${view === 'campaign' ? 'active' : ''}`} title="Campaign" onClick={() => setView('campaign')}>🚀</button>
            <button className={`crail-i ${view === 'sequences' ? 'active' : ''}`} title="Sequences" onClick={() => setView('sequences')}>📨</button>
            <button className={`crail-i ${view === 'replies' ? 'active' : ''}`} title="Replies" onClick={() => setView('replies')}>💌</button>
            <button className={`crail-i ${view === 'senders' ? 'active' : ''}`} title="Senders" onClick={() => setView('senders')}>✉️</button>
            <button className={`crail-i ${view === 'report' ? 'active' : ''}`} title="Outreach report" onClick={() => setView('report')}>📈</button>
            <button className={`crail-i ${view === 'control' ? 'active' : ''}`} title="Outreach control" onClick={() => setView('control')}>🚦</button>
            <button className="crail-i" title="Calls" onClick={() => setCallsOpen(true)}>📞</button>
            <button className="crail-i" title="Duplicates" onClick={() => setDupesOpen(true)}>⧉</button>
            <button className="crail-i" title="Organize" onClick={() => setOrganizeOpen(true)}>🗂️</button>
            <div className="crail-sep" />
            {tree.roots.map((f) => (
              <button key={f.id} className={`crail-i ${activeFolder === f.id ? 'active' : ''}`} title={f.name} onClick={() => { setActiveProject(null); setActiveFolder(f.id); setView('leads'); }}>{f.icon || '📁'}</button>
            ))}
            {ungroupedAgg.projects > 0 && (
              <button className="crail-chip" title={`${ungroupedAgg.projects} project${ungroupedAgg.projects === 1 ? '' : 's'} with no folder`} onClick={() => setCol(false)}>+{ungroupedAgg.projects}</button>
            )}
          </div>
          <button className="crail-expand" title="Expand sidebar" onClick={() => setCol(false)}>»</button>
        </aside>
      )}

      {/* SIDEBAR — full (also used on mobile, where collapse is disabled) */}
      {(!collapsed || isMobile) && (
      <aside className="sidebar">
        <div className="sidebar-scroll" ref={sideScrollRef}>
        <div className="brand"><span className="brand-mark">✦</span> GridLeads <button className="side-collapse" title="Collapse sidebar" onClick={() => setCol(true)}>«</button></div>

        <nav className="navrail">
          <button className={`navrail-item ${view === 'leads' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setView('leads'); setSidebarOpen(false); }}><span className="ic">🧾</span> Leads</button>
          <button className={`navrail-item ${view === 'map' ? 'active' : ''}`} onClick={() => { setView('map'); setSidebarOpen(false); }}><span className="ic">🗺️</span> Map</button>
          <button className={`navrail-item ${view === 'stats' ? 'active' : ''}`} onClick={() => { setView('stats'); setSidebarOpen(false); }}><span className="ic">📊</span> Stats</button>
          <button className={`navrail-item ${view === 'reviews' ? 'active' : ''}`} onClick={() => { setView('reviews'); setSidebarOpen(false); }}><span className="ic">💬</span> Reviews</button>
          <button className={`navrail-item ${view === 'groups' ? 'active' : ''}`} onClick={() => { setView('groups'); setSidebarOpen(false); }}><span className="ic">🗂</span> Groups</button>
          <button className={`navrail-item ${view === 'cats' ? 'active' : ''}`} onClick={() => { setView('cats'); setSidebarOpen(false); }}><span className="ic">🏷</span> Categories</button>
          <button className={`navrail-item ${view === 'notes' ? 'active' : ''}`} onClick={() => { setView('notes'); setSidebarOpen(false); }}><span className="ic">📝</span> Notes</button>
          <button className={`navrail-item ${view === 'log' ? 'active' : ''}`} onClick={() => { setView('log'); setSidebarOpen(false); }}><span className="ic">🕘</span> Changelog</button>
          <button className={`navrail-item ${view === 'coverage' ? 'active' : ''}`} onClick={() => { setView('coverage'); setSidebarOpen(false); }}><span className="ic">🧩</span> Coverage</button>
          <button className={`navrail-item ${view === 'campaign' ? 'active' : ''}`} onClick={() => { setView('campaign'); setSidebarOpen(false); }}><span className="ic">🚀</span> Campaign</button>
          <button className={`navrail-item ${view === 'sequences' ? 'active' : ''}`} onClick={() => { setView('sequences'); setSidebarOpen(false); }}><span className="ic">📨</span> Sequences</button>
          <button className={`navrail-item ${view === 'replies' ? 'active' : ''}`} onClick={() => { setView('replies'); setSidebarOpen(false); }}><span className="ic">💌</span> Replies</button>
          <button className={`navrail-item ${view === 'senders' ? 'active' : ''}`} onClick={() => { setView('senders'); setSidebarOpen(false); }}><span className="ic">✉️</span> Senders</button>
          <button className={`navrail-item ${view === 'report' ? 'active' : ''}`} onClick={() => { setView('report'); setSidebarOpen(false); }}><span className="ic">📈</span> Report</button>
          <button className={`navrail-item ${view === 'control' ? 'active' : ''}`} onClick={() => { setView('control'); setSidebarOpen(false); }}><span className="ic">🚦</span> Control</button>
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
          <span>Projects {hydrated && <span className="side-count">{folderList.length} folder{folderList.length === 1 ? '' : 's'} · {allAgg.projects} project{allAgg.projects === 1 ? '' : 's'}</span>}</span>
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
        {filtered && filtered.total > 0 && (() => {
          const allSel = filtered.rows.length > 0 && filtered.rows.every((p) => selected.has(p.query));
          const n = Math.min(filtered.total, 5000);
          return (
            <label className="side-selectall">
              <input type="checkbox" checked={allSel} onChange={() => selectAllFiltered(allSel)} />
              Select all {n.toLocaleString()} filtered project{n === 1 ? '' : 's'}{filtered.total > n ? ` (the first of ${filtered.total.toLocaleString()})` : ''}
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
          {!hydrated && Array.from({ length: 10 }).map((_, i) => <div key={i} className="skel-bar" style={{ height: 30, width: `${68 + ((i * 11) % 30)}%` }} />)}
          {hydrated && <>
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
          <div className="side-rows" ref={sideRowsRef} style={{ paddingTop: sideRange.padTop, paddingBottom: sideRange.padBottom }}>
            {visibleRows.slice(sideRange.first, sideRange.last + 1).map(renderSideRow)}
          </div>
          {filtered && filtered.total > filtered.rows.length && (
            <div className="side-empty">Showing the first {filtered.rows.length.toLocaleString()} of {filtered.total.toLocaleString()} matching projects.</div>
          )}
          {filtered && !filtered.loading && filtered.showFolder.size === 0 && filtered.total === 0 && (
            <div className="side-empty">No folders or projects match “{sideFilter.trim()}”.</div>
          )}
          </>}
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
          {(activeProject || activeFolder) && (
            <button className="btn" title="Research a public email for every email-less lead in this project/folder (OpenAI web search, stoppable)"
              onClick={() => setLeadSearch({
                project: activeProject, folder: activeFolder,
                label: activeFolder ? (folders[activeFolder]?.name || 'folder') : (summaries[activeProject!]?.name || activeProject || ''),
              })}>🔎 Lead search</button>
          )}
          <button className="btn" onClick={() => setEnrollOpen(true)} title="Put the leads of this filter, the checked leads or this group into an email sequence, or take them out">📨 Sequence</button>
          {checkedCount > 0 && <GroupPickBtn label={`🗂 Group ${checkedCount.toLocaleString()}`} className="btn" alignRight fromChecked />}
          {checkedCount > 0 && <button className="btn" onClick={uncheckAllLeads} title="Clear the Checked status on all checked leads">☐ Uncheck {checkedCount.toLocaleString()}</button>}
          {checkedCount > 0 && <button className="btn danger" onClick={deleteAllChecked} title="Permanently delete every checked lead from the database">🗑 Delete {checkedCount.toLocaleString()}</button>}
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

        {view === 'groups' && <GroupsView onOpen={(g) => { setActiveProject(null); setActiveFolder(null); setActiveGroup(g); setView('leads'); }} onCall={(g) => setVapiGroup(g)} />}

        {view === 'cats' && <CategoriesView />}

        {view === 'notes' && <NotesView />}

        {view === 'log' && <ChangelogView onOpenProject={(q) => { setActiveGroup(null); setActiveFolder(null); setActiveProject(q); setView('leads'); }} />}

        {view === 'senders' && <OutreachSenders />}

        {view === 'sequences' && <SequencesView />}

        {view === 'replies' && <RepliesView />}

        {view === 'report' && <OutreachReport />}
        {view === 'coverage' && <CoverageMatrix />}
        {view === 'campaign' && <CampaignToday reloadKey={reloadKey} onEnroll={() => setEnrollOpen(true)} onEditSequences={() => setView('sequences')} />}

        {view === 'control' && <WarmupConsole />}

        {view === 'leads' && <>
        {activeGroup && (
          <div className="groupbar">
            <button className="btn" onClick={() => { setActiveGroup(null); setView('groups'); }}>← Groups</button>
            <div className="groups-title">🗂 {activeGroup.name}</div>
            <div className="spacer" />
            <button className="btn primary" onClick={() => setVapiGroup(activeGroup)} title="Call every lead in this group with the Vapi voice assistant, one after another">📞 Call group</button>
            <button className="btn" onClick={() => {
              const name = prompt('Rename group:', activeGroup.name);
              if (!name || !name.trim() || name.trim() === activeGroup.name) return;
              api.renameGroup(activeGroup.groupId, name.trim()).catch(() => {});
              setActiveGroup({ ...activeGroup, name: name.trim() });
            }}>✎ Rename</button>
            <button className="btn" onClick={() => {
              if (!confirm(`Delete group "${activeGroup.name}"? The leads themselves stay.`)) return;
              api.deleteGroup(activeGroup.groupId).catch(() => {});
              setActiveGroup(null); setView('groups');
            }}>🗑 Delete group</button>
          </div>
        )}
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
              <GroupPickBtn label="🗂 Group" keys={() => [...rowSel].map((id) => id.slice(id.indexOf('|') + 1))} onDone={() => setRowSel(new Set())} />
              {activeGroup && <button className="chipbtn" onClick={async () => {
                const keys = [...rowSel].map((id) => id.slice(id.indexOf('|') + 1));
                await api.removeFromGroup(activeGroup.groupId, keys).catch(() => {});
                setRowSel(new Set()); setReloadKey((k) => k + 1);
              }}>✕ Remove from group</button>}
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

        <div className="filters filters-sel">
          <div className="fsel-combo"><ComboFilter value={typeSel} options={projFacets.types} placeholder="All business types" onChange={(v) => setSelTypes(v ? [v] : [])} /></div>
          <select className="select fsel" value={selCountry} disabled={!hydrated} onChange={(e) => { setSelCountry(e.target.value); setSelRegions([]); }} title="Country the search was run in">
            <option value="">All countries</option>
            {countryOpts.map(([c, n]) => <option key={c} value={c}>{c} ({n.toLocaleString()})</option>)}
          </select>
          <div className="fsel-combo"><ComboFilter value={regionSel} options={selCountry ? projFacets.regions.filter((r) => (parseProjectGeo('x ' + r)?.country || 'Other') === selCountry) : projFacets.regions} placeholder="All states / cities" onChange={(v) => setSelRegions(v ? [v] : [])} /></div>
          <select className="select fsel" value={emailF} onChange={(e) => setEmailF(e.target.value)} title="Email status of the lead">
            <option value="">Email: any</option>
            <option value="has">Has email</option>
            <option value="none">No email</option>
            <option value="miss">Searched, not found (all)</option>
            <option value="todo">No email — website not checked yet</option>
            <option value="checked">No email — website checked, none on it</option>
            <option value="failed">No email — website could not be read</option>
          </select>
          <select className="select fsel" value={phoneF} onChange={(e) => setPhoneF(e.target.value)}>
            <option value="">Phone: any</option>
            <option value="has">Has phone</option>
            <option value="none">No phone</option>
          </select>
          {(typeSel || regionSel || selCountry || emailF || phoneF) && (
            <button className="chipbtn" onClick={() => { setSelTypes([]); setSelRegions([]); setSelCountry(''); setEmailF(''); setPhoneF(''); }}>✕ Clear filters</button>
          )}
        </div>

        {(activeFolder || activeProject) && (
          <div className="widgets-scope">
            Stats for <b>{scopeName}</b> — <button className="linkbtn" onClick={() => { setActiveFolder(null); setActiveProject(null); }}>show all {globalTotal.toLocaleString()} leads</button>
          </div>
        )}
        {!hydrated && (
          <section className="widgets">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="widget" key={i}><div className="skel-bar" style={{ height: 26, width: '55%' }} /><div className="skel-bar" style={{ height: 11, width: '40%', marginTop: 9 }} /></div>
            ))}
          </section>
        )}
        {hydrated && <section className="widgets">
          <div className="widget"><span className="w-ic blue">📋</span><div className="w-body"><div className="w-num">{fmtNum(stats.total)}</div><div className="w-label">{(activeFolder || activeProject) ? 'Leads in view' : 'Total leads'}</div></div></div>
          <div className="widget"><span className="w-ic rose">🚫</span><div className="w-body"><div className="w-num rose">{fmtNum(stats.noweb)}</div><div className="w-label">No website</div></div></div>
          <div className="widget"><span className="w-ic amber">🔥</span><div className="w-body"><div className="w-num amber">{fmtNum(stats.hot)}</div><div className="w-label">Hot leads</div></div></div>
          <div className="widget"><span className="w-ic green">💬</span><div className="w-body"><div className="w-num green">{fmtNum(stats.reviews)} <span className="w-sub">({fmtNum(stats.reviewsSum)})</span></div><div className="w-label">Has reviews</div></div></div>
          <div className="widget"><span className="w-ic violet">✨</span><div className="w-body"><div className="w-num violet">{fmtNum(stats.ai)}</div><div className="w-label">Has AI Analysis</div></div></div>
          <button className={`widget w-split ${emailBusy ? 'busy' : ''}`} onClick={refreshEmailTile} disabled={emailBusy}
            title="Click to re-count these two numbers from the database. Top: leads that have an email. Bottom: leads whose website was searched and no email was found. Leads not searched yet are in neither.">
            <span className="w-half has">
              <span className="w-half-n">{emailBusy ? <span className="w-half-load" /> : fmtNum(emailTile.email)}</span>
              <span className="w-half-l">✉ have email{!emailBusy && emailTile.email + emailTile.miss ? ` · ${Math.round((emailTile.email / (emailTile.email + emailTile.miss)) * 100)}% of searched` : ''}</span>
            </span>
            <span className="w-half none">
              <span className="w-half-n">{emailBusy ? <span className="w-half-load" /> : fmtNum(emailTile.miss)}</span>
              <span className="w-half-l">searched, not found{emailBusy ? ' · counting…' : ''}</span>
            </span>
            <span className="w-split-ic">{emailBusy ? '' : '⟳'}</span>
          </button>
        </section>}

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
          {loading && pageRows.length === 0 && Array.from({ length: 14 }).map((_, i) => <div key={i} className="skel-bar" style={{ height: 42, marginBottom: 6, opacity: Math.max(0.25, 1 - i * 0.06) }} />)}
          {!loading && loadError && (
            <div className="empty">Could not load leads. Use ⟳ Refresh to try again.</div>
          )}
          {!loading && !loadError && pageRows.length === 0 && (
            <div className="empty">No leads here. Sync from the GridLeads extension, or use ⤴ Import to load a JSON export.</div>
          )}
        </section>

        <footer className="foot pager">
          <span>{loading ? 'Loading…' : total === null ? 'Counting…' : `${total.toLocaleString()} leads`}</span>
          <div className="pager-ctrls">
            <label className="muted">Rows:&nbsp;
              <select className="pager-size" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="pgbtn" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
            <button className="pgbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span className="muted">Page {page}{pageCount !== null ? ` / ${pageCount}` : ''}</span>
            <button className="pgbtn" disabled={isLastPage} onClick={() => setPage((p) => p + 1)}>Next ›</button>
            <button className="pgbtn" disabled={pageCount === null || page >= pageCount} onClick={() => { if (pageCount !== null) setPage(pageCount); }}>»</button>
          </div>
        </footer>
        </>}
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}

      {infoFolder && <FolderInfoModal name={infoFolder.name} cities={infoFolder.cities} names={infoFolder.names} regions={infoFolder.regions} folderCount={infoFolder.folderCount} projectCount={infoFolder.projectCount} onClose={() => setInfoFolder(null)} />}

      {organizeOpen && <OrganizeModal onClose={() => setOrganizeOpen(false)} onDone={() => { actions.refresh().catch(() => {}); setReloadKey((k) => k + 1); }} />}

      {vapiGroup && <VapiCallModal group={vapiGroup} onClose={() => setVapiGroup(null)} />}

      {enrollOpen && <EnrollModal
        query={{ project: activeProject, folder: activeFolder, group: activeGroup?.groupId, filter, search: debTerm, categories: selectedCats, ptypes: selTypes, pregions: selRegions, country: selCountry, email: emailF, phone: phoneF }}
        filterLabel={total === null ? 'the leads listed now' : `${total.toLocaleString()} leads listed now`}
        checkedCount={checkedCount} group={activeGroup}
        onClose={() => setEnrollOpen(false)} onDone={() => setReloadKey((k) => k + 1)} />}

      {leadSearch && <LeadSearchModal scope={leadSearch} onClose={() => setLeadSearch(null)}
        onUpdated={() => { setReloadKey((k) => k + 1); actions.refresh().catch(() => {}); }} />}

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
