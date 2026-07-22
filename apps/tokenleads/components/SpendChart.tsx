'use client';

export interface DayPoint { label: string; value: number; }

// Dependency-free SVG bar chart — daily token spend. The peak day gets the
// gradient highlight, the rest stay soft lavender (Panze-style).
export default function SpendChart({ data, height = 220 }: { data: DayPoint[]; height?: number }) {
  const W = 720, H = height, PAD_L = 34, PAD_B = 24, PAD_T = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - PAD_L - 8;
  const innerH = H - PAD_B - PAD_T;
  const step = innerW / data.length;
  const barW = Math.min(34, step * 0.62);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Napi token költés oszlopdiagram" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const y = PAD_T + innerH - (t / max) * innerH;
        return (
          <g key={i}>
            <line x1={PAD_L} x2={W - 8} y1={y} y2={y} stroke="#eeecf8" strokeWidth="1" />
            <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#928ea9">{t}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = d.value === 0 ? 3 : Math.max(4, (d.value / max) * innerH);
        const x = PAD_L + i * step + (step - barW) / 2;
        const y = PAD_T + innerH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={Math.min(7, barW / 2)}
              fill={i === peak && d.value > 0 ? 'url(#barGrad)' : '#e9e5fb'}>
              <title>{`${d.label}: ${d.value} token`}</title>
            </rect>
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#928ea9">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
