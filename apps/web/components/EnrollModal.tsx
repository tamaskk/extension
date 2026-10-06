'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { EnrollResult, LeadsQuery } from '@/lib/api';
import type { OutreachSequenceRow } from '@/lib/types';

// Puts leads into a sequence, or takes them out. It writes to many leads at
// once, so it always goes in two steps: a preview that changes nothing and
// says what would happen, and only then the run. Any change to the choices
// throws the preview away.

type SourceKind = 'filter' | 'checked' | 'group';
interface Props {
  query: LeadsQuery;                                   // the lead table's current filter
  filterLabel: string;                                 // what that filter shows, in words
  checkedCount: number;
  group: { groupId: string; name: string } | null;    // the group that is open, if any
  onClose: () => void;
  onDone: () => void;
}

const REASONS: [string, string][] = [
  ['noEmail', 'no email address'],
  ['badEmail', 'an address that must not be written to (noreply, a placeholder, the website agency)'],
  ['noMx', 'the address\'s domain takes no mail'],
  ['active', 'already in a sequence'],
  ['replied', 'replied to an earlier sequence'],
  ['suppressed', 'on the suppression list'],
  ['alreadyMailed', 'this address, or this company, was written to before'],
  ['language', 'another language than the sequence'],
  ['languageUnknown', 'language not known (country of the project not recognised)'],
  ['noTimezone', 'time zone not known (no coordinates and no country in the address)'],
  ['domain', 'another lead of the same company is in a sequence'],
  ['noSender', 'no sender account available'],
  ['overLimit', 'over the limit of this run'],
];

