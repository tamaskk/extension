const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3000';

export default function Navbar() {
  return (
    <header className="nav">
      <a className="brand" href="#top"><span className="brand-mark">✦</span> GridLeads<span className="brand-dot">.</span></a>
      <nav className="nav-pill">
        <a className="on" href="#top">Home</a>
        <a href="#features">Features</a>
        <a href="#stats">Stats</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div className="nav-side">
        <a className="nav-signin" href={CRM_URL + '/login'}>Sign in</a>
        <a className="btn light" href={CRM_URL}>Open CRM</a>
      </div>
    </header>
  );
}
