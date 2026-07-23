'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow, WebsiteStatus } from '@/lib/types';
import ReviewsModal from './ReviewsModal';

const PAGE_SIZE = 50;
const SORTS: Record<string, [string, number, string]> = {
  opportunity_desc: ['opportunityScore', -1, 'Opportunity ↓'],
  rating_desc: ['rating', -1, 'Highest rating'],
  reviews_desc: ['reviewCount', -1, 'Most reviews'],
  name_asc: ['name', 1, 'Name A–Z'],
  date_desc: ['scrapedAt', -1, 'Date: newest'],
};
const STATUS_CHIP: Record<string, [string, string]> = {
  HAS_WEBSITE: ['green', 'Has site'], NO_WEBSITE: ['red', 'No website'],
  FACEBOOK_ONLY: ['blue', 'Facebook only'], INSTAGRAM_ONLY: ['pink', 'Instagram only'],
  BROKEN: ['amber', 'Broken'], DOMAIN_EXPIRED: ['amber', 'Expired'],
  DOMAIN_PARKED: ['amber', 'Parked'], UNDER_CONSTRUCTION: ['amber', 'Under constr.'],
  NOT_WORKING: ['amber', 'Not working'], REDIRECTS: ['amber', 'Redirects'],
};
function Chip({ s }: { s: WebsiteStatus }) {
  const [cls, label] = STATUS_CHIP[s] || ['gray', s || '—'];
  return <span className={`chip ${cls}`}>{label}</span>;
}

// All leads of one category (global scope), in the familiar table shape.
export default function CategoryLeadsModal({ category, onClose }:
  { category: string; onClose: () => void }) {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [sortKey, setSortKey] = useState('opportunity_desc');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LeadRow | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebTerm(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  useEffect(() => { setPage(1); }, [debTerm, sortKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [sort, dir] = SORTS[sortKey] || SORTS.opportunity_desc;
    api.getLeads({ categories: [category], search: debTerm, sort, dir, page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setRows((r.rows || []).map((x: any) => ({ ...x, _project: x.project, _key: x.dedupKey })) as LeadRow[]);
        setTotal(r.total || 0);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, debTerm, sortKey, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🏷 {category}</div>
            <div className="modal-sub">{loading ? 'Loading…' : `${total.toLocaleString()} lead(s) in this category`}</div>
          </div>
          <div className="modal-actions">
            <input className="search catmodal-search" type="search" placeholder="Search in category…" value={term} onChange={(e) => setTerm(e.target.value)} />
            <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {Object.entries(SORTS).map(([k, [, , label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {!loading && !rows.length && <div className="empty" style={{ padding: 30 }}>No leads found.</div>}
          {rows.length > 0 && (
            <table className="table calls-table">
              <thead><tr>
                <th>Business</th><th>★</th><th>Reviews</th><th>Phone</th><th>Email</th><th>Website</th><th>Opp</th><th>Temp</th><th>Location</th><th>Maps</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r._project}|${r._key}`}>
                    <td className="bizname" title={r.name}>
                      {r.name} <span className="bizopen" title="Show details" onClick={() => setDetail(r)}>↗</span>
                    </td>
                    <td>{r.rating ?? '—'}</td>
                    <td className="muted">{r.reviewCount ?? '—'}</td>
                    <td>{r.phone || <span className="muted">—</span>}</td>
                    <td>{r.email || <span className="muted">—</span>}</td>
                    <td><Chip s={r.websiteStatus} /></td>
                    <td>{r.opportunityScore ?? '—'}</td>
                    <td><span className={`temp ${r.leadTemperature}`}>{r.leadTemperature || ''}</span></td>
                    <td className="muted loc" title={r.address || ''}>{r.address || ''}</td>
                    <td>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">map ↗</a> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {pages > 1 && (
          <div className="groups-pager">
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
            <span className="muted">Page {page} / {pages.toLocaleString()}</span>
            <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
          </div>
        )}
      </div>
      {detail && <ReviewsModal key={`${detail._project}|${detail._key}`} lead={detail} initialTab="info" onClose={() => setDetail(null)} />}
    </div>
  );
}
