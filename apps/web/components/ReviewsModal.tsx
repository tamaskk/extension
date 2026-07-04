'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow, ReviewRow } from '@/lib/types';

const EMAIL_CTX = 'gridleads_email_ctx';

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.getReviews(lead.dedupKey)
      .then((r) => { if (!cancelled) { if (r.ok) setRows(r.rows || []); else setError('Could not load reviews'); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Could not load reviews'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lead.dedupKey]);

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
            <button className="rvp-x" onClick={onClose}>✕</button>
          </div>
          <div className="rvp-tabs">
            <button className={`rvp-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Info</button>
            <button className={`rvp-tab ${tab === 'reviews' ? 'active' : ''}`} onClick={() => setTab('reviews')}>Reviews</button>
            <button className={`rvp-tab ${tab === 'emails' ? 'active' : ''}`} onClick={() => setTab('emails')}>Email</button>
          </div>
        </div>

        <div className="rvp-body">
          {tab === 'info' && <InfoTab lead={lead} stats={stats} onEditAll={onEditAll} />}
          {tab === 'reviews' && <ReviewsTab lead={lead} rows={rows} stats={stats} loading={loading} error={error} />}
          {tab === 'emails' && <EmailsTab lead={lead} />}
        </div>
    </aside>
  );
}

type Stats = { avg: number; dist: Record<number, number>; positive: number; respRate: number; count: number };

function ReviewsTab({ lead, rows, stats, loading, error }: { lead: LeadRow; rows: ReviewRow[]; stats: Stats; loading: boolean; error: string | null }) {
  if (loading) return <div className="muted" style={{ padding: 20 }}>Loading reviews…</div>;
  if (error) return <div className="empty" style={{ padding: 20, color: '#e11d48' }}>⚠ {error}</div>;
  if (!rows.length) return <div className="empty" style={{ padding: 24 }}>No reviews stored yet — run the Review Scraper extension to collect them.</div>;
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

function InfoTab({ lead, stats, onEditAll }: { lead: LeadRow; stats: Stats; onEditAll?: (lead: LeadRow) => void }) {
  const opp = lead.opportunityScore || 0;
  const [ai, setAi] = useState({ summary: lead.aiSummary || '', painPoints: lead.aiPainPoints || '', advantages: lead.aiAdvantages || '', pitch: lead.aiPitch || '', at: lead.aiAt || '' });
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState('');
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
    ['Email', lead.email ? <a href={`mailto:${lead.email}`} key="em">{lead.email}</a> : '—'],
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onEditAll && <button className="btn primary" onClick={() => onEditAll(lead)}>✎ Edit all fields</button>}
        {lead.mapsUrl && <a className="btn" href={lead.mapsUrl} target="_blank" rel="noreferrer">Open in Maps ↗</a>}
        {lead.website && <a className="btn" href={lead.website} target="_blank" rel="noreferrer">Website ↗</a>}
      </div>
    </>
  );
}

const EM_FIELDS: { key: string; label: string; ph: string; area?: boolean }[] = [
  { key: 'who', label: 'Who are you & what you offer', ph: "I'm John and I build AI-powered 3D virtual tours for real-estate agencies", area: true },
  { key: 'value', label: 'Value proposition', ph: 'Help your listings sell faster with immersive 3D tours' },
  { key: 'proof', label: 'Social proof', ph: 'Working with 20+ agencies across the region' },
  { key: 'offer', label: 'Offer / hook', ph: 'A free 3D tour of one of your listings' },
  { key: 'objective', label: 'Email objective', ph: 'Book a quick call to show you examples' },
  { key: 'sender', label: 'Sender', ph: 'John — CEO' },
  { key: 'link', label: 'Conversion link (web, calendly…)', ph: 'Reply to get your free tour' },
];

function EmailsTab({ lead }: { lead: LeadRow }) {
  const [ctx, setCtx] = useState<Record<string, string>>({ tone: 'Professional but friendly', length: 'Medium', language: 'English' });
  const [out, setOut] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(EMAIL_CTX) || 'null'); if (s) setCtx((c) => ({ ...c, ...s })); } catch { /* */ } }, []);
  const save = () => { try { localStorage.setItem(EMAIL_CTX, JSON.stringify(ctx)); } catch { /* */ } };
  const set = (k: string, v: string) => setCtx((c) => ({ ...c, [k]: v }));

  const generate = () => {
    const g = (k: string) => (ctx[k] || '').trim();
    const greet = `Hi ${lead.name} team,`;
    const intro = g('who');
    const body = [g('value'), g('proof')].filter(Boolean).join(' ');
    const hook = g('offer') ? `${g('offer')}.` : '';
    const cta = g('objective') ? `${g('objective')}.` : '';
    const sign = [g('sender'), g('link')].filter(Boolean).join('\n');
    const subject = g('offer') ? `Subject: ${g('offer')} — ${lead.name}` : `Subject: Quick idea for ${lead.name}`;
    setOut([subject, '', greet, '', intro, body, hook, '', cta, '', sign].filter((l, i) => l !== '' || i).join('\n').replace(/\n{3,}/g, '\n\n').trim());
    setCopied(false);
  };
  const copy = () => { navigator.clipboard.writeText(out).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  return (
    <>
      <div className="rvp-titlerow" style={{ marginBottom: 10 }}>
        <div className="rvp-seclabel" style={{ margin: 0 }}>✉️ Email context</div>
        <button className="rvp-x" onClick={save} title="Remember this context" style={{ color: 'var(--ink)', fontWeight: 700, fontSize: 12 }}>Save</button>
      </div>
      {EM_FIELDS.map((f) => (
        <div className="em-field" key={f.key}>
          <label>{f.label}</label>
          {f.area
            ? <textarea value={ctx[f.key] || ''} placeholder={f.ph} onChange={(e) => set(f.key, e.target.value)} />
            : <input value={ctx[f.key] || ''} placeholder={f.ph} onChange={(e) => set(f.key, e.target.value)} />}
        </div>
      ))}
      <div className="em-2">
        <div className="em-field"><label>Tone</label><input value={ctx.tone || ''} onChange={(e) => set('tone', e.target.value)} /></div>
        <div className="em-field"><label>Length</label>
          <select value={ctx.length || 'Medium'} onChange={(e) => set('length', e.target.value)}><option>Short</option><option>Medium</option><option>Long</option></select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn primary" onClick={generate}>✨ Generate email</button>
        {out && <button className="btn" onClick={copy}>{copied ? '✓ Copied' : '⧉ Copy'}</button>}
      </div>
      {out && <div className="em-out">{out}</div>}
      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>Template-based compose (uses this business + your context). AI-written variants can be wired to the Claude API on request.</p>
    </>
  );
}
