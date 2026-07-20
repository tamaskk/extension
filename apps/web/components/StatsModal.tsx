'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Folder } from '@/lib/types';

type Bucket = { key: string; count: number };
type Point = { label: string; full: string; count: number };

const niceMax = (m: number) => { if (m <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(m))); const n = m / p; const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return s * p; };

// fill every bucket between the first and last — day-by-day, or hour-by-hour
function toPoints(buckets: Bucket[], gran: 'day' | 'hour'): Point[] {
  if (!buckets.length) return [];
  const map = new Map(buckets.map((b) => [b.key, b.count]));
  const out: Point[] = [];
  if (gran === 'hour') {
    const parse = (s: string) => { const [d, h] = s.split('T'); const [y, mo, da] = d.split('-').map(Number); return Date.UTC(y, mo - 1, da, Number(h)); };
    const keyOf = (t: number) => new Date(t).toISOString().slice(0, 13); // YYYY-MM-DDTHH
    for (let t = parse(buckets[0].key); t <= parse(buckets[buckets.length - 1].key); t += 3600000) {
      const k = keyOf(t);
      out.push({ label: `${k.slice(5, 10)} ${k.slice(11, 13)}:00`, full: `${k.slice(0, 10)} ${k.slice(11, 13)}:00 (UTC)`, count: map.get(k) || 0 });
    }
    return out;
  }
  const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  for (let t = parse(buckets[0].key); t <= parse(buckets[buckets.length - 1].key); t += 86400000) { const k = fmt(t); out.push({ label: k.slice(5), full: k, count: map.get(k) || 0 }); }
  return out;
}

function Chart({ data, type }: { data: Point[]; type: 'bar' | 'line' }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 920, H = 340, padL = 52, padR = 18, padT = 18, padB = 52;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = data.length;
  const yMax = niceMax(Math.max(1, ...data.map((d) => d.count)));
  const slot = n ? plotW / n : plotW;
  const barW = Math.max(2, Math.min(46, slot * 0.66));
  const yOf = (c: number) => padT + plotH - (c / yMax) * plotH;
  const cx = (i: number) => padL + i * slot + slot / 2;
  const ticks = 5;
  const labelEvery = Math.max(1, Math.ceil(n / 14));

  return (
    <svg className="stats-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: ticks + 1 }, (_, k) => {
        const v = (yMax / ticks) * k; const y = yOf(v);
        return <g key={k}>
          <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" strokeWidth="1" />
          <text x={padL - 8} y={y + 4} textAnchor="end" className="stats-axis">{Math.round(v)}</text>
        </g>;
      })}
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--muted)" strokeWidth="1" />
      {hover != null && <line x1={cx(hover)} y1={padT} x2={cx(hover)} y2={padT + plotH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />}
      {type === 'bar'
        ? data.map((d, i) => <rect key={i} x={cx(i) - barW / 2} y={yOf(d.count)} width={barW} height={padT + plotH - yOf(d.count)} rx="2" fill={i === hover ? '#5cd2dd' : '#2bb3c0'} />)
        : <>
            <polyline points={data.map((d, i) => `${cx(i)},${yOf(d.count)}`).join(' ')} fill="none" stroke="#e23b3b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => <circle key={i} cx={cx(i)} cy={yOf(d.count)} r={i === hover ? 5 : 3} fill="#e23b3b" />)}
          </>}
      {data.map((d, i) => (i % labelEvery === 0 ? <text key={i} x={cx(i)} y={padT + plotH + 20} textAnchor="middle" className="stats-axis">{d.label}</text> : null))}
      {data.map((_, i) => <rect key={'h' + i} x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />)}
      {hover != null && (() => {
        const d = data[hover]; const label = d.count.toLocaleString();
        const w = Math.max(96, label.length * 11 + 26, d.full.length * 6.8 + 22); const h = 46;
        let bx = cx(hover) - w / 2; bx = Math.max(padL, Math.min(W - padR - w, bx));
        let by = yOf(d.count) - h - 12; if (by < padT) by = yOf(d.count) + 12;
        return <g pointerEvents="none">
          <rect x={bx} y={by + 3} width={w} height={h} rx="11" fill="rgba(17,21,31,.20)" />
          <rect x={bx} y={by} width={w} height={h} rx="11" fill="#161a26" />
          <text x={bx + w / 2} y={by + 21} textAnchor="middle" fill="#ffffff" fontSize="17" fontWeight="800">{label}</text>
          <text x={bx + w / 2} y={by + 36} textAnchor="middle" fill="#aeb4c6" fontSize="11" fontWeight="500">{d.full}</text>
        </g>;
      })()}
    </svg>
  );
}

