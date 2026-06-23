'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow } from '@/lib/types';

export default function CallsModal({ onClose, onToggleCall }:
  { onClose: () => void; onToggleCall: (r: LeadRow, call: boolean) => void }) {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCalls().then((res) => {
      if (cancelled) return;
      setRows((res.rows || []).map((r: any) => ({ ...r, _project: r.project, _key: r.dedupKey })) as LeadRow[]);
      setCapped(!!res.capped);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const remove = (r: LeadRow) => {
    setRows((rs) => rs.filter((x) => !(x._project === r._project && x._key === r._key)));
    onToggleCall(r, false); // unflag (persists)
  };

  const exportXlsx = async () => {
    if (!rows.length) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const data = rows.map((r) => ({
        Business: r.name || '', Category: r.category || '', Rating: r.rating ?? '', Reviews: r.reviewCount ?? '',
        Phone: r.phone || '', Email: r.email || '', Website: r.website || '', 'Website status': r.websiteStatus || '',
        Opportunity: r.opportunityScore ?? '', Temperature: r.leadTemperature || '', 'Sales status': r.salesStatus || '',
        'Follow-up': r.salesDate || '', Tags: (r.tags || []).join(', '), Address: r.address || '',
        Maps: r.mapsUrl || '', Project: r._project,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 7 }, { wch: 9 }, { wch: 16 }, { wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 36 }, { wch: 30 }, { wch: 28 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Calls');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      XLSX.writeFile(wb, `gridleads-calls-${stamp}.xlsx`);
    } catch { /* */ } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">📞 Leads to call</div>
            <div className="modal-sub">{loading ? 'Loading…' : `${rows.length.toLocaleString()} flagged${capped ? ' (showing first 50,000)' : ''}`}</div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={exportXlsx} disabled={busy || !rows.length}>{busy ? '…' : '⤓ Export XLSX'}</button>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {!loading && rows.length === 0 && <div className="empty" style={{ padding: 30 }}>No leads flagged for calling yet. Tick the <b>Call</b> column in the table.</div>}
          {rows.length > 0 && (
            <table className="table calls-table">
              <thead><tr>
                <th>Business</th><th>Category</th><th>★</th><th>Reviews</th><th>Phone</th><th>Website</th><th>Opp</th><th>Status</th><th>Maps</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r._project}|${r._key}`}>
                    <td className="bizname" title={r.name}>{r.name}</td>
                    <td className="muted">{r.category}</td>
                    <td>{r.rating ?? '—'}</td>
                    <td className="muted">{r.reviewCount ?? '—'}</td>
                    <td>{r.phone || <span className="muted">—</span>}</td>
                    <td>{r.website ? <a className="mlink" href={r.website} target="_blank" rel="noreferrer">open ↗</a> : <span className="muted">—</span>}</td>
                    <td>{r.opportunityScore ?? '—'}</td>
                    <td className="muted">{r.salesStatus || '—'}</td>
                    <td>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">map ↗</a> : ''}</td>
                    <td><span className="calls-rm" title="Remove from calls" onClick={() => remove(r)}>✕</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
