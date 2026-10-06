'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { SequenceCheck, SequenceInput, SequencePreview } from '@/lib/api';
import type { OutreachSequenceRow, OutreachStep, OutreachSenderRow } from '@/lib/types';
import { absoluteDayOf, validateSequence } from '@/lib/outreachSequence.mjs';
import { VARIABLES, usedVariables } from '@/lib/outreachRender.mjs';
import { DEFAULT_WEIGHT, enoughData } from '@/lib/outreachVariant.mjs';
import UnknownSends from './UnknownSends';
import { SEQUENCE_TEMPLATES } from '@/lib/sequenceTemplates.mjs';

// Sequences tab: the email series, their steps and wording. Sequences are
// edited while leads are in the middle of them, so nothing is saved before the
// editor has shown what the save will do to those leads.

// A step while it is being edited. `id` is '' until the server gives a new step
// one; `key` only tells the cards apart on screen. The wait is the text being typed.
// The weight is text too: empty means "the default share".
type StepDraft = Omit<OutreachStep, 'delayDays' | 'weight'> & { key: string; delayDays: string; weightText: string };
interface Draft { sequenceId: string; name: string; language: string; senderIds: string[]; enabled: boolean; autoFollowUp: boolean; stopOnReply: boolean; stopOnBounce: boolean; steps: StepDraft[] }

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const blankStep = (first: boolean): StepDraft => ({ key: newKey(), id: '', delayDays: first ? '0' : '3', subject: '', body: '', sameThread: !first, enabled: true, weightText: '' });
// Every step followed by its wording variants. A variant whose step is gone
// stays at the end, where validation names it.
function grouped(steps: StepDraft[]): { main: StepDraft; variants: StepDraft[] }[] {
  return steps.filter((s) => !s.variantOf).map((main) => ({ main, variants: main.id ? steps.filter((v) => v.variantOf === main.id) : [] }));
}
function flat(groups: { main: StepDraft; variants: StepDraft[] }[], all: StepDraft[]): StepDraft[] {
  const placed = groups.flatMap((g) => [g.main, ...g.variants]);
  return [...placed, ...all.filter((s) => !placed.includes(s))];
}
const draftOf = (s: OutreachSequenceRow): Draft => ({
  sequenceId: s.sequenceId, name: s.name, language: s.language, senderIds: s.senderIds || [], enabled: s.enabled, autoFollowUp: !!s.autoFollowUp, stopOnReply: s.stopOnReply, stopOnBounce: s.stopOnBounce,
  steps: (() => {
    const all = s.steps.map(({ weight, ...st }) => ({ ...st, key: newKey(), delayDays: st.delayDays === null ? '' : String(st.delayDays), weightText: weight === undefined ? '' : String(weight) }));
    return flat(grouped(all), all);
  })(),
});
// A new, switched-off sequence filled in from a template; every word can still be changed.
type Template = { key: string; label: string; name: string; language: string; steps: { delayDays: number; subject: string; body: string; sameThread: boolean; enabled: boolean }[] };
const fromTemplate = (t: Template): Draft => ({
  sequenceId: '', name: t.name, language: t.language, senderIds: [], enabled: false, autoFollowUp: false, stopOnReply: true, stopOnBounce: true,
  steps: t.steps.map((s) => ({ key: newKey(), id: '', delayDays: String(s.delayDays), subject: s.subject, body: s.body, sameThread: s.sameThread, enabled: s.enabled, weightText: '' })),
});
const NEW_DRAFT = (): Draft => ({ sequenceId: '', name: '', language: 'en', senderIds: [], enabled: false, autoFollowUp: false, stopOnReply: true, stopOnBounce: true, steps: [blankStep(true)] });

// Whichever step ends up first opens the conversation: it goes out at once and
// starts the thread. Its two boxes are locked in the form, so they are set here
// when a move or a delete puts another step on top.
const withFirstFixed = (steps: StepDraft[]): StepDraft[] => steps.map((s, i) => (i === 0 && (s.delayDays !== '0' || s.sameThread) ? { ...s, delayDays: '0', sameThread: false } : s));

