const BULLETS: [string, 'peach' | 'lav' | 'blue', string, string][] = [
  ['🎯', 'peach', 'Scrape Any Niche', 'Point it at a Google Maps search — plumbers in Austin, bakeries in Berlin — and let it fill your database.'],
  ['🧭', 'lav', 'Easy To Organize', 'Folders, sub-folders, tags and auto-organize keep thousands of leads tidy without manual work.'],
  ['⚡', 'blue', 'Built For Outreach', 'Website status, emails, phone numbers and AI pitches — everything you need for the first call.'],
];

export default function BuildSection() {
  return (
    <section className="section">
      <div className="split-head">
        <div>
          <div className="eyebrow"><span className="dot" /> How It Works</div>
          <h2 className="h2">GridLeads Helps You Find<br />Your Next Client.</h2>
        </div>
        <div className="split-side">
          <p>
            Scraping, scoring and outreach in one platform. The pipeline works on all
            devices, with a fully organized project management experience.
          </p>
        </div>
      </div>

      <div className="build-grid">
        <div className="build-bullets">
          {BULLETS.map(([ic, tint, title, text]) => (
            <div className="feature-item" key={title}>
              <span className={`tile ${tint}`}>{ic}</span>
              <div><b>{title}</b><p>{text}</p></div>
            </div>
          ))}
        </div>
        <div className="build-chart">
          <div className="pv-stat-h">Lead Pipeline <span className="pv-chip">Weekly ▾</span></div>
          <div className="build-bars">
            {[
              ['Mon', 38, 'pink'], ['Tue', 52, 'blue'], ['Wed', 44, 'lav'],
              ['Thu', 78, 'solid'], ['Fri', 56, 'peach'], ['Sat', 62, 'blue'], ['Sun', 84, 'pink'],
            ].map(([day, h, tint]) => (
              <div className="bb" key={day as string}>
                <span className={`bar ${tint}`} style={{ height: `${h}%` }} />
                <i>{day}</i>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