export default function StatsModal({ folders, onClose, inline }:
  { folders: Folder[]; onClose: () => void; inline?: boolean }) {
  const [scope, setScope] = useState<string>(''); // '' = All leads (whole DB, incl. ungrouped)
  const [gran, setGran] = useState<'day' | 'hour'>('day');
  const [type, setType] = useState<'bar' | 'line'>('bar');
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState<{ total: number; noWebsite: number; hot: number; email: number; reviews: number; reviewsSum: number; ai: number; avgOpp: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getStats({ ...(scope ? { folder: scope } : {}), granularity: gran })
      .then((r) => { if (!cancelled) { setBuckets(r.buckets || []); setTotal(r.total || 0); setMetrics(r.metrics || null); } })
      .catch(() => { if (!cancelled) { setBuckets([]); setTotal(0); setMetrics(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, gran]);
  const fmt = (n: number) => (n || 0).toLocaleString();

  const data = useMemo(() => toPoints(buckets, gran), [buckets, gran]);
  const sub = loading ? 'Loading…'
    : data.length ? `${total.toLocaleString()} leads · ${data[0].full} → ${data[data.length - 1].full} · ${data.length} ${gran === 'hour' ? 'hour' : 'day'}${data.length === 1 ? '' : 's'}`
    : `${total.toLocaleString()} leads`;

  const titleSub = (
    <div>
      <div className="modal-title">📊 Leads scraped {gran === 'hour' ? 'per hour' : 'per day'}</div>
      <div className="modal-sub">{sub}</div>
    </div>
  );
  const actions = (
    <div className="modal-actions">
      <div className="fi-mode">
        <button className={`fi-mode-btn ${gran === 'day' ? 'active' : ''}`} onClick={() => setGran('day')}>Day</button>
        <button className={`fi-mode-btn ${gran === 'hour' ? 'active' : ''}`} onClick={() => setGran('hour')}>Hour</button>
      </div>
      <div className="fi-mode">
        <button className={`fi-mode-btn ${type === 'bar' ? 'active' : ''}`} onClick={() => setType('bar')}>▮ Bars</button>
        <button className={`fi-mode-btn ${type === 'line' ? 'active' : ''}`} onClick={() => setType('line')}>📈 Line</button>
      </div>
      <select className="fi-country" value={scope} onChange={(e) => setScope(e.target.value)} title="Scope">
        <option value="">All leads</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{(f.icon || '📁') + ' ' + f.name}</option>)}
      </select>
      {!inline && <button className="btn" onClick={onClose}>✕ Close</button>}
    </div>
  );
  const metricsRow = metrics && (
    <section className="widgets sv-metrics">
      <div className="widget"><span className="w-ic blue">📋</span><div className="w-body"><div className="w-num">{fmt(metrics.total)}</div><div className="w-label">Total leads</div></div></div>
      <div className="widget"><span className="w-ic rose">🚫</span><div className="w-body"><div className="w-num rose">{fmt(metrics.noWebsite)}</div><div className="w-label">No website</div></div></div>
      <div className="widget"><span className="w-ic amber">🔥</span><div className="w-body"><div className="w-num amber">{fmt(metrics.hot)}</div><div className="w-label">Hot leads</div></div></div>
      <div className="widget"><span className="w-ic green">💬</span><div className="w-body"><div className="w-num green">{fmt(metrics.reviews)} <span className="w-sub">({fmt(metrics.reviewsSum)})</span></div><div className="w-label">Has reviews</div></div></div>
      <div className="widget"><span className="w-ic violet">✨</span><div className="w-body"><div className="w-num violet">{fmt(metrics.ai)}</div><div className="w-label">Has AI Analysis</div></div></div>
      <div className="widget"><span className="w-ic blue">📧</span><div className="w-body"><div className="w-num">{fmt(metrics.email)}</div><div className="w-label">Emails found</div></div></div>
      <div className="widget"><span className="w-ic amber">🎯</span><div className="w-body"><div className="w-num">{fmt(metrics.avgOpp)}</div><div className="w-label">Avg opportunity</div></div></div>
    </section>
  );
  const chart = loading ? <div className="muted" style={{ padding: 24 }}>Loading…</div>
    : !data.length ? <div className="empty" style={{ padding: 24 }}>No scrape dates here yet.</div>
    : <Chart data={data} type={type} />;
  const body = <>{metricsRow}{chart}</>;

  if (inline) return (
    <section className="statsview">
      <div className="statsview-head">{titleSub}{actions}</div>
      <div className="statsview-body">{body}</div>
    </section>
  );

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">{titleSub}{actions}</div>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}
