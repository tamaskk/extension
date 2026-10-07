'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { SuggestedLead, TodayPlanData, TodayQueueRow } from '@/lib/api';
import { COUNTRY_CITIES, COUNTRY_NAMES } from '@/lib/countries';
import { STATE_REGIONS } from '@/lib/regionNames';
import EmailPreviewModal from './EmailPreviewModal';
import PlacePickerModal from './PlacePickerModal';

// Campaign tab: the day on one screen. Is sending allowed, is the loop alive,
// which sequences run, who is in line for today and what will become of each,
// and what went out already. Sequences are switched on and off here and leads
// are put into them; the emails themselves go out from the runner tab.

const REFRESH_MS = 30_000;
const DEFAULT_PICK = 5;
// Hungarian is written to Hungary only; English to every other country (lib/enrollPlan.mjs)
const countriesOf = (language: string) => (language === 'hu' ? ['Hungary'] : COUNTRY_NAMES.filter((c) => c !== 'Hungary'));
const SKIP_TEXT: Record<string, string> = {
  badEmail: 'bad address', noMx: 'domain takes no mail', active: 'already in a sequence', replied: 'replied before', suppressed: 'on the suppression list',
  alreadyMailed: 'written to before', languageUnknown: 'language unknown', language: 'other language', noTimezone: 'time zone unknown', domain: 'company already in a sequence', noSender: 'no sender free',
};
// with seconds: when exactly an email left is what the operator checks here
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const minute = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

const FATE: Record<TodayQueueRow['fate'], { cls: string; text: string }> = {
  today: { cls: 'green', text: 'Goes out today' },
  hours: { cls: 'blue', text: 'Today, in sending hours' },
  next: { cls: 'blue', text: 'After midnight, tomorrow\'s limit' },
  limit: { cls: 'amber', text: 'Over today\'s limit' },
  closed: { cls: 'gray', text: 'Not in the next day' },
  off: { cls: 'gray', text: 'Sequence is off' },
};
const OUTCOME: Record<string, string> = {
  sent: 'green', delivered: 'green', replied: 'blue', sending: 'amber', unknown: 'amber',
  failed: 'red', bounced: 'red', blocked: 'red', complained: 'red', stopped: 'gray',
};

