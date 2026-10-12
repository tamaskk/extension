'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadsQuery, SchedulePlan } from '@/lib/api';
import type { OutreachSequenceRow } from '@/lib/types';
import SchedulePreviewModal from './SchedulePreviewModal';

// "Schedule ahead" on the Leads tab, under the filters it takes its leads from:
// the leads of a selection are put into their sequences on the coming days,
// every sender account filled up to its limit of that day, so the queue does
// not have to be topped up by hand every morning. Collapsible. It only makes
// the plan; the modal shows it and writes it.

const OPEN_KEY = 'gl.campaign.schedule.open';
const LANGUAGES: [string, string][] = [['hu', 'Hungarian'], ['en', 'English']];
type SourceKind = 'filter' | 'checked' | 'group';

interface Props {
  query: LeadsQuery;                                   // the lead table's current filter
  filterLabel: string;                                 // what that filter shows, in words
  checkedCount: number;
  group: { groupId: string; name: string } | null;    // the group that is open, if any
  onDone: () => void;
}

export default function CampaignScheduler({ query, filterLabel, checkedCount, group, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SourceKind>(group ? 'group' : checkedCount > 0 ? 'checked' : 'filter');
  const [mode, setMode] = useState<'all' | 'range'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // language → sequence; undefined until the operator chooses, '' to leave the language out
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  // loaded when the card is first opened, so a closed card costs the Leads tab no request
  const [loaded, setLoaded] = useState<OutreachSequenceRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const sequences = loaded || [];

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // storage is blocked: the panel starts closed
    }
  }, []);
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    setLoadError('');
    api.getSequences()
      .then((r) => { if (!alive) return; if (r.ok) setLoaded(r.sequences || []); else setLoadError(r.error || 'The sequences could not be loaded.'); })
      .catch(() => { if (alive) setLoadError('Network error. The sequences could not be loaded.'); });
    return () => { alive = false; };
  }, [open, loaded]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // storage is blocked: the choice holds for this visit only
    }
  };

  // a language starts on its switched-on sequence, or else its first one
  const sequenceOf = (language: string) => {
    if (chosen[language] !== undefined) return chosen[language];
    const mine = sequences.filter((s) => s.language === language);
    return (mine.find((s) => s.enabled) || mine[0])?.sequenceId || '';
  };
  const picked = Object.fromEntries(LANGUAGES.map(([l]) => [l, sequenceOf(l)]).filter(([, id]) => id));
  const source = kind === 'group' && group ? { kind: 'group' as const, groupId: group.groupId } : kind === 'checked' ? { kind: 'checked' as const } : { kind: 'filter' as const, query };
  const ready = Object.keys(picked).length > 0 && (mode === 'all' || (!!from && !!to && from <= to));

  const makePlan = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.schedulePlan({ source, sequences: picked, mode, from, to });
      if (r.ok) setPlan(r); else setError(r.error || 'The plan could not be made.');
    } catch {
      setError('Network error. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oseq-card">
      <div className="oseq-row">
        <b>Schedule ahead</b>
        <span className="muted">Fill the coming days of every sender account from a selection of leads.</span>
        <div className="spacer" />
        <button className="btn" onClick={toggle} aria-expanded={open}>{open ? '▴ Close' : '▾ Open'}</button>
      </div>
      {open && (
        <>
          <div className="muted oseq-hint">Each lead goes to an account of its own language, on the earliest day that account still has room: its limit of that day, less what is already sent or due. Days that were filled before are kept, so a later plan goes on where the last one ended. Nothing is written until you accept the plan.</div>
          {loadError && <div className="oseq-note bad">{loadError}</div>}
          {!loaded && !loadError && <div className="muted oseq-hint">Loading the sequences…</div>}
          {loaded && !loaded.length && <div className="muted oseq-hint">No sequence yet. Create one on the Sequences tab.</div>}
          {loaded && loaded.length > 0 && <>
          <div className="oseq-fields">
            <label>Which leads
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as SourceKind)} disabled={busy}>
                <option value="filter">The current filter: {filterLabel}</option>
                <option value="checked" disabled={!checkedCount}>The checked leads ({checkedCount.toLocaleString()})</option>
                {group && <option value="group">The group &quot;{group.name}&quot;</option>}
              </select>
            </label>
            <label>How many days
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'range')} disabled={busy}>
                <option value="all">Every lead of the selection, as soon as there is room</option>
                <option value="range">Only between two days</option>
              </select>
            </label>
            {LANGUAGES.map(([language, name]) => {
              const mine = sequences.filter((s) => s.language === language);
              return (
                <label key={language}>{name} leads go into
                  <select className="select" value={sequenceOf(language)} onChange={(e) => setChosen((c) => ({ ...c, [language]: e.target.value }))} disabled={busy || !mine.length}>
                    <option value="">{mine.length ? 'Leave them out' : `No ${name} sequence`}</option>
                    {mine.map((s) => <option key={s.sequenceId} value={s.sequenceId}>{s.name}{s.enabled ? '' : ' (off)'}</option>)}
                  </select>
                </label>
              );
            })}
            {mode === 'range' && (
              <>
                <label>First day <input className="search" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} /></label>
                <label>Last day <input className="search" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} disabled={busy} /></label>
              </>
            )}
          </div>
          <div className="oseq-row">
            <button className="btn primary" onClick={makePlan} disabled={!ready || busy}>{busy ? 'Planning…' : 'Show the plan'}</button>
            {mode === 'range' && !!from && !!to && from > to && <span className="muted">The first day is after the last one.</span>}
            {!Object.keys(picked).length && <span className="muted">Choose a sequence for at least one language.</span>}
          </div>
          {error && <div className="oseq-note bad">{error}</div>}
          </>}
        </>
      )}
      {plan && <SchedulePreviewModal plan={plan} onClose={() => setPlan(null)} onDone={onDone} />}
    </div>
  );
}
