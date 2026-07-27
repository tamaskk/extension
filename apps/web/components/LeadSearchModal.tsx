'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type QueueRow = {
  project: string; dedupKey: string; name: string; address: string; phone: string; category: string;
  status: 'pending' | 'searching' | 'found' | 'none' | 'failed';
  email?: string; owner?: string; source?: string; error?: string;
};

// Automated email research for every email-less lead in the current scope.
// One OpenAI web-search request per lead, driven from the browser so the run
// can be stopped between leads at any time.
export default function LeadSearchModal({ scope, onClose, onUpdated }:
  { scope: { project?: string | null; folder?: string | null; label: string }; onClose: () => void; onUpdated: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const runRef = useRef(false);
  const foundCount = rows.filter((r) => r.status === 'found').length;
  const doneCount = rows.filter((r) => r.status !== 'pending' && r.status !== 'searching').length;

  useEffect(() => {
    let cancelled = false;
    api.getLeadSearchQueue({ project: scope.project, folder: scope.folder })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) { setLoadErr(r.error || 'Loading the queue failed.'); return; }
        setRows((r.rows || []).map((x) => ({ ...x, status: 'pending' as const })));
        setCapped(!!r.capped);
      })
      .catch(() => setLoadErr('Loading the queue failed.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; runRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upd = (i: number, patch: Partial<QueueRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const start = async () => {
    if (runRef.current) return;
    runRef.current = true; setRunning(true);
    let updated = false;
    for (let i = 0; i < rows.length; i++) {
      if (!runRef.current) break;
      let skip = false;
      setRows((rs) => { skip = rs[i].status !== 'pending'; return rs; });
      if (skip) continue;
      upd(i, { status: 'searching' });
      try {
        const r = await api.leadSearchOne(rows[i].project, rows[i].dedupKey);
        if (!r.ok) { upd(i, { status: 'failed', error: r.error || 'failed' }); continue; }
        if (r.found && r.email) { upd(i, { status: 'found', email: r.email, owner: r.owner, source: r.source }); updated = true; }
        else upd(i, { status: 'none' });
      } catch (e: any) { upd(i, { status: 'failed', error: e?.message || 'failed' }); }
    }
    runRef.current = false; setRunning(false);
    if (updated) onUpdated();
  };

  const stop = () => { runRef.current = false; };
  const close = () => {
    if (running && !confirm('A search run is in progress — stop and close?')) return;
    runRef.current = false;
    if (foundCount) onUpdated();
    onClose();
  };

  const CHIP: Record<QueueRow['status'], [string, string]> = {
    pending: ['gray', 'pending'], searching: ['blue', 'searching…'], found: ['green', 'found'],
    none: ['amber', 'no email found'], failed: ['red', 'failed'],
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🔎 Lead search: {scope.label}</div>
            <div className="modal-sub">
              {loading ? 'Loading…' : `${rows.length.toLocaleString()} lead(s) without email${capped ? ' (first 1000)' : ''}${doneCount ? ` · ${doneCount} done · ${foundCount} found` : ''}`}
            </div>
          </div>
          <div className="modal-actions">
            {!running && <button className="btn primary" onClick={start} disabled={loading || !rows.some((r) => r.status === 'pending')}>▶ Start search</button>}
            {running && <button className="btn" onClick={stop}>⏹ Stop after current</button>}
            <button className="btn" onClick={close}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {loadErr && <div className="vapi-warn">⚠ {loadErr}</div>}
          {running && <div className="vapi-warn info">Keep this tab open — one web-search request per lead (~5–15s each). Found emails are saved onto the leads immediately.</div>}
          {!loading && !rows.length && !loadErr && <div className="empty" style={{ padding: 30 }}>Every lead in this scope already has an email (or was searched before).</div>}
          {rows.length > 0 && (
            <table className="table calls-table">
              <thead><tr><th>#</th><th>Business</th><th>Category</th><th>Location</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const [cls, label] = CHIP[r.status];
                  return (
                    <tr key={r.dedupKey} className={r.status === 'searching' ? 'vapi-live' : ''}>
                      <td className="muted">{i + 1}</td>
                      <td className="bizname" title={r.name}>{r.name}</td>
                      <td className="muted">{r.category}</td>
                      <td className="muted" title={r.address}>{r.address}</td>
                      <td><span className={`chip ${cls}`}>{label}</span></td>
                      <td>{r.status === 'found' ? <span>{r.email}{r.owner ? <span className="muted"> · {r.owner}</span> : ''}</span> : <span className="muted">{r.error || (r.source || '')}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
