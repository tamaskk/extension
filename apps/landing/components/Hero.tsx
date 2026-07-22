import HeroPreview from './HeroPreview';

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3000';

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="eyebrow"><span className="dot" /> Top Lead Platform ✦</div>
      <h1 className="hero-h1">Smarter Leads Stronger<br />Sustainable Sales</h1>
      <p className="hero-sub">
        GridLeads scrapes, scores and organizes local businesses for you —
        so you can focus more on closing deals, not hunting for them.
      </p>
      <a className="btn dark" href={CRM_URL}>Get Started <span className="arr">→</span></a>
      <HeroPreview />
    </section>
  );
}
