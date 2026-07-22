const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3000';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="foot-inner">
        <div className="foot-grid">
          <div className="foot-cta">
            <h2 className="h2">Are You Interested<br />In GridLeads?</h2>
            <a className="btn dark" href={CRM_URL}>Open The CRM <span className="arr">→</span></a>
          </div>
          <div className="foot-col">
            <b>Product</b>
            <a href="#features">Features</a>
            <a href="#stats">Live Stats</a>
            <a href={CRM_URL}>CRM</a>
          </div>
          <div className="foot-col">
            <b>Tools</b>
            <a href={CRM_URL}>Map View</a>
            <a href={CRM_URL}>Reviews</a>
            <a href={CRM_URL}>Organize</a>
          </div>
          <div className="foot-col">
            <b>Account</b>
            <a href={CRM_URL + '/login'}>Sign in</a>
            <a href="#faq">FAQ</a>
          </div>
        </div>

        <div className="foot-bar">
          <span className="brand"><span className="brand-mark">✦</span> GridLeads<span className="brand-dot">.</span></span>
          <nav className="nav-pill">
            <a className="on" href="#top">Home</a>
            <a href="#features">Features</a>
            <a href="#stats">Stats</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="foot-social">
            <span>f</span><span>◎</span><span>𝕏</span><span>in</span>
          </div>
        </div>

        <div className="foot-legal">
          <span>© GridLeads — internal lead platform</span>
          <span>Counts live from your own database</span>
        </div>
      </div>
      <div className="foot-mark" aria-hidden>GRIDLEADS</div>
    </footer>
  );
}
