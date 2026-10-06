'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Scope-aware multi-select of categories. Lists the distinct categories within the
// active project / folder / all, and lets you pick which ones the table shows.
export default function CategoryFilter({ project, folder, value, onChange }:
  { project: string | null; folder: string | null; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<{ category: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // lists already fetched, by scope — reopening the dropdown costs no request
  const loaded = useRef(new Map<string, { category: string; count: number }[]>());
  const scopeKey = `${project || ''}|${folder || ''}`;

  // another scope → the list on screen no longer applies
  useEffect(() => { setCats(loaded.current.get(scopeKey) || []); setFailed(false); }, [scopeKey]);

  // Load the list only when the dropdown is opened. For "all leads" this is a
  // $group over the whole collection (seconds); it used to run on every
  // dashboard load whether or not anyone looked at it.
  useEffect(() => {
    if (!open || loaded.current.has(scopeKey)) return;
    let cancelled = false;
    setLoading(true); setFailed(false);
    api.getCategories({ project, folder })
      .then((r) => {
        if (cancelled) return;
        if ('error' in r) { setFailed(true); return; } // the route answers { categories: [], error } on failure
        loaded.current.set(scopeKey, r.categories || []);
        setCats(r.categories || []);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; setLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const sel = useMemo(() => new Set(value), [value]);
  const shown = useMemo(() => cats.filter((c) => c.category.toLowerCase().includes(q.trim().toLowerCase())), [cats, q]);
  const toggle = (c: string) => { const n = new Set(sel); if (n.has(c)) n.delete(c); else n.add(c); onChange([...n]); };
  const allShown = () => onChange([...new Set([...value, ...shown.map((c) => c.category)])]);

  return (
    <div className="catfilter" ref={ref}>
      <button className={`btn ${value.length ? 'primary' : ''}`} onClick={() => setOpen((o) => !o)} title="Filter by category">
        🏷 Categories{value.length ? ` (${value.length})` : ''}
      </button>
      {open && (
        <div className="catfilter-pop" onClick={(e) => e.stopPropagation()}>
          <input className="catfilter-search" placeholder="Search categories…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="catfilter-bar">
            <span className="muted">{loading ? 'Loading…' : failed ? 'Not loaded' : `${cats.length} categories`}</span>
            <span className="catfilter-links">
              {shown.length > 0 && <button className="cf-link" onClick={allShown}>Select shown</button>}
              {value.length > 0 && <button className="cf-link" onClick={() => onChange([])}>Clear</button>}
            </span>
          </div>
          <div className="catfilter-list">
            {!loading && shown.map((c) => (
              <label key={c.category} className="catfilter-row">
                <input type="checkbox" checked={sel.has(c.category)} onChange={() => toggle(c.category)} />
                <span className="cf-name" title={c.category}>{c.category}</span>
                <span className="cf-count">{c.count.toLocaleString()}</span>
              </label>
            ))}
            {!loading && failed && <div className="muted cf-empty">Could not load categories.</div>}
            {!loading && !failed && !shown.length && <div className="muted cf-empty">No categories{q ? ' match' : ''}.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
