'use client';

import { useState } from 'react';

const ITEMS: [string, string][] = [
  ['How do leads get into the database?', 'The GridLeads Chrome extension scrapes Google Maps searches and syncs every business into the shared database — deduplicated, scored and organized into projects. You can also import JSON bundles directly in the CRM.'],
  ['What makes a lead "hot"?', 'Every lead gets a temperature (HOT / WARM / COLD) from the scoring model based on reviews, ratings, website status and other signals — so you always know who to call first.'],
  ['Why do leads without a website matter?', 'A business with no usable website — or only a Facebook page, a broken or expired domain — is the perfect prospect for web design and marketing services. GridLeads counts them for you automatically.'],
];

export default function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="section faq" id="faq">
      <div className="center-head">
        <div className="eyebrow center"><span className="dot" /> Our FAQs</div>
        <h2 className="h2">GridLeads FAQs</h2>
        <p className="sub">Everything about how the scraper, the scoring and the live stats work together.</p>
      </div>

      <div className="faq-list">
        {ITEMS.map(([q, a], i) => (
          <div className={`faq-item ${open === i ? 'open' : ''}`} key={q}>
            <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
              {q}<span className="faq-x">{open === i ? '−' : '+'}</span>
            </button>
            {open === i && <p className="faq-a">{a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
