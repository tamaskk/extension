'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ControlState } from '@/lib/api';
import type { OutreachSequenceRow } from '@/lib/types';

// Control tab: may anything be sent today, and if not, exactly why. It shows
// the answer of the same gate the send round asks on every call; the round
// refuses to send while the gate is shut, whatever this screen says. Also the
// one place that shows whether the runner tab on the always-on machine is alive.

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function WarmupConsole() {
  const [state, setState] = useState<ControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [seedInbox, setSeedInbox] = useState('');
  const [seedOf, setSeedOf] = useState('');
  const [addresses, setAddresses] = useState('');
  const [sequences, setSequences] = useState<OutreachSequenceRow[]>([]);
  const [seedSender, setSeedSender] = useState('');
  const [seedSequence, setSeedSequence] = useState('');
  const [seedStep, setSeedStep] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getControl()
      .then((r) => {
        if (!r.ok) { setError(r.error || 'The state could not be loaded.'); return; }
        setState(r); setError('');
        setAddresses((r.settings?.seedAddresses || []).join('\n'));
        setSeedOf((v) => v || String(r.settings?.seedAddresses?.length || ''));
      })
      .catch(() => setError('The state could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  // the sequences are only needed to choose what a seed test sends; the screen works without them
  useEffect(() => { api.getSequences().then((r) => { if (r.ok) setSequences(r.sequences || []); }).catch(() => setSequences([])); }, []);

  const save = async (what: string, run: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(what); setNote('');
    try {
      const r = await run();
      setNote(r.ok ? done : r.error || 'That could not be saved.');
      if (r.ok) load();
    } catch {
      setNote('Network error. Nothing was changed.');
    } finally {
      setBusy('');
    }
  };

  const gate = state?.gate;
  const settings = state?.settings;
  const beat = state?.heartbeat;
  const steps = sequences.find((s) => s.sequenceId === seedSequence)?.steps.filter((s) => !s.variantOf) || [];

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🚦 Control</div>
        {gate && <span className={`chip ${gate.allowed ? 'green' : 'red'}`}>{gate.allowed ? 'Sending is allowed' : 'Sending is blocked'}</span>}
        <div className="spacer" />
        <button className="btn" onClick={load} disabled={loading}>⟳ Refresh</button>
        {gate && (gate.allowed
          ? <a className="btn primary" href="/outreach/runner" target="_blank" rel="noreferrer">Open the runner tab</a>
          : <button className="btn primary" disabled title={gate.blockers[0]}>Open the runner tab</button>)}
      </div>
      {loading && !state && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={load}>Try again</button></div>}
      {note && <div className="oseq-note">{note}</div>}

      {state && gate && settings && beat && !error && (
        <>
          {!gate.allowed && (
            <div className="oseq-card">
              <div className="oseq-row"><b>Why nothing is sent</b><span className="muted">The send round checks these itself on every call.</span></div>
              {gate.blockers.map((b, i) => <div key={i} className="oseq-impact bad">{b}</div>)}
            </div>
          )}
          {gate.warnings.length > 0 && (
            <div className="oseq-card">
              <div className="oseq-row"><b>Worth a look</b></div>
              {gate.warnings.map((w, i) => <div key={i} className="oseq-impact owc-warn">{w}</div>)}
            </div>
          )}

          <div className="oseq-card">
            <div className="oseq-row">
              <b>The send loop</b>
              <span className={`chip ${beat.stale ? 'red' : 'green'}`}>{beat.stale ? 'Not running' : 'Running'}</span>
              <span className="muted">Last round {when(beat.lastTickAt)}</span>
            </div>
            <div className="oseq-hint">{beat.reason || 'No round has run yet.'}</div>
            {beat.stale && <div className="muted oseq-hint">A loop that died gives no error, only silence. Check the runner tab on the always-on machine: is the browser open, is it logged in.</div>}
          </div>

          <div className="oseq-card">
            <div className="oseq-row"><b>Senders today</b><span className="muted">{gate.capToday.toLocaleString()} in all today · last 7 days: {state.rates?.sent.toLocaleString()} accepted, {state.rates?.bounced} bounced, {state.rates?.blocked} blocked</span></div>
            {!(state.senders || []).length && <div className="muted oseq-hint">No sender account is switched on with a stored password.</div>}
            {(state.senders || []).map((s) => (
              <div key={s.senderId} className="owc-sender">
                <div className="oseq-row">
                  <b>{s.label}</b>
                  <span className="chip blue">{s.language === 'hu' ? 'Hungarian' : 'English'}</span>
                  <span>Today <b>{s.sentToday} of {s.capToday}</b></span>
                  <span>Tomorrow <b>{s.capTomorrow}</b></span>
                  {s.steppedBack && <span className="chip amber">Stepped back: nothing sent for {s.idleDays} days</span>}
                </div>
                <div className="muted oseq-hint">{s.warmup}</div>
              </div>
            ))}
          </div>

          <div className="oseq-card">
            <div className="oseq-row"><b>Checked by hand</b><span className="muted">The gate judges by these, each with its date.</span></div>
            <div className="oseq-row">
              <span>SPF, DKIM and DMARC all pass in "Show original" of a test email: <b>{settings.authConfirmedAt ? `confirmed on ${settings.authConfirmedAt}` : 'not confirmed'}</b></span>
              <button className="mini" disabled={!!busy} onClick={() => save('auth', () => api.saveControl({ authConfirmed: !settings.authConfirmedAt }), settings.authConfirmedAt ? 'Confirmation withdrawn.' : 'Confirmed.')}>{settings.authConfirmedAt ? 'Withdraw' : 'I checked: all three pass'}</button>
            </div>
            <div className="oseq-row">
              <span>Replies read: <b>{when(settings.repliesReviewedAt)}</b>{state.unseenReplies ? `, ${state.unseenReplies} not read yet` : ''}</span>
              <button className="mini" disabled={!!busy} onClick={() => save('replies', () => api.saveControl({ repliesReviewed: true }), 'Noted.')}>I have read the replies</button>
            </div>
            <div className="oseq-row">
              <span>Postmaster Tools spam rate: <b>{settings.postmaster.spamRate === null ? 'never entered' : `${settings.postmaster.spamRate} % as of ${settings.postmaster.date}`}</b></span>
              <span className="muted">Enter it on the Report tab.</span>
            </div>
          </div>

          <div className="oseq-card">
            <div className="oseq-row">
              <b>Seed test</b>
              <span>Last result: <b>{settings.seed.date ? `${settings.seed.inbox} of ${settings.seed.of} in the inbox, on ${settings.seed.date}` : 'none yet'}</b></span>
            </div>
            <div className="muted oseq-hint">No bounce does not mean the inbox. Send the step to mailboxes of your own at several providers, open each one, and count where it landed. Gmail's Promotions tab is not spam, but for a cold email it is nearly as bad.</div>
            <div className="oseq-fields">
              <label className="wide">Seed addresses, one per line (up to 10; not your everyday mailboxes)
                <textarea className="oseq-text" rows={4} value={addresses} onChange={(e) => setAddresses(e.target.value)} />
              </label>
            </div>
            <div className="oseq-row">
              <button className="mini" disabled={!!busy} onClick={() => save('addresses', () => api.saveControl({ seedAddresses: addresses.split(/[\s,;]+/).filter(Boolean) }), 'Seed addresses saved.')}>Save addresses</button>
            </div>
            <div className="oseq-row">
              <select className="select" value={seedSender} onChange={(e) => setSeedSender(e.target.value)} aria-label="Sender of the seed test">
                <option value="">From which sender…</option>
                {(state.senders || []).map((s) => <option key={s.senderId} value={s.senderId}>{s.label}</option>)}
              </select>
              <select className="select" value={seedSequence} onChange={(e) => { setSeedSequence(e.target.value); setSeedStep(''); }} aria-label="Sequence of the seed test">
                <option value="">Which sequence…</option>
                {sequences.map((s) => <option key={s.sequenceId} value={s.sequenceId}>{s.name}</option>)}
              </select>
              <select className="select" value={seedStep} onChange={(e) => setSeedStep(e.target.value)} aria-label="Step of the seed test" disabled={!seedSequence}>
                <option value="">Which step…</option>
                {steps.map((s, i) => <option key={s.id} value={s.id}>Step {i + 1}{s.subject ? `: ${s.subject.slice(0, 40)}` : ''}</option>)}
              </select>
              <button className="btn" disabled={!!busy || !seedSender || !seedStep || !settings.seedAddresses.length}
                title={!settings.seedAddresses.length ? 'Save the seed addresses first.' : !seedSender || !seedStep ? 'Choose a sender, a sequence and a step.' : undefined}
                onClick={() => { if (confirm(`Send this step to the ${settings.seedAddresses.length} seed ${settings.seedAddresses.length === 1 ? 'address' : 'addresses'} now?`)) save('seed', async () => { const r = await api.sendSeedTest(seedSender, seedSequence, seedStep); return { ok: r.ok, error: r.error || (r.failed?.length ? `${r.failed.length} could not be sent.` : undefined) }; }, 'Seed test sent. Open each mailbox and count where it landed.'); }}>
                {busy === 'seed' ? 'Sending…' : 'Send seed test'}
              </button>
            </div>
            <div className="oseq-row">
              <label className="orep-inline">In the inbox <input className="search" inputMode="numeric" value={seedInbox} onChange={(e) => setSeedInbox(e.target.value)} /></label>
              <label className="orep-inline">out of <input className="search" inputMode="numeric" value={seedOf} onChange={(e) => setSeedOf(e.target.value)} /></label>
              <button className="mini" disabled={!!busy || seedInbox.trim() === '' || seedOf.trim() === ''} onClick={() => save('result', () => api.saveControl({ seed: { inbox: Number(seedInbox), of: Number(seedOf) } }), 'Seed result saved with today\'s date.')}>Save today's result</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
