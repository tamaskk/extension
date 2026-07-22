'use client';

import { useStats, NumberRoll, pct } from './StatsProvider';

/** Decorative dashboard mock in the hero — the numbers inside are live. */
export default function HeroPreview() {
  const { stats, loading } = useStats();
  const noSitePct = stats ? pct(stats.leadsWithoutWebsite, stats.totalLeads) : null;

  return (
    <div className="pv-wrap">
      <div className="pv">
        <div className="pv-top">
          <span className="pv-logo">✦</span>
          <b className="pv-title">Lead Analysis</b>
          <span className="pv-search">⌕&nbsp; Search leads…</span>
          <span className="pv-chip">◷ Live</span>
        </div>
        <div className="pv-tabs">
          <span className="on">Overview</span><span>Activity</span><span>Timeline</span><span>Report</span>
          <span className="pv-tabs-right"><span className="pv-chip">Last Week ▾</span><span className="pv-chip dark">Export ↗</span></span>
        </div>
        <div className="pv-grid">
          <div className="pv-rail">
            <span className="on">▦</span><span>◔</span><span>▤</span><span>♡</span><span>⚙</span>
          </div>

          <div className="pv-main">
            <div className="pv-stat">
              <div className="pv-stat-h">No-Website Share <span className="pv-chip">All ▾</span></div>
              <div className="pv-pct">
                {loading || noSitePct === null ? <span className="skel pv-skel-pct" /> : <>% <NumberRoll value={noSitePct} format={String} /></>}
              </div>
              <div className="pv-muted">Of your whole database</div>
            </div>
            <div className="pv-chart">
              <div className="pv-stat-h">Statistic <span className="pv-chip">Leads ▾</span></div>
              <div className="pv-bars">
                {([['Jan', 58, 'pink'], ['Feb', 86, 'blue'], ['Mar', 70, 'lav'], ['Apr', 96, 'peach']] as const).map(([m, h, tint]) => (
                  <span className="bcol" key={m}>
                    <span className={`bar ${tint}`} style={{ height: `${h}%` }} />
                    <i>{m}</i>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="pv-side">
            <div className="pv-card">
              <div className="pv-stat-h">Recent Activity <span className="pv-go">↗</span></div>
              <div className="pv-row">
                <span className="pv-ic peach">🔥</span>
                <span className="pv-row-t"><b>Hot leads</b><i>scored by temperature</i></span>
                <b className="pv-row-n">{loading || !stats ? '…' : <NumberRoll value={stats.hotLeads} />}</b>
              </div>
              <div className="pv-row">
                <span className="pv-ic lav">🌐</span>
                <span className="pv-row-t"><b>No website</b><i>ready to pitch</i></span>
                <b className="pv-row-n">{loading || !stats ? '…' : <NumberRoll value={stats.leadsWithoutWebsite} />}</b>
              </div>
            </div>
            <div className="pv-card yellow">
              <div className="pv-stat-h">My Database <span className="pv-go">↗</span></div>
              <div className="pv-goal-label">All scraped leads</div>
              <svg className="pv-spark" viewBox="0 0 120 28" aria-hidden>
                <polyline points="0,22 18,18 34,20 52,10 70,14 88,6 106,9 120,3" fill="none" stroke="#17181c" strokeWidth="2" />
                <circle cx="88" cy="6" r="3" fill="#17181c" />
              </svg>
              <div className="pv-goal">
                {loading || !stats ? <span className="skel pv-skel-goal" /> : <><b><NumberRoll value={stats.totalLeads} /></b><span> leads</span></>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
