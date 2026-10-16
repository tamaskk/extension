'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { QueueDay } from '@/lib/api';

// The Queues tab: which emails go out on which day, from which sender account
// and to whom. It shows what is already scheduled; the one thing it changes is
// deleting a queue, which takes its leads out of their sequence. A day is a
// Budapest day, like the daily limit.

const dayLabel = (day: string) => new Date(day + 'T12:00:00.000Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });
const minute = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const emails = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'email' : 'emails'}`;

export default function QueuesView({ reloadKey }: { reloadKey: number }) {
  const [days, setDays] = useState<QueueDay[] | null>(null);
  const [today, setToday] = useState('');
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set()); // 'day|senderId' of the lists that are folded

  const load = useCallback(() => {
    setLoading(true); setError('');
    api.getQueues()
      .then((r) => {
        if (!r.ok) { setError(r.error || 'The queues could not be loaded.'); return; }
        setDays(r.days || []); setToday(r.today || ''); setCapped(!!r.capped);
      })
      .catch(() => setError('Network error. The queues could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [deleting, setDeleting] = useState('');
  // asked in the row, not with confirm(): a browser told to stop showing dialogs answers "no" without a word
  const [confirmDel, setConfirmDel] = useState(''); // 'day|senderId'
  const [delError, setDelError] = useState('');
  const remove = async (day: string, senderId: string, rows: QueueDay['senders'][number]['rows']) => {
    const id = `${day}|${senderId}`;
    setDeleting(id); setDelError('');
    try {
      // the rows go along so the server stops only what was shown here
      const r = await api.deleteQueue(day, senderId, rows.map((x) => ({ project: x.project, key: x.key, at: x.at })));
      if (r.ok) { setConfirmDel(''); load(); } else setDelError(r.error || 'The queue could not be deleted.');
    } catch {
      setDelError('Network error. The queue could not be deleted.');
    }
    setDeleting('');
  };
  const total = (days || []).reduce((n, d) => n + d.total, 0);

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">📬 Queues</div>
        {days && <span className="chip blue">{emails(total)} on {days.length.toLocaleString()} {days.length === 1 ? 'day' : 'days'}</span>}
        <div className="spacer" />
        <button className="btn" onClick={load} disabled={loading}>⟳ Refresh</button>
      </div>

      {loading && !days && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={load}>Try again</button></div>}
      {days && !error && (
        <div className="oseq-list">
          <div className="muted oseq-hint">The next email of every lead that is in a sequence, on the day it is due. A follow-up gets its day when the email before it has gone out, so later follow-ups are not listed yet. A lead moves to the next day when its account reaches the limit of the day.</div>
          {capped && <div className="oseq-note">Only the first 5,000 emails are listed.</div>}
          {!days.length && <div className="empty">Nothing is scheduled. Put leads in from the Leads tab with &quot;Schedule ahead&quot;.</div>}
          {days.map((d) => (
            <div className="oseq-card" key={d.day}>
              <div className="oseq-row">
                <b>{dayLabel(d.day)}</b>
                {d.day === today && <span className="chip green">Today</span>}
                <span className="muted">{emails(d.total)}</span>
                <div className="spacer" />
                {d.senders.map((s) => <span key={s.senderId} className="chip blue">{s.label}: {s.rows.length.toLocaleString()}</span>)}
              </div>
              {d.senders.map((s) => {
                const id = `${d.day}|${s.senderId}`;
                const open = !closed.has(id);
                return (
                  <div key={id}>
                    <div className="oque-tr oque-head">
                      <span><b>{s.label}</b> sends {emails(s.rows.length)}</span>
                      <span>
                        <button className="mini" onClick={() => toggle(id)} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>{' '}
                        <button className="mini danger" onClick={() => { setDelError(''); setConfirmDel(id); }} disabled={!!deleting} aria-label={`Delete the queue of ${s.label} on ${dayLabel(d.day)}`}>Delete</button>
                      </span>
                    </div>
                    {confirmDel === id && (
                      <div className="oseq-row">
                        <span>Delete this queue? {emails(s.rows.length)} will not be sent: the {s.rows.length === 1 ? 'lead leaves its' : 'leads leave their'} sequence, follow-ups included. No lead is deleted.</span>
                        <button className="mini danger" disabled={!!deleting} onClick={() => remove(d.day, s.senderId, s.rows)}>{deleting === id ? 'Deleting…' : 'Yes, delete'}</button>
                        <button className="mini" disabled={!!deleting} onClick={() => setConfirmDel('')}>Keep it</button>
                        {delError && <span className="chip red">{delError}</span>}
                      </div>
                    )}
                    {open && s.rows.map((r) => (
                      <div key={`${r.project}|${r.key}`} className="oque-tr">
                        <span className="muted">{minute(r.at)}</span>
                        <span title={r.project}>{r.name}</span>
                        <span className="muted">{r.to}</span>
                        <span className="muted">{r.sequence}{r.step ? ` · ${r.step}` : ''}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
