'use client';

import { useEffect, useRef, useState } from 'react';
import type { LeadRow } from '@/lib/types';
import { SALES_STATUSES, SALES_NEEDS_DATE } from '@/lib/types';
import { googleCalendarUrl, calDetails } from '@/lib/gcal';
import { api } from '@/lib/api';
import TagsCell from './TagsCell';

const STATUS_OPTIONS = ['HAS_WEBSITE', 'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION', 'NOT_WORKING', 'REDIRECTS'];
const STATUS_LABEL: Record<string, string> = {
  HAS_WEBSITE: 'Has site', NO_WEBSITE: 'No website', FACEBOOK_ONLY: 'Facebook only', INSTAGRAM_ONLY: 'Instagram only',
  BROKEN: 'Broken', DOMAIN_EXPIRED: 'Expired', DOMAIN_PARKED: 'Parked', UNDER_CONSTRUCTION: 'Under constr.', NOT_WORKING: 'Not working', REDIRECTS: 'Redirects',
};

type FieldDef = { key: keyof LeadRow; label: string; type: 'text' | 'number' | 'textarea' | 'select' | 'date'; options?: string[]; bool?: boolean; step?: number };
const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'salesStatus', label: 'Sales status', type: 'select', options: ['', ...SALES_STATUSES] },
  { key: 'salesDate', label: 'Follow-up date', type: 'date' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'opportunityScore', label: 'Opportunity', type: 'number' },
  { key: 'leadScore', label: 'Lead score', type: 'number' },
  { key: 'leadTemperature', label: 'Temperature', type: 'select', options: ['COLD', 'WARM', 'HOT'] },
  { key: 'websiteStatus', label: 'Website status', type: 'select', options: STATUS_OPTIONS },
  { key: 'website', label: 'Website URL', type: 'text' },
  { key: 'rating', label: 'Rating', type: 'number', step: 0.1 },
  { key: 'reviewCount', label: 'Reviews', type: 'number' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'lat', label: 'Latitude', type: 'number' },
  { key: 'lng', label: 'Longitude', type: 'number' },
  { key: 'mapsUrl', label: 'Maps URL', type: 'text' },
  { key: 'topPitch', label: 'Top pitch', type: 'textarea' },
  { key: 'checked', label: 'Checked', type: 'select', options: ['No', 'Yes'], bool: true },
  { key: 'placeId', label: 'Place ID', type: 'text' },
  { key: 'cid', label: 'CID', type: 'text' },
];

const WEBSITE_PROMPT_TEMPLATE = `"You are a world-class Full-Stack Engineer, UI/UX Designer, and SEO Architect. Your goal is to deliver a production-ready, high-performance restaurant website using Next.js 14+ (App Router) and Tailwind CSS.

EXECUTION PROTOCOL:

1. STEP 1: DEEP RESEARCH: Search for the restaurant [INSERT NAME/DATA], analyze its vibe, cuisine, and USP.
2. STEP 2: TECHNICAL & DESIGN PLAN: Define the brand colors, typography, and SEO strategy.
3. STEP 3: PRODUCTION-READY CODE: Generate the full, modular codebase.

DETAILED SECTION REQUIREMENTS:

1. NAVIGATION & BRANDING (Header)
• Functionality: Sticky header with a backdrop blur effect (backdrop-blur-md).
• Mobile Experience: A sleek slide-out drawer menu with social links and contact info.
• Conversion: Prominent, high-contrast 'Book a Table' CTA button.
• SEO: Use <nav> and proper aria-label attributes.

2. IMMERSIVE HERO SECTION
• Visuals: Use a full-screen or large-scale Unsplash image that reflects the restaurant's atmosphere (e.g., moody lighting for fine dining, bright/fresh for vegan).
• Typography: A bold, SEO-optimized H1 containing the 'Cuisine' + 'Location'.
• Copy: A compelling H2 sub-headline that highlights the unique value proposition.
• Actions: Dual CTAs: Primary (Reservation) and Secondary (View Menu) with hover animations.

3. THE 'LIVING' MENU (Core SEO Section)
• Architecture: Use a tabbed interface or scroll-spy navigation for categories (e.g., Starters, Mains, Desserts, Signature Cocktails).
• Item Details: Each item must include:
  • Name: Clear and descriptive.
  • Description: 2-3 sentences of mouth-watering copy optimized for AI search (mentioning ingredients, cooking techniques, and dietary tags like GF, Vegan, Keto).
  • Price: Clearly formatted.
  • Visual: Optional small thumbnail placeholder or high-quality Unsplash image for signature dishes.
• Technical: Must be semantic HTML (not an image or PDF) for maximum indexability.

4. BRAND STORY & PHILOSOPHY (About)
• Content: Use the research data to write a 2-3 paragraph story. Focus on the 'Why' behind the restaurant (e.g., farm-to-table, heritage recipes, or innovative plant-based cooking).
• Layout: A split-screen layout with text on one side and a high-quality 'behind-the-scenes' Unsplash image on the other.
• SEO: Use keywords related to the restaurant's values and kitchen style.

5. SOCIAL PROOF & COMMUNITY
• Testimonials: A high-end slider or grid featuring 3-5 reviews. Include star ratings, guest names, and a link to the original source (Google/Yelp).
• Instagram Integration: A visual grid of 4-6 Unsplash images simulating a live Instagram feed to show 'social vibe'.
• Trust Signals: Icons for awards, certifications, or 'Featured In' logos.

6. INTERACTIVE CONTACT & LOCATION
• Location: A dedicated section with an embedded Google Maps iframe (placeholder) and a clear 'Get Directions' button.
• Live Status: A dynamic 'Open Now' or 'Closed - Opens at [Time]' badge based on the current time.
• Contact Info: Clickable phone numbers and email addresses using tel: and mailto: links.
• Hours: A clean, structured table of opening hours for the entire week.

7. FAQ & AI SEARCH SNIPPETS
• Structure: An accordion-style UI using framer-motion for smooth transitions.
• Content: 5+ questions specifically chosen to capture 'People Also Ask' traffic (e.g., "Does [Restaurant] have vegan options?", "Is there parking near [Restaurant]?", "Do I need a reservation for [Restaurant]?").
• SEO: Wrap this section in FAQPage JSON-LD schema.

8. FOOTER (The Safety Net)
• Content: Logo, shortened About text, quick links, social icons, and a newsletter signup form.
• Legal: Copyright, Privacy Policy, and Terms of Service links.
• NAP: Consistent Name, Address, and Phone number for Local SEO.

TECHNICAL CONSTRAINTS:
• Language: English only.
• Images: Only use direct URLs from Unsplash.
• SEO: Complete JSON-LD Schema implementation for Restaurant, Menu, and FAQ.
• Performance: 100/100 Lighthouse score target (semantic HTML, optimized assets).
• Code Style: Modular components (e.g., Hero.tsx, Menu.tsx, Navbar.tsx) using TypeScript and Tailwind CSS.

START BY PROVIDING THE RESEARCH SUMMARY, THEN THE PLAN, AND FINALLY THE CODE."`;
const [WP_BEFORE, WP_AFTER] = WEBSITE_PROMPT_TEMPLATE.split('[INSERT NAME/DATA]');

