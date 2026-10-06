'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ControlState, SenderInput, SenderTest } from '@/lib/api';
import type { OutreachSenderRow } from '@/lib/types';
import { DEFAULT_DAILY_LIMIT, DEFAULT_TIERS, describeWarmup, normalizeTiers, validateWarmup, warmupStatus } from '@/lib/warmup.mjs';

// Senders tab: the mailboxes outreach is sent from. The one screen for daily
// operation: which accounts are on, what each sent today, where each stands in
// its warm-up. The app password can be typed in here but never read back: the
// server answers only whether one is stored.

// The form holds numbers as the text being typed; they become numbers on save.
interface TierText { fromDay: string; dailyLimit: string }
type TextKey = 'label' | 'fromName' | 'fromEmail' | 'language' | 'authUser' | 'password' | 'smtpHost' | 'smtpPort' | 'imapHost' | 'imapPort' | 'notes' | 'dailyLimit' | 'windowFrom' | 'windowTo';
type FormState = Record<TextKey, string> & { warmupOn: boolean; tiers: TierText[]; firstSendAt: string; sendDays: number[] };
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

const tierText = (tiers: { fromDay: number; dailyLimit: number }[]): TierText[] => tiers.map((t) => ({ fromDay: String(t.fromDay), dailyLimit: String(t.dailyLimit) }));
// an empty box is "not a number", never 0
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

const EMPTY: FormState = {
  label: '', fromName: '', fromEmail: '', language: 'en', authUser: '', password: '',
  smtpHost: 'smtp.gmail.com', smtpPort: '587', imapHost: 'imap.gmail.com', imapPort: '993', notes: '',
  dailyLimit: String(DEFAULT_DAILY_LIMIT), warmupOn: true, tiers: tierText(DEFAULT_TIERS), firstSendAt: '',
  windowFrom: '7', windowTo: '19', sendDays: [1, 2, 3, 4, 5],
};

const formOf = (s: OutreachSenderRow): FormState => ({
  label: s.label, fromName: s.fromName, fromEmail: s.fromEmail, language: s.language, authUser: s.authUser, password: '',
  smtpHost: s.smtpHost, smtpPort: String(s.smtpPort || ''), imapHost: s.imapHost, imapPort: String(s.imapPort || ''), notes: s.notes,
  dailyLimit: String(s.dailyLimit), warmupOn: s.warmup.enabled, tiers: tierText(s.warmup.tiers.length ? s.warmup.tiers : DEFAULT_TIERS), firstSendAt: s.firstSendAt,
  windowFrom: String(s.windowFrom), windowTo: String(s.windowTo), sendDays: s.sendDays,
});

// The limits of the form as the server will store them.
const limitsOf = (f: FormState) => ({
  dailyLimit: num(f.dailyLimit),
  warmup: { enabled: f.warmupOn, tiers: normalizeTiers(f.tiers.map((t) => ({ fromDay: num(t.fromDay), dailyLimit: num(t.dailyLimit) }))) as { fromDay: number; dailyLimit: number }[] },
});

const inputOf = (f: FormState): SenderInput => ({
  label: f.label, fromName: f.fromName, fromEmail: f.fromEmail, language: f.language, authUser: f.authUser, password: f.password,
  smtpHost: f.smtpHost, smtpPort: f.smtpPort, imapHost: f.imapHost, imapPort: f.imapPort, notes: f.notes,
  ...limitsOf(f),
  sendDays: f.sendDays, windowFrom: num(f.windowFrom), windowTo: num(f.windowTo),
});

