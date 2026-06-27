'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Facet = { value: string; count: number };

// Filter leads by the project's business-type (prefix) and state/country (suffix).
export default function ProjectFilter({ project, folder, types, regions, onChange }:
  { project: string | null; folder: string | null; types: string[]; regions: string[]; onChange: (types: string[], regions: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ types: Facet[]; regions: Facet[] }>({ types: [], regions: [] });
  const [loading, setLoading] = useState(false);
  const [qt, setQt] = useState('');
  const [qr, setQr] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getProjectFacets({ project, folder })
      .then((r) => { if (!cancelled) setData({ types: r.types || [], regions: r.regions || [] }); })
      .catch(() => { if (!cancelled) setData({ types: [], regions: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, folder]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selT = useMemo(() => new Set(types), [types]);
  const selR = useMemo(() => new Set(regions), [regions]);
  const total = types.length + regions.length;
  const shownTypes = data.types.filter((t) => t.value.toLowerCase().includes(qt.trim().toLowerCase()));
  const shownRegions = data.regions.filter((t) => t.value.toLowerCase().includes(qr.trim().toLowerCase()));
  const toggle = (set: Set<string>, v: string, kind: 'type' | 'region') => {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v);
    if (kind === 'type') onChange([...n], regions); else onChange(types, [...n]);
  };

  return (
    <div className="catfilter" ref={ref}>
      <button className={`btn ${total ? 'primary' : ''}`} onClick={() => setOpen((o) => !o)} title="Filter by business type & state/country">
        🧩 Type/Region{total ? ` (${total})` : ''}
      </button>
      {open && (
        <div className="catfilter-pop projfilter-pop" onClick={(e) => e.stopPropagation()}>
          {loading ? <div className="muted" style={{ padding: 10 }}>Loading…</div> : (
            <div className="pf-cols">
              <div className="pf-col">
                <div className="catfilter-bar"><span className="muted">Business type ({data.types.length})</span>{types.length > 0 && <button className="cf-link" onClick={() => onChange([], regions)}>Clear</button>}</div>
                <input className="catfilter-search" placeholder="Search types…" value={qt} onChange={(e) => setQt(e.target.value)} />
                <div className="catfilter-list">
                  {shownTypes.map((t) => (
                    <label key={t.value} className="catfilter-row">
                      <input type="checkbox" checked={selT.has(t.value)} onChange={() => toggle(selT, t.value, 'type')} />
                      <span className="cf-name" title={t.value}>{t.value}</span><span className="cf-count">{t.count.toLocaleString()}</span>
                    </label>
                  ))}
                  {!shownTypes.length && <div className="muted cf-empty">No types.</div>}
                </div>
              </div>
              <div className="pf-col">
                <div className="catfilter-bar"><span className="muted">State / Country ({data.regions.length})</span>{regions.length > 0 && <button className="cf-link" onClick={() => onChange(types, [])}>Clear</button>}</div>
                <input className="catfilter-search" placeholder="Search regions…" value={qr} onChange={(e) => setQr(e.target.value)} />
                <div className="catfilter-list">
                  {shownRegions.map((t) => (
                    <label key={t.value} className="catfilter-row">
                      <input type="checkbox" checked={selR.has(t.value)} onChange={() => toggle(selR, t.value, 'region')} />
                      <span className="cf-name" title={t.value}>{t.value}</span><span className="cf-count">{t.count.toLocaleString()}</span>
                    </label>
                  ))}
                  {!shownRegions.length && <div className="muted cf-empty">No regions.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