function Accordion({ title, open, onToggle, copyText, children }:
  { title: string; open: boolean; onToggle: () => void; copyText?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(copyText || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };
  return (
    <div className={`ld-acc ${open ? 'open' : ''}`}>
      <div className="ld-acc-head" role="button" onClick={onToggle}>
        <span className="ld-acc-caret">{open ? '▾' : '▸'}</span>
        <span className="ld-acc-title">{title}</span>
        {copyText != null && <button className="ld-acc-copy" onClick={copy} title="Copy the full prompt">{copied ? '✓ Copied' : '⧉ Copy'}</button>}
      </div>
      {open && <div className="ld-acc-body">{children}</div>}
    </div>
  );
}

function EditableField({ def, value, onSave }: { def: FieldDef; value: unknown; onSave: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);

  const toStr = (val: unknown) => def.bool ? (val ? 'Yes' : 'No') : (val == null ? '' : String(val));
  const begin = () => { setV(toStr(value)); setEditing(true); };
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); try { ref.current.select?.(); } catch { /* */ } } }, [editing]);

  const commit = (raw: string) => {
    let out: unknown = raw;
    if (def.bool) out = raw === 'Yes';
    else if (def.type === 'number') out = raw.trim() === '' ? null : Number(raw);
    setEditing(false);
    onSave(out);
  };

  const display = () => {
    if (def.key === 'websiteStatus') return STATUS_LABEL[value as string] || (value as string) || '—';
    if (def.bool) return value ? 'Yes' : 'No';
    if (def.key === 'opportunityScore') {
      const o = (value as number) || 0;
      return <span className="ld-opp"><span className="ld-opp-bar"><span style={{ width: `${o}%` }} /></span>{o}</span>;
    }
    if (value === null || value === undefined || value === '') return '—';
    if (def.key === 'rating') return `★ ${value}`;
    if (def.type === 'number') return (value as number).toLocaleString();
    return String(value);
  };

  return (
    <div className="ld-row">
      <div className="ld-k">{def.label}</div>
      <div className="ld-v ld-editable">
        {editing ? (
          <span className="ld-edit-box">
            {def.type === 'select'
              ? <select ref={ref} value={v} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
                  {(def.options || []).map((o) => <option key={o} value={o}>{o === '' ? '—' : def.key === 'websiteStatus' ? (STATUS_LABEL[o] || o) : o}</option>)}
                </select>
              : def.type === 'textarea'
              ? <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} onBlur={() => commit(v)} rows={3} />
              : <input ref={ref} type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'} step={def.step} value={v}
                  onChange={(e) => setV(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(v); else if (e.key === 'Escape') setEditing(false); }}
                  onBlur={() => commit(v)} />
            }
          </span>
        ) : (
          <>
            <span className="ld-disp">{display()}</span>
            <span className="ld-pen" title={`Edit ${def.label}`} onClick={begin}>✎</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function LeadDetailModal({ row, registry, tagNames, onSaved, onCreateTag, onClose }:
  { row: LeadRow; registry?: Record<string, string>; tagNames: string[]; onSaved: (field: string, value: unknown) => void; onCreateTag: (name: string, color: string) => void; onClose: () => void }) {
  const [data, setData] = useState<LeadRow>(() => ({ ...row }));
  const [openAcc, setOpenAcc] = useState<Set<string>>(new Set());
  const [wpData, setWpData] = useState<string>(() =>
    [row.name, row.category, row.address, row.phone, row.rating ? `★${row.rating} (${row.reviewCount ?? 0} reviews)` : '', row.website].filter(Boolean).join(' · '));
  const toggleAcc = (label: string) => setOpenAcc((s) => { const n = new Set(s); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  const [mtgTime, setMtgTime] = useState('10:00');

  const save = (field: string, value: unknown) => {
    setData((d) => {
      const next = { ...d, [field]: value } as LeadRow;
      if (field === 'opportunityScore') next.leadTemperature = ((value as number) >= 70 ? 'HOT' : (value as number) >= 40 ? 'WARM' : 'COLD');
      return next;
    });
    api.updateLeadField(data._project, data._key, field, value).catch(() => {});
    onSaved(field, value);
    if (field === 'opportunityScore') onSaved('leadTemperature', (value as number) >= 70 ? 'HOT' : (value as number) >= 40 ? 'WARM' : 'COLD');
  };
  const saveTags = (tags: string[]) => {
    setData((d) => ({ ...d, tags }));
    api.setTags(data._project, data._key, tags).catch(() => {});
    onSaved('tags', tags);
  };
  const addTag = (name: string) => { const cur = data.tags || []; if (!cur.includes(name)) saveTags([...cur, name]); };
  const removeTag = (name: string) => saveTags((data.tags || []).filter((t) => t !== name));

  const gmaps = data.mapsUrl || (data.lat != null && data.lng != null ? `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}` : '');

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">{data.name}</div>
            <div className="modal-sub">{[data.category, data.rating ? `★ ${data.rating}${data.reviewCount ? ` (${data.reviewCount.toLocaleString()})` : ''}` : ''].filter(Boolean).join(' · ')} · hover a value & click ✎ to edit</div>
          </div>
          <div className="modal-actions"><button className="btn" onClick={onClose}>✕ Close</button></div>
        </div>
        <div className="modal-body">
          <div className="ld-actions">
            {gmaps && <a className="btn" href={gmaps} target="_blank" rel="noreferrer">📍 Google Maps</a>}
            {data.website && <a className="btn" href={data.website} target="_blank" rel="noreferrer">🌐 Website</a>}
            {data.phone && <a className="btn" href={`tel:${data.phone}`}>📞 Call</a>}
            {data.email && <a className="btn" href={`mailto:${data.email}`}>✉ Email</a>}
          </div>

          {data.topPitch && <div className="ld-pitch">💡 {data.topPitch}</div>}

          <div className="ld-tagsec">
            <div className="ld-k">Tags</div>
            <TagsCell tags={data.tags || []} registry={registry || {}} allNames={tagNames} onAdd={addTag} onRemove={removeTag} onCreate={onCreateTag} />
          </div>

          {SALES_NEEDS_DATE.has(data.salesStatus || '') && (
            <div className="ld-sched">
              <div className="ld-k">📅 Schedule</div>
              <input type="date" className="sales-date" value={data.salesDate || ''} onChange={(e) => save('salesDate', e.target.value)} />
              <input type="time" className="sales-date" value={mtgTime} onChange={(e) => setMtgTime(e.target.value)} />
              {data.salesDate
                ? <a className="btn primary" href={googleCalendarUrl({ title: `${data.salesStatus} — ${data.name}`, dateYmd: data.salesDate, time: mtgTime, details: calDetails(data), location: data.address })} target="_blank" rel="noreferrer">📅 Add to Google Calendar</a>
                : <span className="muted" style={{ fontSize: 12 }}>Pick a date first</span>}
            </div>
          )}

          <div className="ld-grid">
            {FIELDS.map((def) => <EditableField key={def.key as string} def={def} value={data[def.key]} onSave={(v) => save(def.key as string, v)} />)}
          </div>

          <div className="ld-accordions">
            <Accordion title="Website prompt" open={openAcc.has('Website prompt')} onToggle={() => toggleAcc('Website prompt')} copyText={WP_BEFORE + wpData + WP_AFTER}>
              <div className="wp-body">
                <pre className="wp-text">{WP_BEFORE}</pre>
                <textarea className="wp-textarea" value={wpData} onChange={(e) => setWpData(e.target.value)} placeholder="Paste the restaurant name / data here…" rows={3} />
                <pre className="wp-text">{WP_AFTER}</pre>
              </div>
            </Accordion>
            {['AI Automation prompt', 'Website sales', 'AI Automation sales'].map((label) => (
              <Accordion key={label} title={label} open={openAcc.has(label)} onToggle={() => toggleAcc(label)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
