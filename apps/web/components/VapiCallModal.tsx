'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type QueueRow = {
  dedupKey: string; name: string; phone: string; address: string; e164: string | null;
  status: 'pending' | 'calling' | 'ended' | 'failed' | 'nophone';
  callStatus?: string; endedReason?: string; error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATUS_CHIP: Record<QueueRow['status'], [string, string]> = {
  pending: ['gray', 'pending'], calling: ['blue', 'calling'], ended: ['green', 'done'],
  failed: ['red', 'failed'], nophone: ['amber', 'no phone'],
};

// Sequential Vapi calling of one group: create a call, poll until it ends,
// move to the next lead. The browser drives the loop (serverless can't hold
// it), so keep the tab open while a run is going.
export default function VapiCallModal({ group, onClose }:
  { group: { groupId: string; name: string }; onClose: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [envErr, setEnvErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.getVapiQueue(group.groupId).then((r) => {
      if (cancelled) return;
      if (!r.ok) { setEnvErr(r.error || 'Loading the queue failed.'); return; }
      setEnvErr(r.envError || null);
      setRows((r.rows || []).map((x) => ({ ...x, status: x.e164 ? 'pending' : 'nophone' })));
    }).catch(() => setEnvErr('Loading the queue failed.')).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; runRef.current = false; };
  }, [group.groupId]);

  const upd = (i: number, patch: Partial<QueueRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const start = async () => {
    if (runRef.current) return;
    runRef.current = true; setRunning(true);
    const list = rows; // statuses checked per index at run time via functional reads below
    for (let i = 0; i < list.length; i++) {
      if (!runRef.current) break;
      let skip = false;
      setRows((rs) => { skip = rs[i].status !== 'pending' || !rs[i].e164; return rs; });
      if (skip) continue;
      upd(i, { status: 'calling', callStatus: 'starting…' });
      const res = await api.vapiCall({ phone: list[i].e164!, name: list[i].name, address: list[i].address, dedupKey: list[i].dedupKey }).catch(() => null);
      if (!res?.ok || !res.callId) { upd(i, { status: 'failed', error: res?.error || 'Starting the call failed' }); continue; }
      const callId = res.callId;
      upd(i, { callStatus: res.status || 'queued' });
      for (;;) { // poll until the call ends (or the user stops the run)
        await sleep(4000);
        const st = await api.vapiStatus(callId).catch(() => null);
        if (st?.ok) {
          upd(i, { callStatus: st.status });
          if (st.status === 'ended') { upd(i, { status: 'ended', endedReason: st.endedReason || '' }); break; }
        }
        if (!runRef.current) { upd(i, { status: 'ended', endedReason: 'stopped watching (call may still be live)' }); break; }
      }
    }
    runRef.current = false; setRunning(false);
  };

  const stop = () => { runRef.current = false; };
  const close = () => {
    if (running && !confirm('A calling run is in progress — close anyway? The current call keeps going on Vapi, but the queue stops.')) return;
    runRef.current = false;
    onClose();
  };

  const callable = rows.filter((r) => r.e164).length;
  const done = rows.filter((r) => r.status === 'ended').length;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">📞 Call group: {group.name}</div>
            <div className="modal-sub">
              {loading ? 'Loading…' : `${callable.toLocaleString()} callable · ${(rows.length - callable).toLocaleString()} without a dialable number${done ? ` · ${done} done` : ''}`}
            </div>
          </div>
          <div className="modal-actions">
            {!running && <button className="btn primary" onClick={start} disabled={loading || !!envErr || !rows.some((r) => r.status === 'pending' && r.e164)}>▶ Start calling</button>}
            {running && <button className="btn" onClick={stop}>⏹ Stop after current</button>}
            <button className="btn" onClick={close}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {envErr && <div className="vapi-warn">⚠ {envErr}</div>}
          {running && <div className="vapi-warn info">Keep this tab open — the queue runs from your browser, one call at a time.</div>}
          {!loading && !rows.length && <div className="empty" style={{ padding: 30 }}>This group is empty.</div>}
          {rows.length > 0 && (
            <table className="table calls-table">
              <thead><tr><th>#</th><th>Business</th><th>Phone</th><th>Dial as</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const [cls, label] = STATUS_CHIP[r.status];
                  return (
                    <tr key={r.dedupKey} className={r.status === 'calling' ? 'vapi-live' : ''}>
                      <td className="muted">{i + 1}</td>
                      <td className="bizname" title={r.name}>{r.name}</td>
                      <td>{r.phone || <span className="muted">—</span>}</td>
                      <td>{r.e164 || <span className="muted">not dialable</span>}</td>
                      <td><span className={`chip ${cls}`}>{label}{r.status === 'calling' && r.callStatus ? ` · ${r.callStatus}` : ''}</span></td>
                      <td className="muted">{r.error || r.endedReason || ''}</td>
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
