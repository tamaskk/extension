'use client';

import { useStats, NumberRoll, compact, pct } from './StatsProvider';

export default function Testimonials() {
  const { stats, loading } = useStats();
  const hotPct = stats ? pct(stats.hotLeads, stats.totalLeads) : null;

  return (
    <section className="section">
      <div className="center-head">
        <div className="eyebrow center"><span className="dot" /> Our Numbers</div>
        <h2 className="h2">What The Database Says</h2>
        <p className="sub">Live figures from the GridLeads database — and how they change the way you sell.</p>
      </div>

      <div className="quote-row">
        <div className="quote-num">
          <div className="qn">{loading || !stats ? '…' : <NumberRoll value={stats.totalLeads} format={compact} />}</div>
          <div className="ql">Leads collected</div>
        </div>
        <div className="quote-card">
          <p>
            Every one of these businesses was scraped, deduplicated and scored automatically.
            The database keeps growing while you sleep — and the outlook just keeps getting sunnier.
          </p>
          <div className="quote-by"><span className="tile pink">✦</span><span><b>GridLeads Scraper</b><i>Google Maps engine</i></span></div>
        </div>
      </div>

      <div className="quote-row">
        <div className="quote-num">
          <div className="qn">{loading || hotPct === null ? '…' : <NumberRoll value={hotPct} format={(n) => `${n}%`} />}</div>
          <div className="ql">Hot lead ratio</div>
        </div>
        <div className="quote-card">
          <p>
            GridLeads is created for sales people. It&apos;s the kind of software that just works —
            temperature scoring already picked out the leads worth calling today. It&apos;s just perfect.
          </p>
          <div className="quote-by"><span className="tile peach">🔥</span><span><b>Lead Temperature</b><i>scoring model</i></span></div>
        </div>
      </div>
    </section>
  );
}
