'use client';

import { useStats, NumberRoll, pct } from './StatsProvider';
import type { LeadStats } from '@/lib/types';

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3000';

interface CardDef {
  key: keyof LeadStats;
  icon: string;
  tint: 'lav' | 'peach' | 'pink';
  label: string;
  desc: string;
  showShare: boolean;
}

const CARDS: CardDef[] = [
  { key: 'totalLeads', icon: '🗂️', tint: 'lav', label: 'Total Leads', desc: 'Every business scraped across all projects and folders.', showShare: false },
  { key: 'leadsWithoutWebsite', icon: '🌐', tint: 'peach', label: 'Without a Website', desc: 'No site, social-only, broken or expired — your best-fit prospects.', showShare: true },
  { key: 'hotLeads', icon: '🔥', tint: 'pink', label: 'Hot Leads', desc: 'Scored HOT by lead temperature — the ones to call first.', showShare: true },
];

function StatCard({ def, stats }: { def: CardDef; stats: LeadStats }) {
  const value = stats[def.key];
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className={`tile ${def.tint}`}>{def.icon}</span>
        {def.showShare && <span className="share-chip">↑ {pct(value, stats.totalLeads)}% of all leads</span>}
      </div>
      <div className="stat-num"><NumberRoll value={value} /></div>
      <div className="stat-lbl">{def.label}</div>
      <p className="stat-desc">{def.desc}</p>
      <div className={`stat-stripes ${def.tint}`} aria-hidden />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="stat-card">
      <div className="stat-top"><span className="skel sk-tile" /></div>
      <div className="skel sk-num" />
      <div className="skel sk-lbl" />
      <div className="skel sk-desc" />
      <div className="skel stat-stripes" />
    </div>
  );
}

export default function StatsSection() {
  const { stats, loading, error, reload } = useStats();
  const empty = !loading && !error && stats !== null && stats.totalLeads === 0;

  return (
    <section className="section" id="stats">
      <div className="split-head">
        <div>
          <div className="eyebrow"><span className="live-dot" /> Live from the database</div>
          <h2 className="h2">Finding Your Next Client<br />Is Easier.</h2>
        </div>
        <div className="split-side">
          <p>Counted the moment you opened this page — not yesterday&apos;s report, not a cached export.</p>
          <a className="btn dark" href={CRM_URL}>Open The CRM <span className="arr">→</span></a>
        </div>
      </div>

      {loading && (
        <div className="stat-grid" aria-busy>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {!loading && error && (
        <div className="state-card">
          <div className="state-ic">⚠️</div>
          <div className="state-t">Couldn&apos;t load the live stats</div>
          <p className="stat-desc">{error}</p>
          <button className="btn dark" onClick={reload}>Try again <span className="arr">↻</span></button>
        </div>
      )}

      {empty && (
        <div className="state-card">
          <div className="state-ic">🗂️</div>
          <div className="state-t">No leads yet</div>
          <p className="stat-desc">The database is empty. Scrape a search or import a bundle in the CRM to see live numbers here.</p>
          <a className="btn dark" href={CRM_URL}>Go to the CRM <span className="arr">→</span></a>
        </div>
      )}

      {!loading && !error && stats && !empty && (
        <div className="stat-grid">
          {CARDS.map((c) => <StatCard key={c.key} def={c} stats={stats} />)}
        </div>
      )}
    </section>
  );
}