export default function CampaignToday({ reloadKey, onEnroll, onEditSequences }: { reloadKey: number; onEnroll: () => void; onEditSequences: () => void }) {
  const [data, setData] = useState<TodayPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  // the leads picked for a start: shown first, put into the sequence only on the button
  const [pickSeq, setPickSeq] = useState('');
  const [pickCountry, setPickCountry] = useState('');
  const [pickN, setPickN] = useState(String(DEFAULT_PICK));
  const [pickRegion, setPickRegion] = useState(''); // a US state or a city; '' = the whole country
  const [pickPlace, setPickPlace] = useState('');   // a town of the state or an area of the city; '' = all of it
  const [picks, setPicks] = useState<SuggestedLead[] | null>(null);
  const [seen, setSeen] = useState<string[]>([]); // shown before or turned down: not offered again
  const [picking, setPicking] = useState('');
  const [pickMsg, setPickMsg] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [previewOf, setPreviewOf] = useState<{ sequenceId: string; lead?: { project: string; dedupKey: string } } | null>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    return api.getTodayPlan()
      .then((r) => { if (r.ok) { setData(r); setError(''); } else setError(r.error || 'The plan of the day could not be loaded.'); })
      .catch(() => setError('The plan of the day could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  // again after an enrolment, and by itself while the tab is open: the queue moves as emails go out
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (sequenceId: string, name: string, enabled: boolean) => {
    setBusy(sequenceId); setMsg('');
    try {
      const r = await api.updateSequence(sequenceId, { enabled });
      if (!r.ok) { setMsg(r.error || 'That could not be saved.'); return; }
      setMsg(enabled ? `"${name}" is switched on.` : `"${name}" is switched off. Its leads stay in it and wait.`);
      await load(true);
    } catch {
      setMsg('Network error. Nothing was changed.');
    } finally {
      setBusy('');
    }
  };

  const sequences = data?.sequences || [];
  const seq = sequences.find((s) => s.sequenceId === pickSeq) || sequences.find((s) => s.enabled) || sequences[0];
  const countries = seq ? countriesOf(seq.language) : [];
  const country = countries.includes(pickCountry) ? pickCountry : countries[0] || '';
  const regions = country === 'USA' ? STATE_REGIONS : COUNTRY_CITIES[country] || [];
  const region = regions.includes(pickRegion) ? pickRegion : '';
  const place = region ? pickPlace.trim() : '';
  const wherePicked = [place, region, country].filter(Boolean).join(', ');

  // `replace` is the lead to swap out; without it the whole list is loaded anew
  const pick = async (replace?: string) => {
    if (!seq || !country) return;
    const n = replace ? 1 : Math.min(50, Math.max(1, Math.floor(Number(pickN) || DEFAULT_PICK)));
    const exclude = [...new Set([...seen, ...(picks || []).map((p) => p.key)])];
    setPicking(replace || 'all'); setPickMsg('');
    try {
      const r = await api.suggestLeads(seq.sequenceId, country, n, exclude, region, place);
      if (!r.ok || !r.picks) { setPickMsg(r.error || 'The leads could not be picked.'); return; }
      setSeen(exclude);
      const got = r.picks;
      if (replace) {
        if (!got.length) { setPickMsg('No other lead passes the rules right now.'); return; }
        setPicks((cur) => (cur || []).map((p) => (p.key === replace ? got[0] : p)));
        return;
      }
      setPicks(got);
      const left = Object.entries(r.skipped || {}).filter(([k, v]) => v > 0 && SKIP_TEXT[k]).map(([k, v]) => `${v} ${SKIP_TEXT[k]}`);
      if (got.length < n) setPickMsg(`Only ${got.length} of ${n} found among the ${(r.examined || 0).toLocaleString()} leads read in ${wherePicked}.${!r.examined && (region || place) ? ' No project with an email matches that place; try the whole country.' : ''}${left.length ? ` Left out: ${left.join(', ')}.` : ''}`);
    } catch {
      setPickMsg('Network error. Nothing was loaded.');
    } finally {
      setPicking('');
    }
  };
  // Once, when the page opens with nobody in line: the first suggestions load by
  // themselves. It only reads; the button stays for every later load.
  const autoPicked = useRef(false);
  const idle = !!data && !data.queue?.length && !!seq && !!country;
  useEffect(() => {
    if (!idle || autoPicked.current) return;
    autoPicked.current = true;
    pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle]);

  const drop = (key: string) => { setSeen((s) => [...s, key]); setPicks((cur) => (cur || []).filter((p) => p.key !== key)); };
  const putIn = async () => {
    if (!seq || !picks?.length) return;
    setPicking('enroll'); setPickMsg('');
    try {
      const r = await api.enroll({ action: 'enroll', dryRun: false, sequenceId: seq.sequenceId, limit: picks.length, ignoreLanguage: false, source: { kind: 'keys', keys: picks.map((p) => p.key) } });
      if (!r.ok) { setPickMsg(r.error || 'The leads could not be put in.'); return; }
      setPickMsg(`${(r.taken || 0).toLocaleString()} of ${picks.length} put into "${seq.name}".${seq.enabled ? '' : ' The sequence is switched off: switch it on to send.'}`);
      setSeen((s) => [...s, ...picks.map((p) => p.key)]);
      setPicks(null);
      await load(true);
    } catch {
      setPickMsg('Network error. Check the list below before trying again.');
    } finally {
      setPicking('');
    }
  };

  const gate = data?.gate;
  const hb = data?.heartbeat;
  const senders = data?.senders || [];
  const queue = data?.queue || [];
  const sent = data?.sent || [];
  const senderName = (id: string) => senders.find((s) => s.senderId === id)?.label || id;
  const going = queue.filter((q) => q.fate === 'today' || q.fate === 'hours').length;
  const sentToday = senders.reduce((n, s) => n + s.sentToday, 0);
  const capToday = senders.reduce((n, s) => n + s.capToday, 0);
  const anyOn = sequences.some((s) => s.enabled);

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🚀 Campaign</div>
        {gate && <span className={`chip ${gate.allowed ? 'green' : 'red'}`}>{gate.allowed ? 'Sending allowed' : 'Sending blocked'}</span>}
        {hb && <span className={`chip ${hb.stale ? 'red' : 'green'}`} title={hb.reason}>{hb.lastTickAt ? `Send loop ${hb.stale ? 'silent since' : 'last ran'} ${minute(hb.lastTickAt)}` : 'Send loop never ran'}</span>}
        <div className="spacer" />
        <a className="btn" href="/outreach/runner" target="_blank" rel="noreferrer">Open the runner tab</a>
        <button className="btn" onClick={() => load()} disabled={loading}>⟳ Refresh</button>
      </div>

      {previewOf && (() => {
        const s = sequences.find((x) => x.sequenceId === previewOf.sequenceId);
        return s ? <EmailPreviewModal sequenceId={s.sequenceId} sequenceName={s.name} language={s.language} lead={previewOf.lead} onClose={() => setPreviewOf(null)} /> : null;
      })()}
      {mapOpen && <PlacePickerModal countries={countries} country={country} region={region} onClose={() => setMapOpen(false)}
        onPick={(c, r) => { setPickCountry(c); setPickRegion(r); setPickPlace(''); setPicks(null); setPickMsg(''); }} />}
      {loading && !data && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load()}>Try again</button></div>}
      {data && gate && !error && (
        <>
          {/* what the last round said: the answer to "it is due, why has it not gone out" */}
          {hb?.lastTickAt && <div className="log-tile"><b>Last round, {clock(hb.lastTickAt)}:</b> {hb.reason || 'No reason given.'}</div>}
          {!hb?.lastTickAt && <div className="oseq-note bad">The send loop has never run. Open the runner tab, or check the scheduler job.</div>}
          {gate.blockers.map((b) => <div key={b} className="oseq-note bad">Blocks sending: {b}</div>)}
          {gate.warnings.map((w) => <div key={w} className="oseq-note">{w}</div>)}
          {gate.allowed && hb?.stale && <div className="oseq-note bad">Nothing goes out while the runner tab is closed. Open it and leave it open.</div>}
          {gate.allowed && !anyOn && <div className="oseq-note">No sequence is switched on, so nothing goes out.</div>}

          <div className="log-tiles">
            <div className="log-tile"><div className="log-tile-n">{sentToday.toLocaleString()} <span className="muted">of {capToday.toLocaleString()}</span></div>Sent today, of today&apos;s limit</div>
            <div className="log-tile"><div className="log-tile-n green">{going.toLocaleString()}</div>Still to go out today</div>
            <div className="log-tile"><div className="log-tile-n amber">{queue.filter((q) => q.fate === 'limit').length.toLocaleString()}</div>Due, but over today&apos;s limit</div>
            <div className="log-tile"><div className="log-tile-n blue">{queue.filter((q) => q.fate === 'next').length.toLocaleString()}</div>Go out after midnight, on tomorrow&apos;s limit</div>
            <div className="log-tile"><div className="log-tile-n">{queue.filter((q) => q.fate === 'closed' || q.fate === 'off').length.toLocaleString()}</div>Due, waiting for hours or a switched-off sequence</div>
          </div>

          <div className="oseq-card">
            <div className="oseq-row"><b>Sequences</b><span className="muted">Switched on = its leads are sent to. New leads get in with &quot;Put leads in&quot;: it takes the filter of the Leads tab, the checked leads or a group, and shows a preview first.</span></div>
            {!data.sequences?.length && <div className="muted oseq-hint">No sequence yet. <button className="mini" onClick={onEditSequences}>Create one</button></div>}
            {(data.sequences || []).map((s) => {
              const inLine = queue.filter((q) => q.sequenceId === s.sequenceId).length;
              return (
                <div key={s.sequenceId} className="oseq-row ocmp-line">
                  <b>{s.name}</b>
                  <span className={`chip ${s.enabled ? 'green' : 'gray'}`}>{s.enabled ? 'On' : 'Off'}</span>
                  <span className="muted">{s.steps} {s.steps === 1 ? 'step' : 'steps'} · {inLine.toLocaleString()} due today</span>
                  <div className="spacer" />
                  <button className="btn" onClick={() => setPreviewOf({ sequenceId: s.sequenceId })}>👁 Preview emails</button>
                  <button className="btn" disabled={busy === s.sequenceId} onClick={() => toggle(s.sequenceId, s.name, !s.enabled)}>{busy === s.sequenceId ? 'Saving…' : s.enabled ? 'Switch off' : 'Switch on'}</button>
                </div>
              );
            })}
            <div className="oseq-row">
              <button className="btn" onClick={onEnroll}>📨 Put leads in, start follow-ups or take out</button>
              <button className="mini" onClick={onEditSequences}>Edit the texts</button>
              {msg && <span className="muted">{msg}</span>}
            </div>
          </div>

          {seq && (
            <div className="oseq-card">
              <div className="oseq-row">
                <b>Pick leads to start</b>
                <div className="spacer" />
                <button className="btn" onClick={() => setMapOpen(true)} title="Pick the country, state or city on a map that shows the time there">🗺 Pick on the map</button>
              </div>
              <div className="muted oseq-hint">Leads with an email, best score first within the projects that have the most emails, that pass every rule: not written to before, not suppressed, the sequence&apos;s language, one per company. Nothing is sent until you put them in.</div>
              <div className="oseq-row">
                <select className="select" value={seq.sequenceId} onChange={(e) => { setPickSeq(e.target.value); setPicks(null); setPickMsg(''); }} aria-label="Sequence">
                  {sequences.map((s) => <option key={s.sequenceId} value={s.sequenceId}>{s.name}</option>)}
                </select>
                <select className="select" value={country} onChange={(e) => { setPickCountry(e.target.value); setPickRegion(''); setPickPlace(''); setPicks(null); setPickMsg(''); }} aria-label="Country" disabled={countries.length < 2}>
                  {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="select" value={region} onChange={(e) => { setPickRegion(e.target.value); setPickPlace(''); setPicks(null); setPickMsg(''); }} aria-label={country === 'USA' ? 'State' : 'City'} disabled={!regions.length}>
                  <option value="">{country === 'USA' ? 'Every state' : 'Every city'}</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input className="search ocmp-place" value={region ? pickPlace : ''} onChange={(e) => { setPickPlace(e.target.value); setPicks(null); setPickMsg(''); }} disabled={!region}
                  placeholder={!region ? (country === 'USA' ? 'Pick a state to name a town' : 'Pick a city to name an area') : country === 'USA' ? 'Town, optional' : 'Area, optional'} aria-label={country === 'USA' ? 'Town' : 'Area'} />
                <label className="orep-inline">How many <input className="search" inputMode="numeric" value={pickN} onChange={(e) => setPickN(e.target.value)} /></label>
                <button className="btn" disabled={!!picking} onClick={() => pick()}>{picking === 'all' ? 'Loading…' : picks ? 'Load other leads' : 'Load leads'}</button>
              </div>
              {picks && picks.length > 0 && (
                <div className="orep-table">
                  <div className="ocmp-tr orep-th"><span>Score</span><span>Lead</span><span>To</span><span>Category</span><span>From</span><span /></div>
                  {picks.map((p) => (
                    <div key={p.key} className="ocmp-tr">
                      <span className="muted">{p.score ?? ''}</span>
                      <span title={p.project}>{p.name}</span>
                      <span className="muted">{p.to}</span>
                      <span className="muted">{p.category}</span>
                      <span className="muted">{p.sender}</span>
                      <span>
                        <button className="mini" onClick={() => setPreviewOf({ sequenceId: seq.sequenceId, lead: { project: p.project, dedupKey: p.key } })}>Preview</button>{' '}
                        <button className="mini" disabled={!!picking} onClick={() => pick(p.key)}>{picking === p.key ? '…' : 'Swap'}</button>{' '}
                        <button className="mini" disabled={!!picking} onClick={() => drop(p.key)}>Remove</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {picks && !picks.length && !pickMsg && <div className="muted oseq-hint">No lead here passes the rules right now.</div>}
              {picks && picks.length > 0 && (
                <div className="oseq-row">
                  <button className="btn" disabled={!!picking} onClick={putIn}>{picking === 'enroll' ? 'Putting in…' : `Put these ${picks.length} into "${seq.name}"`}</button>
                  <span className="muted">They get the opening email, in sending hours, within today&apos;s limit.</span>
                </div>
              )}
              {pickMsg && <div className="oseq-note">{pickMsg}</div>}
            </div>
          )}

          <div className="oseq-card">
            <div className="oseq-row"><b>Senders today</b></div>
            {!senders.length && <div className="muted oseq-hint">No active sender.</div>}
            {senders.map((s) => (
              <div key={s.senderId} className="oseq-row ocmp-line">
                <b>{s.label}</b><span className="muted">{s.fromEmail}</span>
                <span>{s.sentToday.toLocaleString()} of {s.capToday.toLocaleString()} sent</span>
                <span className="muted">{s.left.toLocaleString()} left · {s.queued.toLocaleString()}{s.more ? '+' : ''} due today</span>
              </div>
            ))}
          </div>

          <div className="oseq-card">
            <div className="oseq-row"><b>In line for today</b><span className="muted">In the order they are sent. A sender pauses between two emails, so each time is an estimate. Times are yours; the daily limit turns over at midnight in Budapest, so a lead in a later time zone can go out after midnight, on tomorrow&apos;s limit.</span></div>
            {!queue.length && <div className="muted oseq-hint">Nobody is due today.</div>}
            {queue.length > 0 && (
              <div className="orep-table">
                <div className="ocmp-tr orep-th"><span title="When the send round is likely to reach it">Goes about</span><span>Lead</span><span>To</span><span>Sequence</span><span>From</span><span>What happens</span></div>
                {queue.map((q) => (
                  <div key={`${q.project}:${q.dedupKey}`} className="ocmp-tr">
                    <span className="muted" title={`Due since ${clock(q.dueAt)}`}>{q.expectedAt ? `≈ ${minute(q.expectedAt)}` : '—'}</span>
                    <span><button className="mini" title="See the emails this lead gets" onClick={() => setPreviewOf({ sequenceId: q.sequenceId, lead: { project: q.project, dedupKey: q.dedupKey } })}>👁</button> {q.name}</span>
                    <span className="muted">{q.to}</span>
                    <span>{q.sequence}{q.step > 0 && <span className="muted"> · step {q.step} of {q.steps}</span>}</span>
                    <span className="muted">{senderName(q.senderId)}</span>
                    <span><span className={`chip ${FATE[q.fate].cls}`} title={q.tz ? `Time zone: ${q.tz}` : undefined}>{FATE[q.fate].text}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="oseq-card">
            <div className="oseq-row"><b>Sent today</b><span className="muted">Newest first. &quot;sent&quot; means our mail server took it, not that it was read.</span></div>
            {!sent.length && <div className="muted oseq-hint">Nothing went out today yet.</div>}
            {sent.length > 0 && (
              <div className="orep-table">
                <div className="ocmp-tr orep-th"><span>At</span><span>To</span><span /><span>Sequence</span><span>From</span><span>Result</span></div>
                {sent.map((r, n) => (
                  <div key={`${r.sentAt}:${r.to}:${n}`} className="ocmp-tr">
                    <span className="muted">{clock(r.sentAt)}</span>
                    <span>{r.to}</span>
                    <span>{r.seed && <span className="chip gray">seed test</span>}</span>
                    <span>{r.sequence}{r.step > 0 && <span className="muted"> · step {r.step}</span>}</span>
                    <span className="muted">{senderName(r.senderId)}</span>
                    <span><span className={`chip ${OUTCOME[r.outcome] || 'gray'}`}>{r.outcome || 'unknown'}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {data.at && <div className="muted oseq-hint">As of {new Date(data.at).toLocaleTimeString()}. Refreshes every 30 seconds.</div>}
        </>
      )}
    </div>
  );
}
