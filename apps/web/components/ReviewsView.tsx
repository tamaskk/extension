'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ReviewListRow } from '@/lib/api';
import { COUNTRY_REGIONS, STATE_REGIONS } from '@/lib/regionNames';

function Stars({ n }: { n: number | null }) {
  const r = Math.round(n || 0);
  if (!n) return <span className="rv-nostars">—</span>;
  return <span className="rvv-stars" title={`${n}★`}>{'★'.repeat(r)}<span className="rvv-stars-off">{'★'.repeat(5 - r)}</span></span>;
}

// region (last word(s)) of a project query, for the little location chip
function regionOf(project: string) {
  const s = String(project || '').trim(); if (!s) return '';
  const ni = s.toLowerCase().indexOf(' near ');
  return ni >= 0 ? s.slice(ni + 6) : s;
}

export default function ReviewsView() {
  const [country, setCountry] = useState('');
  const [uState, setUState] = useState('');
  const [city, setCity] = useState('');
  const [debCity, setDebCity] = useState('');
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [biz, setBiz] = useState<{ dedupKey: string; name: string } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<{ rows: ReviewListRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);

  // business autocomplete
  const [bizQuery, setBizQuery] = useState('');
  const [bizOpts, setBizOpts] = useState<{ dedupKey: string; name: string; address: string; reviewsCount: number }[]>([]);
  const [bizOpen, setBizOpen] = useState(false);
  const bizRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebCity(city.trim()), 350); return () => clearTimeout(t); }, [city]);
  useEffect(() => { const t = setTimeout(() => setDebSearch(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [country, uState, debCity, debSearch, biz, pageSize]);

  useEffect(() => {
    let cancel = false; setLoading(true);
    api.getReviewList({ page, pageSize, dedupKey: biz?.dedupKey, country, state: uState, city: debCity, search: debSearch })
      .then((r) => { if (!cancel) setData({ rows: r.rows || [], total: r.total || 0 }); })
      .catch(() => { if (!cancel) setData({ rows: [], total: 0 }); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [page, pageSize, biz, country, uState, debCity, debSearch]);

  useEffect(() => {
    if (!bizOpen) return;
    const t = setTimeout(() => { api.getReviewBusinesses(bizQuery.trim()).then((r) => setBizOpts(r.businesses || [])).catch(() => setBizOpts([])); }, 220);
    return () => clearTimeout(t);
  }, [bizQuery, bizOpen]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (bizRef.current && !bizRef.current.contains(e.target as Node)) setBizOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const pickBiz = (b: { dedupKey: string; name: string }) => { setBiz(b); setBizOpen(false); setBizQuery(''); };
  const anyFilter = country || uState || city || search || biz;
  const clearAll = () => { setCountry(''); setUState(''); setCity(''); setSearch(''); setBiz(null); };

  return (
    <div className="rvv">
      <div className="rvv-filters">
        <div className="rvv-biz" ref={bizRef}>
          {biz ? (
            <div className="rvv-bizchip">💬 {biz.name}<span className="rvv-bizx" onClick={() => setBiz(null)}>✕</span></div>
          ) : (
            <input className="search" placeholder="Filter by business…" value={bizQuery}
              onFocus={() => setBizOpen(true)} onChange={(e) => { setBizQuery(e.target.value); setBizOpen(true); }} />
          )}
          {bizOpen && !biz && (
            <div className="rvv-bizpop">
              {bizOpts.length === 0 && <div className="rvv-bizempty">Type a business name…</div>}
              {bizOpts.map((b) => (
                <div className="rvv-bizopt" key={b.dedupKey} onClick={() => pickBiz(b)}>
                  <div className="rvv-bizname">{b.name}</div>
                  <div className="rvv-bizmeta">{b.reviewsCount} reviews{b.address ? ` · ${b.address}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <select className="select" value={country} onChange={(e) => setCountry(e.target.value)} disabled={!!biz}>
          <option value="">All countries</option>
          {COUNTRY_REGIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={uState} onChange={(e) => setUState(e.target.value)} disabled={!!biz}>
          <option value="">All states</option>
          {STATE_REGIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="search rvv-city" placeholder="City…" value={city} onChange={(e) => setCity(e.target.value)} disabled={!!biz} />
        <input className="search rvv-search" placeholder="Search review text / author…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {anyFilter && <button className="btn" onClick={clearAll}>Clear</button>}
        <div className="rvv-count">{loading ? 'Loading…' : `${data.total.toLocaleString()} reviews`}</div>
      </div>

      <div className="rvv-list">
        {loading && data.rows.length === 0 && <div className="rvv-msg">Loading reviews…</div>}
        {!loading && data.rows.length === 0 && <div className="rvv-msg">No reviews match these filters.</div>}
        {data.rows.map((r) => (
          <div className="rvv-row" key={r.id}>
            <div className="rvv-rowhead">
              <button className="rvv-bizlink" onClick={() => pickBiz({ dedupKey: r.dedupKey, name: r.businessName })} title="Filter to this business">{r.businessName}</button>
              <Stars n={r.rating} />
              {regionOf(r.project) && <span className="rvv-loc">📍 {regionOf(r.project)}</span>}
              <span className="rvv-when">{r.relativeTime || (r.scrapedAt ? new Date(r.scrapedAt).toLocaleDateString() : '')}</span>
            </div>
            {r.text && <div className="rvv-text">{r.text}</div>}
            <div className="rvv-by">{r.author ? `— ${r.author}` : ''}{r.address ? <span className="rvv-addr"> · {r.address}</span> : ''}</div>
            {r.ownerResponse && <div className="rvv-owner"><b>Owner:</b> {r.ownerResponse}</div>}
          </div>
        ))}
      </div>

      <div className="rvv-foot">
        <select className="select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <div className="rvv-pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span className="rvv-pageinfo">Page {page} / {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
          <button className="btn" disabled={page >= pages} onClick={() => setPage(pages)}>»</button>
        </div>
      </div>
    </div>
  );
}
