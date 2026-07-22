export default function Features() {
  return (
    <section className="section" id="features">
      <div className="feature-panel">
        <div className="feature-mock">
          <div className="pv-card wide">
            <div className="pv-stat-h">Recent Activity <span className="pv-go">↗</span></div>
            <div className="pv-legend"><span>↑ Scraped</span><span>↓ Contacted</span></div>
            <div className="pv-row">
              <span className="pv-ic lav">🏪</span>
              <span className="pv-row-t"><b>Stone Black Bakery</b><i>scraped · 5 mins ago</i></span>
              <b className="pv-row-n">HOT</b>
            </div>
            <div className="pv-row">
              <span className="pv-ic peach">🔧</span>
              <span className="pv-row-t"><b>Delta Plumbing Co.</b><i>no website · 12 mins ago</i></span>
              <b className="pv-row-n">NEW</b>
            </div>
          </div>
        </div>
        <div className="feature-copy">
          <div className="eyebrow"><span className="dot" /> Key Features</div>
          <h2 className="h2">What Can GridLeads<br />Do For You?</h2>
          <div className="feature-item">
            <span className="tile peach">📇</span>
            <div>
              <b>Better Lead Management</b>
              <p>Track every interaction with potential customers in one centralized place — folders, tags, calls and pipeline stages.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="tile lav">📊</span>
            <div>
              <b>Smart Data Analytics</b>
              <p>Lead temperature, opportunity scores and real-time stats help you make better decisions about who to call first.</p>
            </div>
          </div>
          <a className="btn dark" href="#stats">See Live Stats <span className="arr">→</span></a>
        </div>
      </div>
    </section>
  );
}
