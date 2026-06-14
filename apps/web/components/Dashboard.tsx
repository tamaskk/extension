'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGrid, downloadJson, downloadText, exportCsv, bundleToRows } from '@/lib/store';
import { api } from '@/lib/api';
import { type LeadRow, type ProjectSummary, type WebsiteStatus } from '@/lib/types';
import DuplicatesModal from './DuplicatesModal';
import ImportModal from './ImportModal';

type SortType = 'has' | 'str' | 'num' | 'temp';
const SORTABLE: Record<string, SortType> = {
  checked: 'has', name: 'str', category: 'str', rating: 'num', reviewCount: 'num',
  phone: 'has', email: 'has', websiteStatus: 'str',
  opportunityScore: 'num', leadScore: 'num', leadTemperature: 'temp', address: 'str',
};
const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : 1);
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

const DROPDOWN_SORT: Record<string, [string, number]> = {
  opportunity_desc: ['opportunityScore', -1], score_desc: ['leadScore', -1],
  rating_desc: ['rating', -1], rating_asc: ['rating', 1],
  reviews_desc: ['reviewCount', -1], name_asc: ['name', 1],
};
const COLUMNS = [
  { key: 'checked', label: 'Checked' }, { key: 'name', label: 'Business' }, { key: 'category', label: 'Category' },
  { key: 'rating', label: '★' }, { key: 'reviewCount', label: 'Reviews' }, { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' }, { key: 'websiteStatus', label: 'Website' }, { key: 'opportunityScore', label: 'Opportunity' },
  { key: 'leadTemperature', label: 'Temp' }, { key: 'address', label: 'Location' },
];

export default function Dashboard() {
  const folders = useGrid((s) => s.folders);
  const summaries = useGrid((s) => s.summaries);
  const hydrated = useGrid((s) => s.hydrated);
  const actions = useGrid((s) => s);

  const [mounted, setMounted] = useState(false);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'nowebsite' | 'haswebsite' | 'hot' | 'email'>('all');
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [sortKey, setSortKey] = useState('opportunityScore');
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowSel, setRowSel] = useState<Set<string>>(new Set());
  const [sidebarW, setSidebarW] = useState(264);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageRows, setPageRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const lastChecked = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const saved = parseInt(localStorage.getItem('gridleads_sw') || '', 10);
    if (saved >= 200 && saved <= 560) setSidebarW(saved);
    useGrid.getState().hydrate().catch(() => {});
  }, []);

  // debounce the search box
  useEffect(() => { const t = setTimeout(() => setDebTerm(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  // any change that affects the result set goes back to page 1
  useEffect(() => { setPage(1); }, [activeProject, activeFolder, filter, debTerm, sortKey, sortDir, pageSize]);

  // ----- server-side page fetch -----
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setLoading(true);
    api.getLeads({ project: activeProject, folder: activeFolder, filter, search: debTerm, sort: sortKey, dir: sortDir, page, pageSize })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows || []).map((r: any) => ({ ...r, _project: r.project, _key: r.dedupKey })) as LeadRow[];
        setPageRows(rows);
        setTotal(res.total || 0);
      })
      .catch(() => { if (!cancelled) { setPageRows([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrated, activeProject, activeFolder, filter, debTerm, sortKey, sortDir, page, pageSize, reloadKey]);

  const summariesArr = useMemo(() => Object.values(summaries), [summaries]);
  const folderList = useMemo(() => Object.values(folders), [folders]);

  // ----- sidebar tree -----
  const tree = useMemo(() => {
    const byId: Record<string, boolean> = {};
    folderList.forEach((f) => { byId[f.id] = true; });
    const grouped: Record<string, ProjectSummary[]> = {};
    const ungrouped: ProjectSummary[] = [];
    summariesArr.forEach((p) => {
      if (p.folderId && byId[p.folderId]) (grouped[p.folderId] = grouped[p.folderId] || []).push(p);
      else ungrouped.push(p);
    });
    const order: string[] = [];
    const blocks: { folder?: typeof folderList[number]; projects: ProjectSummary[] }[] = [];
    folderList.slice().sort(byCreated).forEach((f) => {
      const fp = (grouped[f.id] || []).sort(byCreated);
      blocks.push({ folder: f, projects: fp });
      if (!f.collapsed) fp.forEach((p) => order.push(p.query));
    });
    const ung = ungrouped.sort(byCreated);
    blocks.push({ projects: ung });
    ung.forEach((p) => order.push(p.query));
    return { blocks, order };
  }, [summariesArr, folderList]);

  // ----- widgets (full scope, from summaries) -----
  const stats = useMemo(() => {
    const scope = activeFolder ? summariesArr.filter((p) => p.folderId === activeFolder)
      : activeProject ? (summaries[activeProject] ? [summaries[activeProject]] : [])
      : summariesArr;
    const total = scope.reduce((s, p) => s + p.total, 0);
    const noweb = scope.reduce((s, p) => s + p.noWebsite, 0);
    const hot = scope.reduce((s, p) => s + p.hot, 0);
    const email = scope.reduce((s, p) => s + p.email, 0);
    const oppSum = scope.reduce((s, p) => s + (p.oppSum || 0), 0);
    return { total, noweb, hot, email, avg: total ? Math.round(oppSum / total) : 0 };
  }, [activeProject, activeFolder, summaries, summariesArr]);

  const title = activeFolder ? `📁 ${folders[activeFolder]?.name || 'Folder'}`
    : activeProject === null ? 'All leads'
    : (summaries[activeProject]?.name || activeProject);
  const totalAll = summariesArr.reduce((s, p) => s + p.total, 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // ----- selection (sidebar projects) -----
  const toggleSelect = (q: string, checked: boolean, shift: boolean) => {
    const next = new Set(selected);
    if (shift && lastChecked.current) {
      const a = tree.order.indexOf(lastChecked.current);
      const b = tree.order.indexOf(q);
      if (a !== -1 && b !== -1) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) { if (checked) next.add(tree.order[i]); else next.delete(tree.order[i]); } }
    } else if (checked) next.add(q); else next.delete(q);
    lastChecked.current = q;
    setSelected(next);
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
  const refreshAll = () => { actions.refresh().catch(() => {}); setReloadKey((k) => k + 1); };

  if (!mounted) return null;
  if (!hydrated) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--muted)' }}>Loading from database…</div>;

  return (
    <div className="app" style={{ '--sw': `${sidebarW}px` } as React.CSSProperties}>
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">◧ GridLeads</div>
        <div className="side-h">
          <span>Projects</span>
          <span className="side-tools">
            <button className="mini" title="New folder" onClick={() => { const n = prompt('Folder name:'); if (n && n.trim()) actions.createFolder(n.trim()); }}>＋</button>
            <button className="mini" title="Import JSON" onClick={() => setImportOpen(true)}>⤴</button>
            <button className="mini" title="Export all (JSON)" onClick={() => exportJsonScope({}, 'all')}>⤓</button>
          </span>
        </div>

        {selected.size > 0 && (
          <div className="bulkbar">
            <div className="bulk-row"><b>{selected.size}</b>&nbsp;selected <span className="bulk-clear" onClick={() => setSelected(new Set())}>clear</span></div>
            <div className="bulk-row">
              <select className="bulk-select" value="" onChange={(e) => { const v = e.target.value; if (v) moveSelected(v === '__root__' ? null : v); }}>
                <option value="">Move to…</option>
                <option value="__root__">↥ Ungrouped (root)</option>
                {folderList.slice().sort(byCreated).map((f) => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
              </select>
            </div>
            <div className="bulk-row">
              <button className="mini" onClick={() => { const n = prompt(`Rename ${selected.size} selected project(s) to:`); if (n && n.trim()) { actions.renameProjects([...selected], n.trim()); setSelected(new Set()); } }}>Rename</button>
              <button className="mini" onClick={() => exportJsonScope({ queries: [...selected] }, `${selected.size}-projects`)}>Export</button>
              <button className="mini danger" onClick={() => { if (confirm(`Delete ${selected.size} selected project(s) and all their leads?`)) { actions.deleteProjects([...selected]); setSelected(new Set()); setReloadKey((k) => k + 1); } }}>Delete</button>
            </div>
          </div>
        )}

        <nav className="nav">
          <div className={`navitem all ${activeProject === null && activeFolder === null ? 'active' : ''}`} onClick={() => { setActiveProject(null); setActiveFolder(null); }}>
            <span className="ni-name">All leads</span><span className="badge">{totalAll}</span>
          </div>
          {tree.blocks.map((block, bi) => (
            <div key={block.folder ? block.folder.id : `ung-${bi}`}>
              {block.folder && (
                <div className={`folder ${activeFolder === block.folder.id ? 'active' : ''}`} onClick={() => { setActiveFolder(block.folder!.id); setActiveProject(null); }}>
                  <span className="caret" onClick={(e) => { e.stopPropagation(); actions.setFolderCollapsed(block.folder!.id, !block.folder!.collapsed); }}>{block.folder.collapsed ? '▸' : '▾'}</span>
                  <span className="fname" title={block.folder.name}>📁 {block.folder.name}</span>
                  <span className="ni-right">
                    <span className="badge">{block.projects.reduce((s, p) => s + p.total, 0)}</span>
                    <span className="fexport" title="Export folder (JSON)" onClick={(e) => { e.stopPropagation(); exportJsonScope({ folderId: block.folder!.id }, block.folder!.name); }}>⤓</span>
                    <span className="fedit" onClick={(e) => { e.stopPropagation(); const n = prompt('Rename folder:', block.folder!.name); if (n && n.trim()) actions.renameFolder(block.folder!.id, n.trim()); }}>✎</span>
                    <span className="fdel" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this folder? Its projects move back to ungrouped (leads kept).')) actions.deleteFolder(block.folder!.id); }}>✕</span>
                  </span>
                </div>
              )}
              {(!block.folder || !block.folder.collapsed) && block.projects.map((p) => (
                <div key={p.query} className={`navitem proj ${activeProject === p.query ? 'active' : ''}`} onClick={() => { setActiveProject(p.query); setActiveFolder(null); }}>
                  <input type="checkbox" className="proj-check" checked={selected.has(p.query)} onChange={() => {}} onClick={(e) => { e.stopPropagation(); toggleSelect(p.query, !selected.has(p.query), e.shiftKey); }} />
                  <span className="ni-name" title={p.name}>{p.name}</span>
                  <span className="ni-right">
                    <span className={`badge ${p.noWebsite ? 'accent' : ''}`}>{p.total}</span>
                    <span className="edit" onClick={(e) => { e.stopPropagation(); const n = prompt('Rename project:', p.name); if (n && n.trim()) actions.renameProject(p.query, n.trim()); }}>✎</span>
                    <span className="del" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete project "${p.query}" and all its leads?`)) { actions.deleteProject(p.query); setSelected((s) => { const n = new Set(s); n.delete(p.query); return n; }); if (activeProject === p.query) setActiveProject(null); setReloadKey((k) => k + 1); } }}>✕</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
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
          <button className="btn" onClick={() => setDupesOpen(true)}>⧉ Duplicates</button>
          <button className="btn" onClick={() => exportJsonScope(activeProject ? { queries: [activeProject] } : {}, activeProject || 'all')}>⤓ Export JSON</button>
          <button className="btn primary" onClick={() => exportCsvScope(activeProject ? { queries: [activeProject] } : {}, activeProject || 'all')}>⤓ Export CSV</button>
        </header>

        <div className="filters">
          {([['all', 'All'], ['nowebsite', 'No website'], ['haswebsite', 'Has website'], ['hot', '🔥 Hot'], ['email', 'Email found']] as const).map(([key, label]) => (
            <button key={key} className={`chipbtn ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
          <div className="spacer" />
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
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`sortable ${sortKey === c.key ? 'active' : ''}`} onClick={() => clickHeader(c.key)}>
                    {c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th>Maps</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const id = `${r._project}|${r._key}`;
                const opp = r.opportunityScore || 0;
                return (
                  <tr key={id} title={r.topPitch || undefined}>
                    <td className="cb"><input type="checkbox" className="selcheck" checked={rowSel.has(id)} onChange={(e) => setRowSel((s) => { const n = new Set(s); if ((e.target as HTMLInputElement).checked) n.add(id); else n.delete(id); return n; })} /></td>
                    <td className="cb"><input type="checkbox" className="rowcheck" checked={!!r.checked} onChange={(e) => setChecked(r, (e.target as HTMLInputElement).checked)} /></td>
                    <td className="bizname" title={r.name}>{r.name}</td>
                    <td className="muted">{r.category}</td>
                    <td>{r.rating ?? '—'}</td>
                    <td className="muted">{r.reviewCount ?? '—'}</td>
                    <td>{r.phone || <span className="muted">—</span>}</td>
                    <td>{r.email || <span className="muted">—</span>}</td>
                    <td>{r.website ? <a className="mlink" href={r.website} target="_blank" rel="noreferrer"><StatusChip s={r.websiteStatus} /></a> : <StatusChip s={r.websiteStatus} />}</td>
                    <td><div className="opp"><div className="track"><div className="fill" style={{ width: `${opp}%` }} /></div><div className="val">{opp}</div></div></td>
                    <td><span className={`temp ${r.leadTemperature}`}>{r.leadTemperature || ''}</span></td>
                    <td className="muted loc" title={r.address || ''}>{r.address || ''}</td>
                    <td>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">open ↗</a> : ''}</td>
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
