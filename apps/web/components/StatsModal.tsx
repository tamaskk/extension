'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Folder } from '@/lib/types';

type Day = { date: string; count: number };

// fill every day between the first and last scraped day (gaps → 0)
function fillRange(days: Day[]): Day[] {
  if (!days.length) return [];
  const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const map = new Map(days.map((d) => [d.date, d.count]));
  const out: Day[] = [];
  for (let t = parse(days[0].date); t <= parse(days[days.length - 1].date); t += 86400000) out.push({ date: fmt(t), count: map.get(fmt(t)) || 0 });
  return out;
}
const niceMax = (m: number) => { if (m <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(m))); const n = m / p; const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return s * p; };
const mmdd = (s: string) => s.slice(5);

function Chart({ data, type }: { data: Day[]; type: 'bar' | 'line' }) {
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
  const pts = data.map((d, i) => `${cx(i)},${yOf(d.count)}`).join(' ');

  return (
    <svg className="stats-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* grid + y labels */}
      {Array.from({ length: ticks + 1 }, (_, k) => {
        const v = (yMax / ticks) * k; const y = yOf(v);
        return <g key={k}>
          <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" strokeWidth="1" />
          <text x={padL - 8} y={y + 4} textAnchor="end" className="stats-axis">{Math.round(v)}</text>
        </g>;
      })}
      {/* x axis */}
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--muted)" strokeWidth="1" />
      {type === 'bar'
        ? data.map((d, i) => <rect key={i} x={cx(i) - barW / 2} y={yOf(d.count)} width={barW} height={padT + plotH - yOf(d.count)} rx="2" fill="#2bb3c0">
            <title>{d.date}: {d.count}</title>
          </rect>)
        : <>
            <polyline points={pts} fill="none" stroke="#e23b3b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => <circle key={i} cx={cx(i)} cy={yOf(d.count)} r="3" fill="#e23b3b"><title>{d.date}: {d.count}</title></circle>)}
          </>}
      {/* x labels */}
      {data.map((d, i) => (i % labelEvery === 0 ? <text key={i} x={cx(i)} y={padT + plotH + 20} textAnchor="middle" className="stats-axis">{mmdd(d.date)}</text> : null))}
    </svg>
  );
}

export default function StatsModal({ folders, initialFolder, onClose }:
  { folders: Folder[]; initialFolder: string | null; onClose: () => void }) {
  const [scope, setScope] = useState<string>(initialFolder || ''); // '' = all leads
  const [type, setType] = useState<'bar' | 'line'>('bar');
  const [days, setDays] = useState<Day[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getStats(scope ? { folder: scope } : {})
      .then((r) => { if (!cancelled) { setDays(r.days || []); setTotal(r.total || 0); } })
      .catch(() => { if (!cancelled) { setDays([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const filled = useMemo(() => fillRange(days), [days]);
  const range = filled.length ? `${filled[0].date} → ${filled[filled.length - 1].date} · ${filled.length} day${filled.length === 1 ? '' : 's'}` : '';

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">📊 Leads scraped per day</div>
            <div className="modal-sub">{loading ? 'Loading…' : `${total.toLocaleString()} leads${range ? ' · ' + range : ''}`}</div>
          </div>
          <div className="modal-actions">
            <div className="fi-mode">
              <button className={`fi-mode-btn ${type === 'bar' ? 'active' : ''}`} onClick={() => setType('bar')}>▮ Bars</button>
              <button className={`fi-mode-btn ${type === 'line' ? 'active' : ''}`} onClick={() => setType('line')}>📈 Line</button>
            </div>
            <select className="fi-country" value={scope} onChange={(e) => setScope(e.target.value)} title="Scope">
              <option value="">All leads</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{(f.icon || '📁') + ' ' + f.name}</option>)}
            </select>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body">
          {loading ? <div className="muted" style={{ padding: 24 }}>Loading…</div>
            : !filled.length ? <div className="empty" style={{ padding: 24 }}>No scrape dates here yet.</div>
            : <Chart data={filled} type={type} />}
        </div>
      </div>
    </div>
  );
}
