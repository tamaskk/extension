'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow, ReviewRow } from '@/lib/types';

function Stars({ n }: { n: number | null | undefined }) {
  const r = Math.round(n || 0);
  return <span className="rv-stars" title={`${n ?? '?'} / 5`}>{'★'.repeat(r)}<span className="rv-stars-off">{'★'.repeat(Math.max(0, 5 - r))}</span></span>;
}

export default function ReviewsModal({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.getReviews(lead.dedupKey)
      .then((r) => { if (!cancelled) { if (r.ok) setRows(r.rows || []); else setError('Could not load reviews'); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Could not load reviews'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lead.dedupKey]);

  const avg = rows.length ? (rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.filter((r) => r.rating != null).length || 0) : 0;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">💬 Reviews — {lead.name}</div>
            <div className="modal-sub">
              {loading ? 'Loading…'
                : error ? error
                : rows.length ? `${rows.length} review${rows.length === 1 ? '' : 's'} stored · avg ${avg.toFixed(1)}★${lead.reviewCount ? ` · Google reports ${lead.reviewCount.toLocaleString()}` : ''}`
                : 'No reviews stored for this business yet.'}
            </div>
          </div>
          <div className="modal-actions">
            {lead.mapsUrl && <a className="btn" href={lead.mapsUrl} target="_blank" rel="noreferrer">Open in Maps ↗</a>}
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        <div className="modal-body">
          {loading ? <div className="muted" style={{ padding: 24 }}>Loading reviews…</div>
            : error ? <div className="empty" style={{ padding: 24, color: '#f87171' }}>⚠ {error}</div>
            : !rows.length ? <div className="empty" style={{ padding: 24 }}>Nothing here yet — run the Review Scraper extension to collect reviews.</div>
            : (
              <div className="rv-list">
                {rows.map((r, i) => (
                  <div key={r.reviewId || i} className="rv-item">
                    <div className="rv-top">
                      {r.authorUrl ? <a className="rv-author" href={r.authorUrl} target="_blank" rel="noreferrer">{r.author || 'Anonymous'}</a> : <span className="rv-author">{r.author || 'Anonymous'}</span>}
                      <Stars n={r.rating} />
                      <span className="rv-time">{r.relativeTime || ''}</span>
                    </div>
                    {r.text && <div className="rv-text">{r.text}</div>}
                    {r.ownerResponse && <div className="rv-owner"><b>Owner response:</b> {r.ownerResponse}</div>}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
