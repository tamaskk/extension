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
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // (re)load the category list whenever the scope changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getCategories({ project, folder })
      .then((r) => { if (!cancelled) setCats(r.categories || []); })
      .catch(() => { if (!cancelled) setCats([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, folder]);

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
            <span className="muted">{loading ? 'Loading…' : `${cats.length} categories`}</span>
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
            {!loading && !shown.length && <div className="muted cf-empty">No categories{q ? ' match' : ''}.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
