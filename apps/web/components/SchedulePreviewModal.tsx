'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SchedulePlan } from '@/lib/api';
import { REASONS } from '@/lib/skipReasons';

// The plan of a schedule, before anything is written: which day and which
// sender account takes how many leads, why not more, and the leads by name.
// Accepting writes exactly these leads, a chunk per call; a lead that no longer
// passes a rule by then is left out and counted.

const APPLY_CHUNK = 200; // what one call of the write takes (lib/schedule.ts)
const DROPPED: [string, string][] = [...REASONS, ['full', 'the day got full in the meantime'], ['gone', 'the lead is no longer there']];

type DayRow = NonNullable<SchedulePlan['days']>[number]['rows'][number];
const dayLabel = (day: string) => new Date(day + 'T12:00:00.000Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const minute = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const leadsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'lead' : 'leads'}`;

// why this sender gets this many leads on this day, and not more
// `noneOf`: the language of the account's sequence, when the plan holds no lead of that language at all
function reason(r: DayRow, noneOf: string): string {
  if (!r.open) return 'Not a sending day for this account';
  if (r.cap === 0) return 'The limit of this day is 0';
  if (r.free === 0) return `Full already: ${r.booked.toLocaleString()} sent or due against the limit of ${r.cap.toLocaleString()}`;
  if (!r.placed && noneOf) return `No ${noneOf} lead in the selection: this account's sequence is ${noneOf}`;
  if (r.placed < r.free) return r.placed ? 'The selection ran out: no more leads to place' : 'The selection ran out before this day';
  if (r.booked > 0) return `${r.booked.toLocaleString()} of the limit of ${r.cap.toLocaleString()} already sent or due, so ${r.free.toLocaleString()} fit`;
  return 'Filled to the limit';
}

export default function SchedulePreviewModal({ plan, onClose, onDone }: { plan: SchedulePlan; onClose: () => void; onDone: () => void }) {
  const [open, setOpen] = useState(''); // the day and sender whose leads are listed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ written: number; dropped: Record<string, number>; done: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const placements = plan.placements || [];
  const senders = plan.senders || [];
  // the sequence each account had when this plan was made, not what the panel's selects say by now
  const sequences = Object.fromEntries(senders.map((s) => [s.senderId, s.sequenceId]));
  const days = plan.days || [];
  const skipped = plan.skipped || {};
  const perSender = senders.map((s) => ({ ...s, n: placements.filter((p) => p.senderId === s.senderId).length }));
  // languages that get at least one lead in this plan
  const placedLanguages = new Set(perSender.filter((s) => s.n > 0).map((s) => s.language));
  const languageName = (l: string) => (l === 'hu' ? 'Hungarian' : l === 'en' ? 'English' : l);
  const firstDay = placements.reduce((d, p) => (!d || p.day < d ? p.day : d), '');

  // The server writes one chunk per call; this loop is what makes a long plan finish.
  const accept = async () => {
    setBusy(true); setError('');
    let written = 0, runId = '';
    const dropped: Record<string, number> = {};
    try {
      for (let i = 0; i < placements.length; i += APPLY_CHUNK) {
        const r = await api.scheduleApply(sequences, placements.slice(i, i + APPLY_CHUNK).map((p) => ({ project: p.project, key: p.key, senderId: p.senderId, at: p.at })), runId);
        if (!r.ok) { setError(`${r.error || 'The schedule stopped.'} ${leadsWord(written)} were scheduled before that.`); break; }
        written += r.written || 0; runId = r.runId || runId;
        for (const [k, n] of Object.entries(r.dropped || {})) dropped[k] = (dropped[k] || 0) + n;
        setProgress({ written, dropped: { ...dropped }, done: i + APPLY_CHUNK >= placements.length });
      }
    } catch {
      setError(`Network error. The schedule stopped after ${leadsWord(written)}; make a new plan to see what is left.`);
    } finally {
      setBusy(false);
      if (written > 0) onDone();
    }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label="Schedule plan">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗓 Schedule plan</div>
            <div className="modal-sub">{progress ? 'The leads below are being put into their sequences.' : 'Nothing has been written. Accept to put these leads into their sequences on these days.'}</div>
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>✕ Close</button>
        </div>
        <div className="modal-body osch-body">
          {(plan.notes || []).map((n) => <div key={n} className="oseq-note">{n}</div>)}
          <div className="oseq-card">
            <div className="oseq-hint">
              The selection holds <b>{(plan.matched || 0).toLocaleString()}</b> leads. <b>{placements.length.toLocaleString()}</b> would be scheduled
              {placements.length > 0 && <>, from <b>{dayLabel(firstDay)}</b> to <b>{dayLabel(plan.lastDay || firstDay)}</b></>}.
            </div>
            <div className="oseq-row">
              {perSender.map((s) => <span key={s.senderId} className="chip blue" title={`${s.fromEmail} · ${s.sequence}`}>{s.label}: {s.n.toLocaleString()}</span>)}
            </div>
            {(plan.left || 0) > 0 && <div className="oseq-hint">{leadsWord(plan.left || 0)} that pass every rule found no day{plan.mode === 'range' ? ' in this range' : ''}: the days are full.</div>}
            {plan.stopped === 'full' && <div className="oseq-hint">Every day {plan.mode === 'range' ? 'of the range' : 'that can be planned'} is full, so the rest of the selection was not read.</div>}
            {plan.stopped === 'max' && <div className="oseq-hint">A plan holds at most {placements.length.toLocaleString()} leads. Accept this one and make another: it goes on from the day this one ends.</div>}
            {plan.stopped === 'budget' && <div className="oseq-hint">Reading stopped after the first {(plan.examined || 0).toLocaleString()} leads with an email. Accept this plan and make another for the rest.</div>}
            <div className="oseq-hint">
              {REASONS.filter(([k]) => skipped[k]).map(([k, label]) => <div key={k}>{skipped[k].toLocaleString()} left out: {label}</div>)}
              {!REASONS.some(([k]) => skipped[k]) && <span className="muted">Nobody with an email is left out by a rule.</span>}
            </div>
          </div>

          {!placements.length && <div className="empty">No lead can be scheduled. The reasons are above, and the days below show where there is room.</div>}

          <div className="oseq-card">
            <div className="oseq-row"><b>Day by day</b><span className="muted">Days are Budapest days, like the daily limit. The limit of a later day follows the account&apos;s warm-up.</span></div>
            <div className="orep-table">
              <div className="osch-tr orep-th"><span>Day</span><span>From</span><span>Goes in</span><span>Limit</span><span>Sent or due</span><span>Why this many</span><span /></div>
              {days.map((d) => (d.rows.every((r) => !r.open) ? (
                <div key={d.day} className="osch-tr muted"><span>{dayLabel(d.day)}</span><span className="osch-wide">No account sends on this day</span></div>
              ) : d.rows.map((r) => {
                const sender = senders.find((s) => s.senderId === r.senderId);
                const id = `${d.day}|${r.senderId}`;
                return (
                  <div key={id}>
                    <div className="osch-tr">
                      <span>{dayLabel(d.day)}</span>
                      <span title={sender?.fromEmail}>{sender?.label || r.senderId}</span>
                      <span><b>{r.placed.toLocaleString()}</b></span>
                      <span className="muted">{r.cap.toLocaleString()}</span>
                      <span className="muted">{r.booked.toLocaleString()}</span>
                      <span className="muted">{reason(r, sender && !placedLanguages.has(sender.language) ? languageName(sender.language) : '')}</span>
                      <span>{r.placed > 0 && <button className="mini" onClick={() => setOpen(open === id ? '' : id)}>{open === id ? 'Hide' : 'Leads'}</button>}</span>
                    </div>
                    {open === id && placements.filter((p) => p.day === d.day && p.senderId === r.senderId).map((p) => (
                      <div key={`${p.project}|${p.key}`} className="osch-lead muted"><span>{minute(p.at)}</span><span title={p.project}>{p.name}</span><span>{p.to}</span></div>
                    ))}
                  </div>
                );
              })))}
            </div>
          </div>

          {error && <div className="oseq-note bad">{error}</div>}
          {progress && (
            <div className="oseq-note">
              {progress.done ? 'Done. ' : 'Working… '}{leadsWord(progress.written)} scheduled{progress.done ? '.' : ' so far. Keep this window open.'}
              {DROPPED.filter(([k]) => progress.dropped[k]).map(([k, label]) => <div key={k}>{progress.dropped[k].toLocaleString()} not written: {label}</div>)}
            </div>
          )}
          <div className="oseq-row oseq-actions">
            <button className="btn primary" onClick={accept} disabled={busy || !placements.length || !!progress}>{busy ? 'Working…' : `Accept and schedule ${leadsWord(placements.length)}`}</button>
            <button className="btn" onClick={onClose} disabled={busy}>{progress ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