// an empty box is "not filled in", never 0
const waitOf = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const stepsOf = (d: Draft): OutreachStep[] => d.steps.map(({ key: _key, delayDays, weightText, ...s }) => ({ ...s, delayDays: waitOf(delayDays), ...(weightText.trim() === '' ? {} : { weight: Number(weightText) }) }));
// What goes to the server. A new step travels without an id and gets one there.
const inputOf = (d: Draft): SequenceInput => ({
  name: d.name, language: d.language, senderIds: d.senderIds, enabled: d.enabled, autoFollowUp: d.autoFollowUp, stopOnReply: d.stopOnReply, stopOnBounce: d.stopOnBounce,
  steps: stepsOf(d).map(({ id, ...s }) => (id ? { id, ...s } : s)),
});
// The same sequence for the local checks, where every step needs something to be told apart by.
const localOf = (d: Draft) => ({ name: d.name, language: d.language, steps: stepsOf(d).map((s, i) => ({ ...s, id: s.id || d.steps[i].key })) });

// The edit in progress outlives the view: switching to another tab of the
// dashboard unmounts this component, and an hour of wording must not go with it.
const parked: { current: { draft: Draft; dirty: boolean } | null } = { current: null };

export default function SequencesView() {
  const [list, setList] = useState<OutreachSequenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [confirmDel, setConfirmDel] = useState('');
  const [delError, setDelError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => parked.current?.draft || null);
  const [dirty, setDirty] = useState(() => !!parked.current?.dirty);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // the answer of the check, shown in the dialog before a save
  const [check, setCheck] = useState<SequenceCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [vars, setVars] = useState<SequenceCheck['variables']>(undefined);
  const [varsState, setVarsState] = useState<'' | 'loading' | 'failed'>('');
  const [preview, setPreview] = useState<SequencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewSkip, setPreviewSkip] = useState(0);
  // reading the leads' websites for the offer signals: a long job the client drives chunk by chunk
  const [signals, setSignals] = useState<{ running: boolean; done: number; text: string }>({ running: false, done: 0, text: '' });
  const readSignals = async () => {
    let done = 0;
    setSignals({ running: true, done, text: 'Reading websites…' });
    try {
      for (;;) {
        const r = await api.readSiteSignals();
        if (!r.ok) { setSignals({ running: false, done, text: r.error || 'It stopped. Run it again to go on.' }); return; }
        done += r.done || 0;
        if (!r.remaining || !r.done) { setSignals({ running: false, done, text: done ? `Done: ${done.toLocaleString()} websites read.` : 'Nothing left to read.' }); return; }
        setSignals({ running: true, done, text: `${done.toLocaleString()} read, ${r.remaining >= 5000 ? 'more than 5,000' : r.remaining.toLocaleString()} to go. Keep this tab open.` });
      }
    } catch {
      setSignals({ running: false, done, text: `Network error after ${done.toLocaleString()} websites. Run it again to go on.` });
    }
  };
  // emails sent so far per step id, for the wording variants; as of when the sequence was opened
  const [sentByStep, setSentByStep] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    setLoading(true);
    return api.getSequences()
      .then((r) => { if (r.ok) { setList(r.sequences || []); setLoadError(''); } else setLoadError(r.error || 'The sequences could not be loaded.'); return r.sequences || []; })
      .catch(() => { setLoadError('The sequences could not be loaded.'); return [] as OutreachSequenceRow[]; })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  // the sender accounts, for the editor's sender picker; the editor works without them
  const [senders, setSenders] = useState<OutreachSenderRow[]>([]);
  useEffect(() => { api.getSenders().then((r) => { if (r.ok && r.senders) setSenders(r.senders); }).catch(() => setSenders([])); }, []);

  useEffect(() => { parked.current = draft ? { draft, dirty } : null; }, [draft, dirty]);
  // closing or reloading the browser tab is the one way out the parking does not cover
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const open = (d: Draft, sent: Record<string, number> = {}) => { setSentByStep(sent); setDraft(d); setDirty(false); setSaveError(''); setCheck(null); setVars(undefined); setVarsState(''); setPreview(null); setPreviewSkip(0); };
  const leave = () => { if (!dirty || confirm('Leave without saving? The changes to this sequence are lost.')) setDraft(null); };
  // the missing-value counts belong to the texts they were counted for
  const change = (fn: (d: Draft) => Draft) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); setVars(undefined); setVarsState(''); };
  const changeStep = (key: string, patch: Partial<StepDraft>) => change((d) => {
    const target = d.steps.find((s) => s.key === key);
    // a variant goes out in the same way as its step: in the thread, or as a new one
    const follow = target && !target.variantOf && target.id && patch.sameThread !== undefined ? target.id : '';
    return { ...d, steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : follow && s.variantOf === follow ? { ...s, sameThread: !!patch.sameThread } : s)) };
  });
  // Steps move, are added and are deleted together with their wording variants.
  const move = (i: number, by: number) => change((d) => {
    const groups = grouped(d.steps);
    const j = i + by;
    if (j < 0 || j >= groups.length) return d;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    return { ...d, steps: withFirstFixed(flat(groups, d.steps)) };
  });
  const insertAfter = (i: number, step: StepDraft) => change((d) => {
    const groups = grouped(d.steps);
    groups.splice(i + 1, 0, { main: step, variants: [] });
    return { ...d, steps: flat(groups, d.steps) };
  });
  const addVariant = (main: StepDraft) => change((d) => {
    const groups = grouped(d.steps).map((g) => (g.main.key === main.key
      ? { ...g, variants: [...g.variants, { ...main, key: newKey(), id: '', variantOf: main.id, delayDays: '0', weightText: String(DEFAULT_WEIGHT) }] }
      : g));
    return { ...d, steps: flat(groups, d.steps) };
  });
  const remove = (s: StepDraft) => {
    const variants = s.variantOf ? 0 : draft?.steps.filter((v) => s.id && v.variantOf === s.id).length || 0;
    // A step that was never saved is nobody's history; a saved one may be.
    if (s.id && !confirm(s.variantOf
      ? 'Delete this wording? Nobody gets it any more; it stays in the history of the leads who got it as an unknown step. Switching it off keeps the history readable. Delete anyway?'
      : `Delete this step${variants ? ` and its ${variants} wording ${variants === 1 ? 'variant' : 'variants'}` : ''}? Leads waiting for it leave the sequence, and it stays in the history of the leads who got it as an unknown step. Switching it off does neither. Delete anyway?`)) return;
    change((d) => ({ ...d, steps: withFirstFixed(d.steps.filter((x) => x.key !== s.key && !(s.id && !s.variantOf && x.variantOf === s.id))) }));
  };

  const local = useMemo(() => (draft ? localOf(draft) : null), [draft]);
  const problems = useMemo(() => (local ? validateSequence(local) as string[] : []), [local]);
  const used = useMemo(() => (local ? usedVariables(local) as { name: string; known: boolean; stepIds: string[] }[] : []), [local]);

  // Saving goes through the check first: a saved sequence shows what the edit
  // does to its active leads, and only "Save" in that dialog writes.
  const startSave = async () => {
    if (!draft) return;
    setSaveError('');
    if (!draft.sequenceId) { await write(); return; }
    setChecking(true);
    try {
      const r = await api.checkSequence(draft.sequenceId, inputOf(draft));
      if (r.ok) { setCheck(r); setVars(r.variables); } else setSaveError(r.error || 'The check could not run. Nothing was saved.');
    } catch {
      setSaveError('Network error. Nothing was saved.');
    } finally {
      setChecking(false);
    }
  };

  const write = async () => {
    if (!draft) return;
    setSaving(true); setSaveError('');
    try {
      const r = draft.sequenceId ? await api.updateSequence(draft.sequenceId, inputOf(draft)) : await api.addSequence(inputOf(draft));
      if (!r.ok) { setSaveError(r.error || 'The sequence could not be saved.'); return; }
      const id = draft.sequenceId || r.sequenceId || '';
      const fresh = (await load()).find((s) => s.sequenceId === id);
      setCheck(null);
      if (fresh) open(draftOf(fresh), fresh.sentByStep); else setDraft(null);
    } catch {
      setSaveError('Network error. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const loadVars = async () => {
    if (!draft?.sequenceId) return;
    setVarsState('loading');
    try {
      const r = await api.checkSequence(draft.sequenceId, inputOf(draft));
      if (r.ok) { setVars(r.variables); setVarsState(''); } else setVarsState('failed');
    } catch {
      setVarsState('failed');
    }
  };

  const runPreview = async (skip: number) => {
    if (!draft?.sequenceId) return;
    setPreviewing(true);
    try {
      setPreview(await api.previewSequence(draft.sequenceId, { skip, steps: inputOf(draft).steps }));
      setPreviewSkip(skip);
    } catch {
      setPreview({ ok: false, error: 'Network error.' });
    } finally {
      setPreviewing(false);
    }
  };

  // Confirmed in the row, not with confirm(): a browser that was told to stop
  // showing dialogs answers "no" without showing anything, and Delete did nothing.
  const del = async (s: OutreachSequenceRow) => {
    setDeleting(true); setDelError('');
    const r = await api.deleteSequence(s.sequenceId).catch(() => null);
    setDeleting(false);
    if (!r || !r.ok) { setDelError((r && r.error) || 'The sequence could not be deleted.'); return; }
    setConfirmDel('');
    load();
  };

  // Escape closes the dialog, as every modal here does.
  useEffect(() => {
    if (!check) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) setCheck(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [check, saving]);

  if (draft && local) {
    const blocked = draft.enabled && problems.length > 0;
    const whyNoSave = !draft.name.trim() ? 'Give the sequence a name.' : blocked ? 'A sequence that is on must be complete. Fix the points listed, or switch it off.' : !dirty ? 'Nothing has changed.' : undefined;
    return (
      <div className="groups-wrap">
        <div className="groups-bar">
          <button className="btn" onClick={leave}>← Sequences</button>
          <div className="groups-title">{draft.sequenceId ? draft.name || 'Sequence' : 'New sequence'}</div>
          {dirty && <span className="chip amber">Not saved</span>}
          <div className="spacer" />
          <button className="btn primary" onClick={startSave} disabled={saving || checking || !dirty || blocked || !draft.name.trim()} title={whyNoSave}>{checking ? 'Checking…' : saving ? 'Saving…' : 'Save…'}</button>
        </div>
        {saveError && <div className="oseq-note bad">{saveError}</div>}

        <div className="oseq-card oseq-meta">
          <label>Name<input className="search" value={draft.name} onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} placeholder="No website, English" /></label>
          <label>Language
            <select className="select" value={draft.language} onChange={(e) => change((d) => ({ ...d, language: e.target.value }))}>
              <option value="en">English</option>
              <option value="hu">Hungarian</option>
            </select>
          </label>
          <label>Status
            <select className="select" value={draft.enabled ? 'on' : 'off'} onChange={(e) => change((d) => ({ ...d, enabled: e.target.value === 'on' }))}>
              <option value="off">Off: nothing is sent</option>
              <option value="on">On: the steps are sent</option>
            </select>
          </label>
          <label className="wide">After the first email
            <select className="select" value={draft.autoFollowUp ? 'auto' : 'wait'} onChange={(e) => change((d) => ({ ...d, autoFollowUp: e.target.value === 'auto' }))}>
              <option value="wait">Wait: the follow-ups go out only to the leads I start them for</option>
              <option value="auto">Go on: every lead gets the follow-ups by their waits</option>
            </select>
          </label>
          <div className="wide oseq-senders">
            <span>Senders</span>
            {(() => {
              const usable = senders.filter((x) => x.active && x.language === draft.language);
              const other = senders.filter((x) => x.active && x.language !== draft.language);
              const lang = draft.language === 'hu' ? 'Hungarian' : 'English';
              if (!usable.length) {
                return <div className="oseq-note bad">No sender account is switched on in {lang}, so this sequence cannot send.{other.length > 0 && <> {other.map((x) => x.label || x.fromEmail).join(', ')} {other.length === 1 ? 'is' : 'are'} set to {draft.language === 'hu' ? 'English' : 'Hungarian'}: change the language on the Senders tab (Edit), or change this sequence&apos;s language.</>}{!other.length && ' Add one on the Senders tab.'}</div>;
              }
              return (
                <div className="oseq-row">
                  {usable.map((x) => (
                    <label key={x.senderId} className="oseq-check">
                      <input type="checkbox" checked={!draft.senderIds.length || draft.senderIds.includes(x.senderId)}
                        onChange={(e) => change((d) => {
                          const all = usable.map((u) => u.senderId);
                          const now = new Set(d.senderIds.length ? d.senderIds : all);
                          if (e.target.checked) now.add(x.senderId); else now.delete(x.senderId);
                          const picked = all.filter((id) => now.has(id));
                          // every one ticked, or none, is stored as "every sender": an account added later then joins by itself
                          return { ...d, senderIds: picked.length === all.length || !picked.length ? [] : picked };
                        })} /> {x.label || x.fromEmail}
                    </label>
                  ))}
                  <span className="muted">Only {lang} accounts can send a {lang} sequence. All ticked = every {lang} account, also ones added later.</span>
                </div>
              );
            })()}
          </div>
          <label className="oseq-check"><input type="checkbox" checked={draft.stopOnReply} onChange={(e) => change((d) => ({ ...d, stopOnReply: e.target.checked }))} /> Stop when the lead replies</label>
          <label className="oseq-check"><input type="checkbox" checked={draft.stopOnBounce} onChange={(e) => change((d) => ({ ...d, stopOnBounce: e.target.checked }))} /> Stop when the email bounces</label>
        </div>

        {!draft.sequenceId && (
          <div className="oseq-card">
            <div className="oseq-row">
              <b>Start from a ready text</b>
              {(SEQUENCE_TEMPLATES as Template[]).map((t) => (
                <button key={t.key} className="mini" onClick={() => { if (!dirty || confirm('Replace what is in the editor with this template?')) { setDraft(fromTemplate(t)); setDirty(true); } }}>{t.label}</button>
              ))}
              <span className="muted">Four emails: the first names the three services, the others give the details. Change anything before you save.</span>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className={`oseq-note ${draft.enabled ? 'bad' : ''}`}>
            {draft.enabled ? 'A sequence that is on must be complete. ' : 'Not ready to be switched on yet. '}
            {problems.join(' ')}
          </div>
        )}

        <div className="oseq-card">
          <div className="oseq-row">
            <b>Variables used</b>
            {draft.sequenceId && <button className="mini" onClick={loadVars} disabled={varsState === 'loading'}>{varsState === 'loading' ? 'Counting…' : 'Count missing values'}</button>}
            <span className="muted">Available: {Object.keys(VARIABLES).map((v) => `{{${v}}}`).join(' ')}</span>
          </div>
          {varsState === 'failed' && <div className="oseq-hint">The missing values could not be counted.</div>}
          {!used.length && <div className="muted oseq-hint">No variables in the texts yet.</div>}
          <div className="oseq-row">
            {used.map((u) => {
              const counted = vars?.find((v) => v.name === u.name);
              return (
                <span key={u.name} className={`chip ${u.known ? (counted && counted.missing ? 'amber' : 'gray') : 'red'}`}>
                  {`{{${u.name}}}`}
                  {!u.known ? ' is not a variable' : counted ? (counted.of ? ` missing for ${counted.missing} of ${counted.of}` : ' no leads in the sequence yet') : ''}
                </span>
              );
            })}
          </div>
        </div>

        {grouped(draft.steps).map(({ main: s, variants }, i, groups) => {
          const id = s.id || s.key;
          const day = absoluteDayOf(local, id) as number | null;
          const threaded = s.sameThread && i > 0;
          const sentLine = (stepId: string) => {
            const n = (stepId && sentByStep[stepId]) || 0;
            return `${n.toLocaleString()} sent${enoughData(n) ? '' : ', too little data to compare'}`;
          };
          return (
            <div key={s.key} className={`oseq-card oseq-step ${s.enabled ? '' : 'off'}`}>
              <div className="oseq-row">
                <b>Step {i + 1}</b>
                {!s.enabled && <span className="chip gray">Off</span>}
                {!s.id && <span className="chip blue">New</span>}
                <span className="muted">{i === 0 ? 'Day 0, sent first' : `+${s.delayDays || '?'} ${s.delayDays === '1' ? 'day' : 'days'} · day ${day ?? '?'}`}</span>
                {i === 1 && !draft.autoFollowUp && <span className="chip amber">Sent only after you start the follow-ups, within two hours of that; the later steps follow by their waits</span>}
                <div className="spacer" />
                <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} title="Move this step up">↑ Up</button>
                <button className="mini" onClick={() => move(i, 1)} disabled={i === groups.length - 1} title="Move this step down">↓ Down</button>
                <button className="mini" onClick={() => insertAfter(i, { ...s, key: newKey(), id: '', weightText: '' })}>Duplicate</button>
                <button className="mini" onClick={() => changeStep(s.key, { enabled: !s.enabled })}>{s.enabled ? 'Switch off' : 'Switch on'}</button>
                <button className="mini danger" onClick={() => remove(s)} disabled={groups.length === 1} title={groups.length === 1 ? 'A sequence needs at least one step.' : undefined}>Delete</button>
              </div>
              <div className="oseq-fields">
                <label>Wait after the step before it, in days
                  <input className="search" inputMode="numeric" value={s.delayDays} onChange={(e) => changeStep(s.key, { delayDays: e.target.value })} disabled={i === 0} />
                </label>
                <label className="oseq-check"><input type="checkbox" checked={s.sameThread} onChange={(e) => changeStep(s.key, { sameThread: e.target.checked })} disabled={i === 0} /> In the same thread as the first email</label>
                <label className="wide">Subject{threaded ? ' (not used: the thread keeps its subject)' : ''}
                  <input className="search" value={s.subject} onChange={(e) => changeStep(s.key, { subject: e.target.value })} />
                </label>
                <label className="wide">Text
                  <textarea className="oseq-text" value={s.body} onChange={(e) => changeStep(s.key, { body: e.target.value })} rows={8} />
                </label>
                {variants.length > 0 && (
                  <label>Share of this wording against its variants (empty = {DEFAULT_WEIGHT})
                    <input className="search" inputMode="numeric" value={s.weightText} onChange={(e) => changeStep(s.key, { weightText: e.target.value })} />
                  </label>
                )}
                {variants.length > 0 && <div className="muted oseq-hint">This wording: {sentLine(s.id)}</div>}
              </div>

              {variants.map((v, n) => (
                <div key={v.key} className={`oseq-variant ${v.enabled ? '' : 'off'}`}>
                  <div className="oseq-row">
                    <b>Variant {n + 1}</b>
                    {!v.enabled && <span className="chip gray">Off</span>}
                    {!v.id && <span className="chip blue">New</span>}
                    <span className="muted">{v.id ? sentLine(v.id) : 'Not sent yet'}</span>
                    <div className="spacer" />
                    <button className="mini" onClick={() => changeStep(v.key, { enabled: !v.enabled })}>{v.enabled ? 'Switch off' : 'Switch on'}</button>
                    <button className="mini danger" onClick={() => remove(v)}>Delete</button>
                  </div>
                  <div className="oseq-fields">
                    <label>Share (empty = {DEFAULT_WEIGHT})
                      <input className="search" inputMode="numeric" value={v.weightText} onChange={(e) => changeStep(v.key, { weightText: e.target.value })} />
                    </label>
                    {!threaded && (
                      <label className="wide">Subject
                        <input className="search" value={v.subject} onChange={(e) => changeStep(v.key, { subject: e.target.value })} />
                      </label>
                    )}
                    <label className="wide">Text
                      <textarea className="oseq-text" value={v.body} onChange={(e) => changeStep(v.key, { body: e.target.value })} rows={6} />
                    </label>
                  </div>
                </div>
              ))}

              <div className="oseq-row">
                <button className="mini" onClick={() => insertAfter(i, blankStep(false))}>+ Add a step after this one</button>
                <button className="mini" onClick={() => addVariant(s)} disabled={!s.id} title={s.id ? 'Another wording of this step. Each lead always gets the same one.' : 'Save the sequence first: a variant belongs to a saved step.'}>+ Variant</button>
              </div>
            </div>
          );
        })}

        <div className="oseq-card">
          <div className="oseq-row">
            <b>Preview</b>
            {draft.sequenceId
              ? <>
                <button className="mini" onClick={() => runPreview(0)} disabled={previewing}>{previewing ? 'Loading…' : preview ? 'Refresh' : 'Show with a real lead'}</button>
                {preview?.ok && <button className="mini" onClick={() => runPreview(previewSkip + 1)} disabled={previewing}>Another lead</button>}
                <span className="muted">Nothing is sent. It shows the texts as they are now, saved or not.</span>
              </>
              : <span className="muted">Save the sequence once to preview it with a real lead.</span>}
          </div>
          {preview && !preview.ok && <div className="oseq-note bad">{preview.error || 'The preview could not be built.'}</div>}
          {preview?.ok && preview.lead && (
            <>
              <div className="muted oseq-hint">To {preview.lead.name || 'a lead without a name'} &lt;{preview.lead.email || 'no email'}&gt; · {preview.lead.category || 'no category'}</div>
              {(preview.steps || []).map((p, n) => (
                <div key={p.id} className="oseq-mail">
                  <div className="oseq-row">
                    <b>Email {n + 1}</b><span className="muted">day {p.day ?? '?'}</span>
                    {p.unknown.length > 0 && <span className="chip red">Not a variable: {p.unknown.join(', ')}</span>}
                    {p.missing.length > 0 && <span className="chip amber">This lead has no {p.missing.join(', ')}</span>}
                  </div>
                  <div className="oseq-subject">{p.sameThread && n > 0 ? 'In the thread of the first email' : p.subject || 'No subject'}</div>
                  <pre className="wp-text">{p.body}</pre>
                </div>
              ))}
              {!(preview.steps || []).length && <div className="muted oseq-hint">No step is switched on.</div>}
            </>
          )}
        </div>

        {check && (
          <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) setCheck(null); }}>
            <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Before you save">
              <div className="modal-head">
                <div>
                  <div className="modal-title">Before you save</div>
                  <div className="modal-sub">
                    {check.leadsKnown === false
                      ? 'The leads in this sequence could not be counted, so the numbers below are not real.'
                      : `${check.activeLeads || 0} ${check.activeLeads === 1 ? 'lead is' : 'leads are'} in this sequence right now${check.capped ? ' (counted up to the limit)' : ''}.`}
                  </div>
                </div>
              </div>
              <div className="modal-body">
                {!(check.impact || []).length && <div className="oseq-hint">Nothing in this edit changes what the leads in the sequence get.</div>}
                {(check.impact || []).map((it, n) => <div key={n} className={`oseq-impact ${it.kind === 'removed' ? 'bad' : ''}`}>{it.text}</div>)}
                <div className="oseq-hint muted">A lead who already got a step never gets that step again. A due date that is already set is not moved by a save.</div>
                {(check.errors || []).length > 0 && <div className="oseq-note">{draft.enabled ? 'It cannot be saved switched on: ' : 'Still to fix before it can be switched on: '}{(check.errors || []).join(' ')}</div>}
                {saveError && <div className="oseq-note bad">{saveError}</div>}
                <div className="oseq-row oseq-actions">
                  <button className="btn primary" onClick={write} disabled={saving || blocked}>{saving ? 'Saving…' : 'Save'}</button>
                  <button className="btn" onClick={() => setCheck(null)} disabled={saving}>Back to the editor</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">📨 Sequences</div>
        <div className="spacer" />
        <button className="btn" onClick={() => load()} disabled={loading}>⟳ Refresh</button>
        <button className="btn" onClick={readSignals} disabled={signals.running} title="Read the websites of the leads that have an email, for online booking, online ordering and an Instagram link. The second-round offer uses these. Only the three short values are stored.">{signals.running ? 'Reading…' : 'Read website signals'}</button>
        <button className="btn primary" onClick={() => open(NEW_DRAFT())}>+ New sequence</button>
      </div>
      {signals.text && <div className="oseq-note">{signals.text}</div>}
      <UnknownSends />
      {loading && !list.length && <div className="empty">Loading…</div>}
      {!loading && loadError && <div className="empty">{loadError} <button className="mini" onClick={() => load()}>Try again</button></div>}
      {!loading && !loadError && !list.length && <div className="empty">No sequences yet. Create the first one with <b>+ New sequence</b>. It starts switched off.</div>}
      <div className="oseq-list">
        {list.map((s) => (
          <div key={s.sequenceId} className="oseq-card oseq-item" onClick={() => open(draftOf(s), s.sentByStep)}>
            <div className="oseq-row">
              <b>{s.name}</b>
              <span className={`chip ${s.enabled ? 'green' : 'gray'}`}>{s.enabled ? 'On' : 'Off'}</span>
              <span className="chip blue">{s.language === 'hu' ? 'Hungarian' : 'English'}</span>
              {s.errors.length > 0 && <span className="chip amber" title={s.errors.join(' ')}>Not complete</span>}
              <div className="spacer" />
              <button className="mini" onClick={(e) => { e.stopPropagation(); open(draftOf(s), s.sentByStep); }}>Edit</button>
              <button className="mini danger" onClick={(e) => { e.stopPropagation(); setDelError(''); setConfirmDel(s.sequenceId); }}>Delete</button>
            </div>
            {confirmDel === s.sequenceId && (
              <div className="oseq-row" onClick={(e) => e.stopPropagation()}>
                <span>Delete &quot;{s.name}&quot;?{s.activeLeads ? ` ${s.activeLeads.toLocaleString()} ${s.activeLeads === 1 ? 'lead is' : 'leads are'} in it right now and will be taken out of it.` : ''} This cannot be undone. Switching it off keeps it.</span>
                <button className="mini danger" disabled={deleting} onClick={() => del(s)}>{deleting ? 'Deleting…' : 'Yes, delete'}</button>
                <button className="mini" disabled={deleting} onClick={() => setConfirmDel('')}>Keep it</button>
                {delError && <span className="chip red">{delError}</span>}
              </div>
            )}
            <div className="oseq-row muted">
              <span>{s.steps.filter((x) => x.enabled && !x.variantOf).length} of {s.steps.filter((x) => !x.variantOf).length} steps on</span>
              <span>{s.activeLeads === null ? 'Leads in it: unknown' : `${s.activeLeads.toLocaleString()} ${s.activeLeads === 1 ? 'lead' : 'leads'} in it now`}</span>
              <span>{s.sentLast7.toLocaleString()} sent in the last 7 days</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