export default function EnrollModal({ query, filterLabel, checkedCount, group, onClose, onDone }: Props) {
  const [sequences, setSequences] = useState<OutreachSequenceRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [action, setAction] = useState<'enroll' | 'unenroll' | 'continue'>('enroll');
  const [sequenceId, setSequenceId] = useState('');
  const [kind, setKind] = useState<SourceKind>(group ? 'group' : checkedCount > 0 ? 'checked' : 'filter');
  const [limit, setLimit] = useState('500');
  const [ignoreLanguage, setIgnoreLanguage] = useState(false);
  const [preview, setPreview] = useState<EnrollResult | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'run'>('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ taken: number; done: boolean } | null>(null);

  useEffect(() => {
    api.getSequences()
      .then((r) => { if (r.ok) setSequences(r.sequences || []); else setLoadError(r.error || 'The sequences could not be loaded.'); })
      .catch(() => setLoadError('The sequences could not be loaded.'));
  }, []);

  const running = busy === 'run';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  // a preview answers for one set of choices; with another set it says nothing
  const choose = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setProgress(null); setError(''); };
  const source = kind === 'group' && group ? { kind: 'group' as const, groupId: group.groupId } : kind === 'checked' ? { kind: 'checked' as const } : { kind: 'filter' as const, query };
  const request = { action, sequenceId, source, limit: Number(limit) || 500, ignoreLanguage };
  const ready = (action !== 'enroll' || !!sequenceId) && Number(limit) > 0;

  const runPreview = async () => {
    setBusy('preview'); setError(''); setPreview(null); setProgress(null);
    try {
      const r = await api.enroll({ ...request, dryRun: true });
      if (r.ok) setPreview(r); else setError(r.error || 'The preview failed.');
    } catch {
      setError('Network error. Nothing was changed.');
    } finally {
      setBusy('');
    }
  };

  // The server handles one chunk per call; this loop is what makes a long run finish.
  const run = async () => {
    if (!preview) return;
    setBusy('run'); setError('');
    let cursor = '', runId = '', taken = 0;
    try {
      for (;;) {
        const r = await api.enroll({ ...request, dryRun: false, cursor, runId, taken });
        if (!r.ok) { setError(r.error || 'The run stopped.'); break; }
        cursor = r.cursor || cursor; runId = r.runId || runId; taken = r.taken || 0;
        setProgress({ taken, done: !!r.done });
        if (r.done) break;
      }
    } catch {
      setError(`Network error. The run stopped after ${taken} ${taken === 1 ? 'lead' : 'leads'}; run a new preview to see what is left.`);
    } finally {
      setBusy('');
      setPreview(null);
      if (taken > 0) onDone();
    }
  };

  const skipped = preview?.skipped || {};
  const verb = action === 'enroll' ? 'Enrol' : action === 'continue' ? 'Start follow-ups for' : 'Take out';
  const would = preview?.wouldTake || 0;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Enrol leads in a sequence">
        <div className="modal-head">
          <div>
            <div className="modal-title">📨 Sequence enrolment</div>
            <div className="modal-sub">Nothing is written before you have seen the preview.</div>
          </div>
          <button className="btn" onClick={onClose} disabled={running}>✕ Close</button>
        </div>
        <div className="modal-body">
          {loadError && <div className="oseq-note bad">{loadError}</div>}
          {!sequences && !loadError && <div className="empty">Loading…</div>}
          {sequences && (
            <>
              <div className="oseq-fields">
                <label>What to do
                  <select className="select" value={action} onChange={(e) => choose(setAction)(e.target.value as 'enroll' | 'unenroll' | 'continue')} disabled={!!busy}>
                    <option value="enroll">Put leads into a sequence (they get the opening email)</option>
                    <option value="continue">Start the follow-ups for leads that got the opening email</option>
                    <option value="unenroll">Take leads out of their sequence</option>
                  </select>
                </label>
                <label>Sequence
                  <select className="select" value={sequenceId} onChange={(e) => choose(setSequenceId)(e.target.value)} disabled={!!busy}>
                    <option value="">{action === 'enroll' ? 'Choose…' : 'Any sequence'}</option>
                    {sequences.map((s) => <option key={s.sequenceId} value={s.sequenceId}>{s.name} ({s.language}{s.enabled ? '' : ', off'}{s.errors.length ? ', not complete' : ''})</option>)}
                  </select>
                </label>
                <label>Which leads
                  <select className="select" value={kind} onChange={(e) => choose(setKind)(e.target.value as SourceKind)} disabled={!!busy}>
                    <option value="filter">The current filter: {filterLabel}</option>
                    <option value="checked" disabled={!checkedCount}>The checked leads ({checkedCount.toLocaleString()})</option>
                    {group && <option value="group">The group "{group.name}"</option>}
                  </select>
                </label>
                <label>At most this many leads (up to 10,000)
                  <input className="search" inputMode="numeric" value={limit} onChange={(e) => choose(setLimit)(e.target.value)} disabled={!!busy} />
                </label>
                {action === 'enroll' && (
                  <label className="oseq-check wide"><input type="checkbox" checked={ignoreLanguage} onChange={(e) => choose(setIgnoreLanguage)(e.target.checked)} disabled={!!busy} /> Also take leads in another or an unknown language</label>
                )}
              </div>
              {!sequences.length && action === 'enroll' && <div className="oseq-note">There is no sequence yet. Create one on the Sequences tab first.</div>}

              <div className="oseq-row oseq-actions">
                <button className="btn" onClick={runPreview} disabled={!ready || !!busy}>{busy === 'preview' ? 'Counting…' : 'Preview'}</button>
                <button className={`btn ${action === 'unenroll' ? 'danger' : 'primary'}`} onClick={run} disabled={!preview || !would || !!busy} title={!preview ? 'Run a preview first.' : !would ? 'The preview found no lead to change.' : undefined}>
                  {running ? 'Working…' : preview ? `${verb} ${would.toLocaleString()} ${would === 1 ? 'lead' : 'leads'}` : `${verb}…`}
                </button>
              </div>
              {error && <div className="oseq-note bad">{error}</div>}

              {progress && (
                <div className="oseq-note">
                  {progress.done ? 'Done. ' : 'Working… '}{progress.taken.toLocaleString()} {progress.taken === 1 ? 'lead' : 'leads'} {action === 'enroll' ? 'enrolled' : action === 'continue' ? 'started' : 'taken out'}{progress.done ? '.' : ' so far. Keep this window open.'}
                </div>
              )}

              {preview && (
                <div className="oseq-card">
                  <div className="oseq-row"><b>Preview</b><span className="muted">Nothing has been changed.</span></div>
                  {action === 'enroll' ? (
                    <>
                      <div className="oseq-hint">
                        The selection holds <b>{(preview.matched || 0).toLocaleString()}</b> leads. <b>{would.toLocaleString()}</b> would be enrolled
                        {preview.complete ? '.' : `, counted over the first ${(preview.examined || 0).toLocaleString()} leads with an email; the rest was not read.`}
                      </div>
                      <div className="oseq-hint">
                        {REASONS.filter(([k]) => skipped[k]).map(([k, label]) => <div key={k}>{skipped[k].toLocaleString()} left out: {label}</div>)}
                        {!REASONS.some(([k]) => skipped[k]) && <span className="muted">Nobody with an email is left out.</span>}
                      </div>
                      <div className="oseq-row">
                        {Object.entries(preview.byLanguage || {}).map(([lang, n]) => <span key={lang} className="chip gray">{lang === 'hu' ? 'Hungarian' : lang === 'en' ? 'English' : 'Unknown language'}: {n.toLocaleString()}</span>)}
                        {(preview.bySender || []).map((s) => <span key={s.senderId} className="chip blue">{s.label}: {s.n.toLocaleString()}</span>)}
                      </div>
                    </>
                  ) : action === 'continue' ? (
                    <div className="oseq-hint"><b>{would.toLocaleString()}</b> {would === 1 ? 'lead' : 'leads'} of the selection got the opening email and {would === 1 ? 'waits' : 'wait'}{preview.complete ? '' : ' (the limit was reached; there are more)'}. Their follow-ups would start: the next step within two hours, the rest by their waits. The senders' daily limits apply, and these emails share them with the opening emails.</div>
                  ) : (
                    <div className="oseq-hint"><b>{would.toLocaleString()}</b> {would === 1 ? 'lead' : 'leads'} of the selection {would === 1 ? 'is' : 'are'} in a sequence and would be taken out{preview.complete ? '' : ' (the limit was reached; there are more)'}. They get no further email, and their company domains are free again.</div>
                  )}
                  {(preview.samples || []).map((s, i) => (
                    <div key={i} className="oseq-row muted"><span>{s.name || 'No name'}</span><span>{s.to}</span>{s.sender && <span className="chip gray">{s.sender}</span>}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
