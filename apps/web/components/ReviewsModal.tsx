'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildContactPrompt } from '@/lib/contactPrompt';
import type { LeadRow, ReviewRow } from '@/lib/types';

const EMAIL_CTX = 'gridleads_email_ctx';

// US timezone map — takes ?q=<address> and geocodes it to highlight the state.
const TIMEZONE_APP = 'https://timezone-khaki.vercel.app';

function Stars({ n, big }: { n: number; big?: boolean }) {
  const full = Math.round(n);
  return (
    <span className={big ? 'rvp-bigstars' : 'rv-stars'}>
      {'★'.repeat(full)}<span className={big ? 'off' : 'rv-stars-off'}>{'★'.repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

const DIST_COLOR: Record<number, string> = { 5: '#22c55e', 4: '#4ade80', 3: '#f59e0b', 2: '#fb7185', 1: '#f43f5e' };

export default function ReviewsModal({ lead, onClose, initialTab, onEditAll, onResizeStart }:
  { lead: LeadRow; onClose: () => void; initialTab?: 'info' | 'reviews' | 'emails'; onEditAll?: (lead: LeadRow) => void; onResizeStart?: () => void }) {
  const [tab, setTab] = useState<'info' | 'reviews' | 'emails'>(initialTab || 'info');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rvKey, setRvKey] = useState(0); // bump to re-fetch (after an on-demand scrape)

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.getReviews(lead.dedupKey)
      .then((r) => { if (!cancelled) { if (r.ok) setRows(r.rows || []); else setError('Could not load reviews'); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Could not load reviews'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lead.dedupKey, rvKey]);

  const stats = useMemo(() => {
    const rated = rows.filter((r) => r.rating != null);
    const avg = rated.length ? rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length : (lead.rating || 0);
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    rated.forEach((r) => { const k = Math.min(5, Math.max(1, Math.round(r.rating || 0))); dist[k]++; });
    const positive = rows.length ? Math.round(((dist[5] + dist[4]) / rows.length) * 100) : 0;
    const withResp = rows.filter((r) => (r.ownerResponse || '').trim()).length;
    const respRate = rows.length ? Math.round((withResp / rows.length) * 100) : 0;
    return { avg, dist, positive, respRate, count: rows.length };
  }, [rows, lead.rating]);

  return (
    <aside className="rvp">
        <div className="rvp-resizer" onMouseDown={(e) => { e.preventDefault(); onResizeStart?.(); }} />
        <div className="rvp-head">
          <div className="rvp-titlerow">
            <div>
              <div className="rvp-title">{lead.name}</div>
              <div className="rvp-sub">{lead.category || ''}{lead.address ? ` · ${lead.address}` : ''}</div>
            </div>
            <div className="rvp-headbtns">
              {lead.address && (
                <a
                  className="rvp-tz"
                  href={`${TIMEZONE_APP}/?q=${encodeURIComponent(lead.address)}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Show ${lead.address} on the US timezone map`}
                >
                  🕐 Timezone
                </a>
              )}
              <button className="rvp-x" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="rvp-tabs">
            <button className={`rvp-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Info</button>
            <button className={`rvp-tab ${tab === 'reviews' ? 'active' : ''}`} onClick={() => setTab('reviews')}>Reviews</button>
            <button className={`rvp-tab ${tab === 'emails' ? 'active' : ''}`} onClick={() => setTab('emails')}>Email</button>
          </div>
        </div>

        <div className="rvp-body">
          {tab === 'info' && <InfoTab lead={lead} stats={stats} onEditAll={onEditAll} />}
          {tab === 'reviews' && <ReviewsTab lead={lead} rows={rows} stats={stats} loading={loading} error={error} onScraped={() => setRvKey((k) => k + 1)} />}
          {tab === 'emails' && <EmailsTab lead={lead} />}
        </div>
    </aside>
  );
}

type Stats = { avg: number; dist: Record<number, number>; positive: number; respRate: number; count: number };

// "Scrape reviews now" — asks the installed Review Scraper extension (via a
// window.postMessage bridge) to open ONE Maps window for this business, scrape,
// save and close. No extension → friendly hint after a short ack timeout.
function ScrapeNowBtn({ lead, onDone }: { lead: LeadRow; onDone: () => void }) {
  const [st, setSt] = useState<'idle' | 'asking' | 'scraping' | 'noext' | 'err'>('idle');
  const [err, setErr] = useState('');
  useEffect(() => {
    const h = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.dedupKey !== lead.dedupKey) return;
      if (d.__glr === 'ack') {
        if (d.ok) setSt('scraping');
        else { setSt('err'); setErr(d.error || 'The extension rejected the request.'); }
      } else if (d.__glr === 'done') {
        if (d.error) { setSt('err'); setErr(d.error); }
        else { setSt('idle'); onDone(); }
      }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [lead.dedupKey, onDone]);
  const start = () => {
    setSt('asking'); setErr('');
    window.postMessage({ __glr: 'scrapeOne', business: { project: lead._project, dedupKey: lead._key, cid: lead.cid || '', placeId: lead.placeId || '', mapsUrl: lead.mapsUrl || '', name: lead.name || '' } }, '*');
    setTimeout(() => setSt((s) => (s === 'asking' ? 'noext' : s)), 2500);
  };
  if (st === 'scraping') return <div className="muted" style={{ padding: '8px 0' }}>⏳ Scraping this business&apos;s reviews (a Maps window opened — 30–60s)…</div>;
  return (
    <div style={{ padding: '6px 0' }}>
      <button className="btn primary" onClick={start} disabled={st === 'asking'}>{st === 'asking' ? '…' : '⚡ Scrape reviews now'}</button>
      {st === 'noext' && <p className="ai-err" style={{ marginTop: 8 }}>⚠ Review Scraper extension not found in this browser — install/enable it (and reload this page), or use the batch scraper.</p>}
      {st === 'err' && <p className="ai-err" style={{ marginTop: 8 }}>⚠ {err}</p>}
    </div>
  );
}

function ReviewsTab({ lead, rows, stats, loading, error, onScraped }: { lead: LeadRow; rows: ReviewRow[]; stats: Stats; loading: boolean; error: string | null; onScraped: () => void }) {
  if (loading) return <div className="muted" style={{ padding: 20 }}>Loading reviews…</div>;
  if (error) return <div className="empty" style={{ padding: 20, color: '#e11d48' }}>⚠ {error}</div>;
  if (!rows.length) return (
    <div className="empty" style={{ padding: 24 }}>
      No reviews stored yet.
      <div style={{ marginTop: 10 }}><ScrapeNowBtn lead={lead} onDone={onScraped} /></div>
    </div>
  );
  const max = Math.max(1, ...Object.values(stats.dist));
  return (
    <>
      <div className="rvp-big">
        <span className="rvp-bignum">{stats.avg.toFixed(1)}</span>
        <Stars n={stats.avg} big />
        <span className="rvp-bigcount">{stats.count} review{stats.count === 1 ? '' : 's'}{lead.reviewCount ? ` · Google: ${lead.reviewCount.toLocaleString()}` : ''}</span>
      </div>

      <div className="rvp-dist">
        {[5, 4, 3, 2, 1].map((s) => (
          <div className="rvp-distrow" key={s}>
            <span className="lab">{s}★</span>
            <span className="track"><span className="fill" style={{ width: `${(stats.dist[s] / max) * 100}%`, background: DIST_COLOR[s] }} /></span>
            <span className="cnt">{stats.dist[s]}</span>
          </div>
        ))}
      </div>

      <div className="rvp-metrics">
        <div className="rvp-metric"><div className="n">{stats.avg.toFixed(1)}</div><div className="l">Avg rating</div></div>
        <div className="rvp-metric"><div className="n">{stats.positive}%</div><div className="l">Positive (4–5★)</div></div>
        <div className="rvp-metric"><div className="n">{stats.respRate}%</div><div className="l">Owner replies</div></div>
      </div>

      <div className="rvp-seclabel">Reviews ({rows.length})</div>
      <div className="rv-list">
        {rows.map((r, i) => (
          <div key={r.reviewId || i} className="rv-item">
            <div className="rv-top">
              {r.authorUrl ? <a className="rv-author" href={r.authorUrl} target="_blank" rel="noreferrer">{r.author || 'Anonymous'}</a> : <span className="rv-author">{r.author || 'Anonymous'}</span>}
              <Stars n={r.rating || 0} />
              <span className="rv-time">{r.relativeTime || ''}</span>
            </div>
            {r.text && <div className="rv-text">{r.text}</div>}
            {r.ownerResponse && <div className="rv-owner"><b>Owner response:</b> {r.ownerResponse}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

// Double-click the Email value in the Info list to edit it in place; blur or
// Enter saves automatically (Escape cancels).
function InlineEmailEdit({ lead }: { lead: LeadRow }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(lead.email || '');
  const [st, setSt] = useState<'idle' | 'saving' | 'saved'>('idle');
  const commit = async () => {
    setEditing(false);
    const nv = v.trim();
    if (nv === (lead.email || '')) return;
    setSt('saving');
    try {
      await api.updateLeadField(lead._project, lead._key, 'email', nv);
      lead.email = nv;
      setSt('saved'); setTimeout(() => setSt('idle'), 2000);
    } catch { setSt('idle'); }
  };
  if (editing) return (
    <input className="si-edit" autoFocus value={v} placeholder="email@company.com"
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setV(lead.email || ''); setEditing(false); }
      }} />
  );
  return (
    <span className="si-editable" title="Double-click to edit" onDoubleClick={() => { setV(lead.email || ''); setEditing(true); }}>
      {lead.email || '—'}
      {lead.email && <a className="mlink" href={`mailto:${lead.email}`} onClick={(e) => e.stopPropagation()} title="Write email"> ✉</a>}
      {st === 'saving' && <span className="notes-state"> Saving…</span>}
      {st === 'saved' && <span className="notes-state saved"> ✓ Saved</span>}
    </span>
  );
}

function InfoTab({ lead, stats, onEditAll }: { lead: LeadRow; stats: Stats; onEditAll?: (lead: LeadRow) => void }) {
  const opp = lead.opportunityScore || 0;
  const [ai, setAi] = useState({ summary: lead.aiSummary || '', painPoints: lead.aiPainPoints || '', advantages: lead.aiAdvantages || '', pitch: lead.aiPitch || '', at: lead.aiAt || '' });
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  // free-form notes — debounced auto-save, no save button
  const [notes, setNotes] = useState(lead.notes || '');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef({ value: lead.notes || '', dirty: false });
  useEffect(() => {
    setNotes(lead.notes || ''); setNoteState('idle');
    notesRef.current = { value: lead.notes || '', dirty: false };
  }, [lead.dedupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveNotes = async (v: string) => {
    try {
      await api.updateLeadField(lead._project, lead._key, 'notes', v);
      lead.notes = v; // keep the row object in sync so reopening shows the saved text
      notesRef.current.dirty = false;
      setNoteState('saved');
    } catch { setNoteState('idle'); }
  };
  const onNotesChange = (v: string) => {
    setNotes(v); setNoteState('saving');
    notesRef.current = { value: v, dirty: true };
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => saveNotes(v), 800);
  };
  useEffect(() => () => { // flush a pending save when the panel closes
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (notesRef.current.dirty) {
      api.updateLeadField(lead._project, lead._key, 'notes', notesRef.current.value).catch(() => {});
      lead.notes = notesRef.current.value;
    }
  }, [lead._project, lead._key]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyContactPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildContactPrompt(lead));
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
    } catch { alert('Copying to the clipboard failed.'); }
  };
  useEffect(() => {
    setAi({ summary: lead.aiSummary || '', painPoints: lead.aiPainPoints || '', advantages: lead.aiAdvantages || '', pitch: lead.aiPitch || '', at: lead.aiAt || '' });
    setGenErr('');
  }, [lead.dedupKey, lead.aiSummary, lead.aiPainPoints, lead.aiAdvantages, lead.aiPitch, lead.aiAt]);
  const generate = async () => {
    setGen(true); setGenErr('');
    try {
      const r = await api.enrichLead(lead.dedupKey);
      if (r && r.ok && r.ai) setAi({ summary: r.ai.aiSummary, painPoints: r.ai.aiPainPoints, advantages: r.ai.aiAdvantages, pitch: r.ai.aiPitch, at: r.ai.aiAt });
      else setGenErr(r?.error || 'Generation failed');
    } catch (e) { setGenErr(String((e as Error)?.message || e)); }
    setGen(false);
  };
  const bullets = (s: string) => s.split('\n').map((x) => x.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
  const hasAi = !!(ai.summary || ai.painPoints || ai.advantages || ai.pitch);
  const rowsData: [string, React.ReactNode][] = [
    ['Project', <span className="muted" key="pj">{lead._project}</span>],
    ['Category', lead.category || '—'],
    ['Rating', stats.avg ? `${stats.avg.toFixed(1)}★ (${stats.count || lead.reviewCount || 0})` : (lead.rating != null ? `${lead.rating}★` : '—')],
    ['Opportunity', <span className="ld-opp" key="o"><span className="ld-opp-bar"><span style={{ width: `${Math.min(100, opp)}%` }} /></span> {opp}</span>],
    ['Temperature', <span className={`temp ${lead.leadTemperature}`} key="t">{lead.leadTemperature || '—'}</span>],
    ['Website', <span key="w">{lead.websiteStatus || '—'}{lead.website ? <> · <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a></> : ''}</span>],
    ['Phone', lead.phone ? <a href={`tel:${lead.phone}`} key="ph">{lead.phone}</a> : '—'],
    ['Email', <InlineEmailEdit key={`em-${lead.dedupKey}`} lead={lead} />],
    ['Address', lead.address || '—'],
    ['Sales status', lead.salesStatus || '—'],
    ['Tags', (lead.tags && lead.tags.length) ? lead.tags.join(', ') : '—'],
    ['Maps', lead.mapsUrl ? <a href={lead.mapsUrl} target="_blank" rel="noreferrer" key="mp">open ↗</a> : '—'],
  ];
  return (
    <>
      {lead.topPitch && (
        <div className="rvp-card"><h4>🎯 Sales pitch</h4><p>{lead.topPitch}</p></div>
      )}

      <div className="rvp-card ai-card">
        <div className="ai-head">
          <h4>✨ AI insights</h4>
          <button className="btn primary ai-gen" onClick={generate} disabled={gen}>{gen ? 'Generating…' : hasAi ? '↻ Regenerate' : '✨ Generate'}</button>
        </div>
        {genErr && <p className="ai-err">⚠ {genErr}</p>}
        {gen && <p className="ai-empty">Asking your local Claude… (~10s)</p>}
        {!hasAi && !gen && !genErr && <p className="ai-empty">Generate a summary, strengths, weaknesses and a tailored sales pitch from this business&apos;s data + reviews. Runs your local Claude (localhost only).</p>}
        {ai.summary && <div className="ai-sec"><div className="ai-lbl">Summary</div><p>{ai.summary}</p></div>}
        {ai.advantages && <div className="ai-sec"><div className="ai-lbl">✅ Advantages</div><ul>{bullets(ai.advantages).map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        {ai.painPoints && <div className="ai-sec"><div className="ai-lbl">⚠️ Pain points</div><ul>{bullets(ai.painPoints).map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        {ai.pitch && <div className="ai-sec"><div className="ai-lbl">🎯 AI pitch</div><p>{ai.pitch}</p></div>}
        {ai.at && <div className="ai-at">generated {new Date(ai.at).toLocaleString()}</div>}
      </div>

      <div className="rvp-card" style={{ background: '#fff' }}>
        {rowsData.map(([k, v]) => (
          <div className="si-row" key={k}><span className="si-k">{k}</span><span className="si-v">{v}</span></div>
        ))}
      </div>

      <div className="rvp-card">
        <div className="notes-head">
          <h4>📝 Notes</h4>
          <span className={`notes-state ${noteState}`}>{noteState === 'saving' ? 'Saving…' : noteState === 'saved' ? '✓ Saved' : ''}</span>
        </div>
        <textarea className="notes-area" placeholder="Write anything about this lead — saves automatically…"
          value={notes} onChange={(e) => onNotesChange(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onEditAll && <button className="btn primary" onClick={() => onEditAll(lead)}>✎ Edit all fields</button>}
        {lead.mapsUrl && <a className="btn" href={lead.mapsUrl} target="_blank" rel="noreferrer">Open in Maps ↗</a>}
        <button className="btn" onClick={copyContactPrompt} title="Copy a deep contact-research (OSINT) prompt filled with this business's data — paste it into an LLM">{promptCopied ? '✓ Copied' : '🔎 Contact search prompt'}</button>
        {lead.website && <a className="btn" href={lead.website} target="_blank" rel="noreferrer">Website ↗</a>}
      </div>
    </>
  );
}

const EM_SERVICES = ['Website', 'AI Automation', 'Social media marketing'];
const EM_WEBSITES = [
  'Has no website at all',
  'Outdated website — needs a full redesign',
  'Website is broken / not loading',
  'Not mobile-friendly',
  'Slow to load',
  'No online booking or contact form',
  'Only a Facebook/Instagram page — no real website',
  'Domain expired / parked',
];
const EM_AUTOMATIONS = [
  'AI phone agent — answers missed calls & books appointments',
  'Website chatbot — answers questions & takes bookings 24/7',
  'Automatic review replies & reputation management',
  'Instant lead follow-up (email/SMS) automation',
  'Appointment reminders — fewer no-shows',
  'Quote & invoice follow-up automation',
  'AI content generation for socials & blog',
  'Customer support inbox with AI-drafted replies',
];
const EM_VALUES = [
  'More customers find you online instead of your competitors',
  'Turn missed calls into booked jobs automatically',
  'A website that works like a 24/7 salesperson',
  'Save 10+ hours a week by automating repetitive work',
  'Never lose a lead again — every inquiry gets an instant reply',
  'Look more professional than the biggest competitor in town',
  'More 5-star reviews on autopilot',
  'A full calendar without chasing clients',
  'A modern online presence that builds instant trust',
  'Get found on Google Maps by people ready to buy',
];
const EM_DEFAULTS = {
  services: ['Website'] as string[],
  websites: [] as string[],
  automations: [] as string[],
  value: EM_VALUES[0],
  offer: "I've already put together a first version for you — if you're interested, I can show it on a quick 30-minute call and we can talk through everything.",
  objective: 'Get them to book the 30-minute call to see what I built',
  sender: 'Tom',
  link: 'https://calendly.com/tom-itsblitzdeep/30min',
  tone: 'Professional but friendly',
  length: 'Medium',
};
type EmCtx = typeof EM_DEFAULTS;

function EmailsTab({ lead }: { lead: LeadRow }) {
  const [ctx, setCtx] = useState<EmCtx>(EM_DEFAULTS);
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [subject, setSubject] = useState(lead.emailSubject || '');
  const [body, setBody] = useState(lead.emailBody || '');
  const [emailAt, setEmailAt] = useState(lead.emailAt || '');
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState(lead.emailSentAt || '');
  const [sentTo, setSentTo] = useState(lead.emailSentTo || '');
  const [sendErr, setSendErr] = useState('');
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // context is remembered globally (same pitch for every lead)
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(EMAIL_CTX) || 'null'); if (s && typeof s === 'object') setCtx((c) => ({ ...c, ...s })); } catch { /* */ } }, []);
  const set = <K extends keyof EmCtx>(k: K, v: EmCtx[K]) => setCtx((c) => {
    const next = { ...c, [k]: v };
    try { localStorage.setItem(EMAIL_CTX, JSON.stringify(next)); } catch { /* */ }
    return next;
  });
  const toggle = (k: 'services' | 'automations' | 'websites', v: string) => set(k, ctx[k].includes(v) ? ctx[k].filter((x) => x !== v) : [...ctx[k], v]);

  useEffect(() => {
    setSubject(lead.emailSubject || ''); setBody(lead.emailBody || ''); setEmailAt(lead.emailAt || ''); setDraftState('idle');
    setSentAt(lead.emailSentAt || ''); setSentTo(lead.emailSentTo || ''); setSendErr('');
  }, [lead.dedupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // one-click send of the saved draft (Resend, from Tom's address)
  const send = async () => {
    if (sending) return;
    if (!lead.email) { setSendErr('This lead has no email address.'); return; }
    if (draftState === 'saving') return; // let the auto-save land first
    if (!confirm(`Send this email to ${lead.email}?`)) return;
    setSending(true); setSendErr('');
    try {
      const r = await api.sendEmail(lead._project, lead._key);
      if (!r.ok) { setSendErr(r.error || 'Sending failed.'); return; }
      setSentAt(r.emailSentAt || new Date().toISOString()); setSentTo(r.to || lead.email || '');
      lead.emailSentAt = r.emailSentAt || ''; lead.emailSentTo = r.to || '';
    } catch (e: any) { setSendErr(e?.message || 'Sending failed.'); }
    finally { setSending(false); }
  };

  const generate = async () => {
    if (gen) return;
    setGen(true); setGenErr('');
    try {
      const r = await api.generateEmail(lead._project, lead._key, ctx);
      if (!r.ok) { setGenErr(r.error || 'Generation failed.'); return; }
      setSubject(r.subject || ''); setBody(r.body || ''); setEmailAt(r.emailAt || '');
      lead.emailSubject = r.subject || ''; lead.emailBody = r.body || ''; lead.emailAt = r.emailAt || '';
      setDraftState('saved');
    } catch (e: any) { setGenErr(e?.message || 'Generation failed.'); }
    finally { setGen(false); }
  };

  // manual edits auto-save (debounced), like the notes box
  const onDraftEdit = (s: string, b2: string) => {
    setSubject(s); setBody(b2); setDraftState('saving');
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      try {
        await api.updateLeadField(lead._project, lead._key, 'emailSubject', s);
        await api.updateLeadField(lead._project, lead._key, 'emailBody', b2);
        lead.emailSubject = s; lead.emailBody = b2;
        setDraftState('saved');
      } catch { setDraftState('idle'); }
    }, 800);
  };

  const copy = () => {
    navigator.clipboard.writeText((subject ? `Subject: ${subject}\n\n` : '') + body)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <>
      <div className="rvp-titlerow" style={{ marginBottom: 10 }}>
        <div className="rvp-seclabel" style={{ margin: 0 }}>✉️ Email context</div>
      </div>

      <div className="em-field">
        <label>What you offer</label>
        <div className="em-checks">
          {EM_SERVICES.map((s) => (
            <label key={s} className="em-check"><input type="checkbox" checked={ctx.services.includes(s)} onChange={() => toggle('services', s)} /> {s}</label>
          ))}
        </div>
        {ctx.services.includes('Website') && (
          <div className="em-sub">
            {EM_WEBSITES.map((w) => (
              <label key={w} className="em-check sub"><input type="checkbox" checked={ctx.websites.includes(w)} onChange={() => toggle('websites', w)} /> {w}</label>
            ))}
          </div>
        )}
        {ctx.services.includes('AI Automation') && (
          <div className="em-sub">
            {EM_AUTOMATIONS.map((a) => (
              <label key={a} className="em-check sub"><input type="checkbox" checked={ctx.automations.includes(a)} onChange={() => toggle('automations', a)} /> {a}</label>
            ))}
          </div>
        )}
      </div>

      <div className="em-field">
        <label>Value proposition</label>
        <select value={ctx.value} onChange={(e) => set('value', e.target.value)}>
          {EM_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="em-field">
        <label>Offer / hook</label>
        <textarea value={ctx.offer} onChange={(e) => set('offer', e.target.value)} />
      </div>

      <div className="em-field"><label>Email objective</label><input value={ctx.objective} onChange={(e) => set('objective', e.target.value)} /></div>
      <div className="em-2">
        <div className="em-field"><label>Sender</label><input value={ctx.sender} onChange={(e) => set('sender', e.target.value)} /></div>
        <div className="em-field"><label>Booking link (Calendly)</label><input value={ctx.link} onChange={(e) => set('link', e.target.value)} /></div>
      </div>
      <div className="em-2">
        <div className="em-field"><label>Tone</label><input value={ctx.tone} onChange={(e) => set('tone', e.target.value)} /></div>
        <div className="em-field"><label>Length</label>
          <select value={ctx.length} onChange={(e) => set('length', e.target.value)}><option>Short</option><option>Medium</option><option>Long</option></select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={generate} disabled={gen}>{gen ? '⏳ Writing…' : body ? '↻ Regenerate' : '✨ Generate email'}</button>
        {body && <button className="btn" onClick={copy}>{copied ? '✓ Copied' : '⧉ Copy'}</button>}
        {body && (
          <button className="btn primary" onClick={send} disabled={sending || !lead.email}
            title={lead.email ? `Send to ${lead.email} from tom@itsblitzdeep.com` : 'This lead has no email address'}>
            {sending ? '⏳ Sending…' : sentAt ? '📤 Send again' : '📤 Send'}
          </button>
        )}
        <span className={`notes-state ${draftState}`}>{draftState === 'saving' ? 'Saving…' : draftState === 'saved' ? '✓ Saved' : ''}</span>
      </div>
      {sentAt && <p className="em-sent">✓ Sent to {sentTo} · {new Date(sentAt).toLocaleString()}</p>}
      {sendErr && <p className="ai-err">⚠ {sendErr}</p>}
      {genErr && <p className="ai-err">⚠ {genErr}</p>}
      {gen && <p className="ai-empty">Asking GPT… (~5s)</p>}

      {(subject || body) && (
        <div className="em-draft">
          <div className="em-field"><label>Subject</label><input value={subject} onChange={(e) => onDraftEdit(e.target.value, body)} /></div>
          <div className="em-field"><label>Email</label><textarea className="em-draft-body" value={body} onChange={(e) => onDraftEdit(subject, e.target.value)} /></div>
          {emailAt && <div className="ai-at">generated {new Date(emailAt).toLocaleString()}</div>}
        </div>
      )}
      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>GPT writes a personalized draft from this business&apos;s data + your context. It is saved on the lead — edit freely (auto-saves) or regenerate any time.</p>
    </>
  );
}
