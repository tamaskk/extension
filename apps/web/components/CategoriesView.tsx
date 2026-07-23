'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import CategoryLeadsModal from './CategoryLeadsModal';

type CatRow = { category: string; count: number; projects: number };
type SortCol = 'category' | 'count' | 'projects';

// Categories tab: every category with lead + project counts; click → the
// category's leads in a modal.
export default function CategoriesView() {
  const [rows, setRows] = useState<CatRow[]>([]);
  const [at, setAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0); // chunks done
  const [term, setTerm] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('count');
  const [sortDir, setSortDir] = useState(-1);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => api.getCategorySummary().then((r) => {
    if (!r.ok) return;
    setRows(r.rows || []); setAt(r.at || 0); setStale(!!r.stale);
    return r;
  });
  useEffect(() => {
    load().then((r) => {
      if (r && !(r.rows || []).length) rebuild(); // first ever visit → build the table
    }).catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // chunked rebuild — each request covers a slice of the project keyspace
  const rebuild = async () => {
    if (building) return;
    setBuilding(true); setProgress(0);
    try {
      let after: string | null | undefined; let runAt: number | undefined;
      for (;;) {
        const res = await api.refreshCategorySummary({ after, at: runAt });
        if (!res?.ok) throw new Error(res?.error || 'rebuild failed');
        if (res.done) break;
        after = res.after; runAt = res.at;
        setProgress((p) => p + 1);
      }
      await load();
    } catch { /* keep whatever we have */ }
    finally { setBuilding(false); }
  };

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.category.toLowerCase().includes(t)) : rows;
    const dir = sortDir;
    return [...f].sort((a, b) => {
      if (sortCol === 'category') return a.category.localeCompare(b.category) * dir;
      return (a[sortCol] - b[sortCol]) * dir;
    });
  }, [rows, term, sortCol, sortDir]);

  const clickCol = (c: SortCol) => {
    if (sortCol === c) setSortDir((d) => -d);
    else { setSortCol(c); setSortDir(c === 'category' ? 1 : -1); }
  };
  const arrow = (c: SortCol) => (sortCol === c ? (sortDir === 1 ? ' ▲' : ' ▼') : '');

  const totals = useMemo(() => shown.reduce((a, r) => { a.count += r.count; return a; }, { count: 0 }), [shown]);

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🏷 Categories</div>
        <span className="muted">{loading ? '' : `${rows.length.toLocaleString()} categories`}{at ? ` · updated ${new Date(at).toLocaleString()}` : ''}{stale && !building ? ' · stale' : ''}</span>
        <div className="spacer" />
        <input className="search cats-search" type="search" placeholder="Filter categories…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn" onClick={rebuild} disabled={building}>{building ? `⏳ Counting… (${progress})` : '⟳ Refresh'}</button>
      </div>
      {loading && <div className="empty" style={{ padding: 30 }}>Loading…</div>}
      {!loading && building && !rows.length && <div className="empty" style={{ padding: 30 }}>Counting every category across all leads — first build takes a minute…</div>}
      {shown.length > 0 && (
        <div className="tablewrap">
          <table className="table calls-table cats-table">
            <thead><tr>
              <th className="sortable" onClick={() => clickCol('category')}>Category{arrow('category')}</th>
              <th className="sortable" onClick={() => clickCol('count')}>Leads{arrow('count')}</th>
              <th className="sortable" onClick={() => clickCol('projects')}>Projects{arrow('projects')}</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.category} className="cats-row" onClick={() => setOpen(r.category)}>
                  <td className="bizname">{r.category}</td>
                  <td>{r.count.toLocaleString()}</td>
                  <td className="muted">{r.projects.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="muted">Σ {shown.length.toLocaleString()} shown</td><td className="muted">{totals.count.toLocaleString()}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      {open && <CategoryLeadsModal category={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