// What the limits of the form come to today, by the same functions the
// dispatcher uses, or what is wrong with them.
function limitLine(f: FormState): { bad: boolean; text: string } {
  const limits = limitsOf(f);
  if (!(Number.isInteger(limits.dailyLimit) && limits.dailyLimit >= 0)) return { bad: true, text: 'The daily ceiling must be a whole number, 0 or more.' };
  const problem = f.warmupOn ? validateWarmup(limits.warmup.tiers) : null;
  if (problem) return { bad: true, text: problem };
  return { bad: false, text: describeWarmup({ ...limits, firstSendAt: f.firstSendAt }, new Date()) };
}

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function OutreachSenders() {
  const [senders, setSenders] = useState<OutreachSenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // '' = no form open, 'new' = the add form, otherwise the senderId being edited
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState<Record<string, SenderTest>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // the account whose "today" panel is open, and the state of the day it shows
  const [todayOf, setTodayOf] = useState('');
  const [control, setControl] = useState<ControlState | null>(null);
  const [controlError, setControlError] = useState('');
  const openToday = (senderId: string) => {
    setTodayOf((id) => (id === senderId ? '' : senderId));
    setControlError('');
    api.getControl()
      .then((r) => { if (r.ok) setControl(r); else setControlError(r.error || 'The state of the day could not be loaded.'); })
      .catch(() => setControlError('The state of the day could not be loaded.'));
  };

  const load = useCallback(() => {
    setLoading(true);
    api.getSenders()
      .then((r) => { if (r.ok) { setSenders(r.senders || []); setLoadError(''); } else setLoadError(r.error || 'The sender accounts could not be loaded.'); })
      .catch(() => setLoadError('The sender accounts could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openForm = (id: string, values: FormState) => { setEditing(id); setForm(values); setFormError(''); };
  const setTier = (i: number, k: keyof TierText, v: string) => setForm((f) => ({ ...f, tiers: f.tiers.map((t, n) => (n === i ? { ...t, [k]: v } : t)) }));
  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setFormError('');
    try {
      const r = editing === 'new' ? await api.addSender(inputOf(form)) : await api.updateSender(editing, inputOf(form));
      if (!r.ok) { setFormError(r.error || 'The account could not be saved.'); return; }
      setEditing('');
      setForm(EMPTY); // the typed password does not stay in memory
      load();
    } catch {
      setFormError('Network error. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  // one action on one account at a time; `what` names it for the button label
  const act = async (s: OutreachSenderRow, what: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(`${s.senderId}:${what}`);
    setRowError((m) => ({ ...m, [s.senderId]: '' }));
    try {
      const r = await run();
      if (!r.ok) setRowError((m) => ({ ...m, [s.senderId]: r.error || 'That did not work.' }));
      return r;
    } catch {
      setRowError((m) => ({ ...m, [s.senderId]: 'Network error.' }));
      return null;
    } finally {
      setBusy('');
    }
  };

  const test = async (s: OutreachSenderRow) => {
    setTests((m) => { const next = { ...m }; delete next[s.senderId]; return next; });
    const r = await act(s, 'test', () => api.testSender(s.senderId));
    if (r && r.ok) setTests((m) => ({ ...m, [s.senderId]: r as SenderTest }));
  };
  const toggle = async (s: OutreachSenderRow) => { if (await act(s, 'toggle', () => api.updateSender(s.senderId, { active: !s.active }))) load(); };
  const restart = async (s: OutreachSenderRow) => {
    if (!confirm(`Restart the warm-up of ${s.fromEmail}? It goes back to the first tier, and the days count again from its next email.`)) return;
    if (await act(s, 'restart', () => api.updateSender(s.senderId, { restartWarmup: true }))) load();
  };

  const renderForm = () => {
    const line = limitLine(form);
    return (
    <form onSubmit={save}>
      <div className="snd-form">
        <label>Label<input className="search" value={form.label} onChange={set('label')} placeholder="Tom, English" /></label>
        <label>Language
          <select className="select" value={form.language} onChange={set('language')}>
            <option value="en">English</option>
            <option value="hu">Hungarian</option>
          </select>
        </label>
        <label>From name (a person, not a company)<input className="search" value={form.fromName} onChange={set('fromName')} /></label>
        <label>From address<input className="search" type="email" value={form.fromEmail} onChange={set('fromEmail')} /></label>
        <label>Login name (empty = the From address)<input className="search" value={form.authUser} onChange={set('authUser')} autoComplete="off" /></label>
        <label>App password
          <input className="search" type="password" value={form.password} onChange={set('password')} autoComplete="new-password"
            placeholder={editing === 'new' ? '16 characters from the Google account' : 'Leave empty to keep the stored one'} />
        </label>
        <label>SMTP host (Gmail only)<input className="search" value={form.smtpHost} onChange={set('smtpHost')} /></label>
        <label>SMTP port<input className="search" inputMode="numeric" value={form.smtpPort} onChange={set('smtpPort')} /></label>
        <label>IMAP host (Gmail only)<input className="search" value={form.imapHost} onChange={set('imapHost')} /></label>
        <label>IMAP port<input className="search" inputMode="numeric" value={form.imapPort} onChange={set('imapPort')} /></label>
        <label className="wide">Notes<input className="search" value={form.notes} onChange={set('notes')} /></label>
        <label>Sends from this hour, on the recipient's clock<input className="search" inputMode="numeric" value={form.windowFrom} onChange={set('windowFrom')} /></label>
        <label>Until this hour<input className="search" inputMode="numeric" value={form.windowTo} onChange={set('windowTo')} /></label>
        <div className="wide snd-days">
          <span>Sending days, on the recipient's calendar</span>
          {DAYS.map(([d, name]) => (
            <label key={d}><input type="checkbox" checked={form.sendDays.includes(d)} onChange={(e) => setForm((f) => ({ ...f, sendDays: e.target.checked ? [...f.sendDays, d].sort() : f.sendDays.filter((x) => x !== d) }))} /> {name}</label>
          ))}
        </div>
        <label>Daily ceiling (no tier can lift it)<input className="search" inputMode="numeric" value={form.dailyLimit} onChange={set('dailyLimit')} /></label>
        <label>Warm-up
          <select className="select" value={form.warmupOn ? 'on' : 'off'} onChange={(e) => setForm((f) => ({ ...f, warmupOn: e.target.value === 'on' }))}>
            <option value="on">On: the tiers below set the daily limit</option>
            <option value="off">Off: the ceiling is the daily limit</option>
          </select>
        </label>
      </div>
      <div className="snd-tiers">
        <div className="snd-tier snd-tier-head"><span>From day</span><span>Emails a day</span><span /></div>
        {form.tiers.map((t, i) => (
          <div key={i} className="snd-tier">
            <input className="search" inputMode="numeric" aria-label="From day" value={t.fromDay} onChange={(e) => setTier(i, 'fromDay', e.target.value)} />
            <input className="search" inputMode="numeric" aria-label="Emails a day" value={t.dailyLimit} onChange={(e) => setTier(i, 'dailyLimit', e.target.value)} />
            <button className="mini danger" type="button" onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, n) => n !== i) }))}>Remove</button>
          </div>
        ))}
        <div><button className="mini" type="button" onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, { fromDay: '', dailyLimit: '' }] }))}>+ Add tier</button></div>
      </div>
      <div className={`snd-msg ${line.bad ? 'bad' : ''}`}>{line.text}</div>
      {formError && <div className="snd-msg bad">{formError}</div>}
      <div className="snd-actions">
        <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing === 'new' ? 'Add account' : 'Save'}</button>
        <button className="btn" type="button" disabled={saving} onClick={() => { setEditing(''); setForm(EMPTY); }}>Cancel</button>
      </div>
    </form>
    );
  };

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">✉️ Senders</div>
        <div className="spacer" />
        <button className="btn" onClick={load} disabled={loading}>⟳ Refresh</button>
        <button className="btn primary" onClick={() => openForm('new', EMPTY)} disabled={editing === 'new'}>+ Add account</button>
      </div>

      {editing === 'new' && (
        <div className="snd-card">
          <div className="snd-name">New sender account</div>
          {renderForm()}
        </div>
      )}

      {loading && !senders.length && <div className="empty">Loading…</div>}
      {!loading && loadError && <div className="empty">{loadError} <button className="mini" onClick={load}>Try again</button></div>}
      {!loading && !loadError && !senders.length && editing !== 'new' && (
        <div className="empty">No sender accounts yet. Add the first one with <b>+ Add account</b>. It starts switched off.</div>
      )}

      <div className="snd-list">
        {senders.map((s) => {
          const t = tests[s.senderId];
          const doing = (what: string) => busy === `${s.senderId}:${what}`;
          return (
            <div key={s.senderId} className="snd-card">
              <div className="snd-head">
                <button className="snd-name snd-open" onClick={() => openToday(s.senderId)} aria-expanded={todayOf === s.senderId} title="What this account does today, and what is left for you to do">{s.label || s.fromEmail} {todayOf === s.senderId ? '▾' : '▸'}</button>
                <span className={`chip ${s.active ? 'green' : 'gray'}`}>{s.active ? 'On' : 'Off'}</span>
                <span className="chip blue">{s.language === 'hu' ? 'Hungarian' : 'English'}</span>
                {!s.hasPassword && <span className="chip red">No password stored</span>}
                {s.warmup.enabled && !s.warmup.tiers.length && <span className="chip red" title="The warm-up is switched on but no tiers are stored, so the account's ceiling is its limit. Open Edit and press Save.">Warm-up tiers are missing: open Edit and save</span>}
                <span className="muted snd-from">{s.fromName} &lt;{s.fromEmail}&gt;</span>
                <span className="spacer" />
                <button className="mini" onClick={() => test(s)} disabled={!!busy}>{doing('test') ? 'Testing…' : 'Test connection'}</button>
                <button className="mini" onClick={() => toggle(s)} disabled={!!busy}>{doing('toggle') ? 'Saving…' : s.active ? 'Switch off' : 'Switch on'}</button>
                <button className="mini" onClick={() => openForm(s.senderId, formOf(s))} disabled={editing === s.senderId}>Edit</button>
              </div>
              <div className="snd-stats">
                <span>Sent today <b>{s.sentToday} of {s.capToday}</b></span>
                <span>Sends <b>{DAYS.filter(([d]) => s.sendDays.includes(d)).map(([, n]) => n).join(' ')}, {s.windowFrom}:00 to {s.windowTo}:00</b> where the lead is</span>
                <span>Last send round <b>{when(s.lastTickAt)}</b></span>
                <span>Last inbox check <b>{when(s.lastCheckedAt)}</b></span>
              </div>
              <div className="snd-stats">
                <span>{describeWarmup(s, new Date())} <button className="mini" onClick={() => restart(s)} disabled={!!busy}>{doing('restart') ? 'Saving…' : 'Restart warm-up'}</button></span>
              </div>
              {todayOf === s.senderId && (() => {
                const mine = control?.senders?.find((c) => c.senderId === s.senderId);
                const now = warmupStatus(s, new Date()) as { tier: { fromDay: number } | null; day: number | null };
                const gate = control?.gate;
                return (
                  <div className="snd-today">
                    <div className="snd-stats">
                      <span>Today <b>{s.sentToday} of {mine ? mine.capToday : s.capToday}</b></span>
                      {mine && <span>Tomorrow <b>{mine.capTomorrow}</b></span>}
                      <span>{now.day === null ? 'No email sent yet: the warm-up days start with the first one' : `Day ${now.day} since the first email`}</span>
                      {!s.active && <span className="chip gray">Switched off: it sends nothing</span>}
                    </div>
                    {s.warmup.enabled && s.warmup.tiers.length > 0
                      ? (
                        <div className="snd-tiers">
                          <div className="snd-tier snd-tier-head"><span>From day</span><span>Emails a day</span><span /></div>
                          {s.warmup.tiers.map((t) => (
                            <div key={t.fromDay} className="snd-tier">
                              <span>{t.fromDay}</span><span>{t.dailyLimit}</span>
                              <span>{now.tier && now.tier.fromDay === t.fromDay ? <span className="chip green">Now</span> : null}</span>
                            </div>
                          ))}
                        </div>
                      )
                      : <div className="snd-msg bad">{s.warmup.enabled ? 'The warm-up is on but has no tiers stored' : 'The warm-up is off'}: this account may send {s.dailyLimit} a day from its first day. Open Edit and save it with its tiers.</div>}
                    <div className="snd-name">What is left for you today</div>
                    {!control && !controlError && <div className="snd-msg muted">Loading…</div>}
                    {controlError && <div className="snd-msg bad">{controlError}</div>}
                    {gate && gate.blockers.map((b, i) => <div key={`b${i}`} className="snd-msg bad">Blocks sending: {b}</div>)}
                    {gate && gate.warnings.map((w, i) => <div key={`w${i}`} className="snd-msg">Worth a look: {w}</div>)}
                    {gate && !gate.blockers.length && !gate.warnings.length && <div className="snd-msg good">Nothing. Sending is allowed, and the daily limit is kept by the system itself.</div>}
                    <div className="snd-msg muted">The limit rises by itself as the days pass; there is nothing to raise by hand. The full list for the day is on the Control tab.</div>
                  </div>
                );
              })()}
              {s.notes && <div className="snd-msg muted">{s.notes}</div>}
              {rowError[s.senderId] && <div className="snd-msg bad">{rowError[s.senderId]}</div>}
              {t && t.smtp && t.imap && (
                <div className={`snd-msg ${t.works ? 'good' : 'bad'}`}>{t.smtp.message} {t.imap.message}</div>
              )}
              {editing === s.senderId && renderForm()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
