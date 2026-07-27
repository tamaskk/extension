'use client';

import { useEffect, useRef, useState } from 'react';
import type { LeadRow } from '@/lib/types';
import { SALES_STATUSES, SALES_NEEDS_DATE } from '@/lib/types';
import { googleCalendarUrl } from '@/lib/gcal';
import { api } from '@/lib/api';
import TagsCell from './TagsCell';
import { WEBSITE_PROMPT_TEMPLATE } from '@/lib/websitePrompt';

const STATUS_OPTIONS = ['HAS_WEBSITE', 'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION', 'NOT_WORKING', 'REDIRECTS'];
const STATUS_LABEL: Record<string, string> = {
  HAS_WEBSITE: 'Has site', NO_WEBSITE: 'No website', FACEBOOK_ONLY: 'Facebook only', INSTAGRAM_ONLY: 'Instagram only',
  BROKEN: 'Broken', DOMAIN_EXPIRED: 'Expired', DOMAIN_PARKED: 'Parked', UNDER_CONSTRUCTION: 'Under constr.', NOT_WORKING: 'Not working', REDIRECTS: 'Redirects',
};

type FieldDef = { key: keyof LeadRow; label: string; type: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'datetime'; options?: string[]; bool?: boolean; step?: number };
const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'salesStatus', label: 'Sales status', type: 'select', options: ['', ...SALES_STATUSES] },
  { key: 'salesDate', label: 'Follow-up date', type: 'datetime' },
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
              : <input ref={ref} type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'datetime' ? 'datetime-local' : 'text'} step={def.step} value={v}
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
  const [wpData, setWpData] = useState<string>(() => [
    `- **Business name:** ${row.name || ''}`,
    `- **Category (as listed):** ${row.category || ''}`,
    `- **Address:** ${row.address || ''}`,
    row.phone ? `- **Phone:** ${row.phone}` : '',
    `- **Website / socials:** ${row.website || '—'}`,
    row.rating ? `- **Rating:** ${row.rating} from ${row.reviewCount ?? 0} reviews` : '',
    '- **Output language:** English',
    '- **Raw guest reviews:**',
  ].filter(Boolean).join('\n'));
  const toggleAcc = (label: string) => setOpenAcc((s) => { const n = new Set(s); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  // Pull this business's scraped Google reviews into the website prompt so the
  // generated site's testimonials/tone come from real guest voices.
  useEffect(() => {
    let cancelled = false;
    api.getReviews(row.dedupKey).then((r) => {
      if (cancelled || !r.ok) return;
      const lines = (r.rows || [])
        .filter((x) => (x.text || '').trim())
        .map((x) => `- ★${x.rating ?? '?'} ${x.author || 'Guest'}: "${(x.text || '').replace(/\s+/g, ' ').trim()}"`);
      if (!lines.length) return;
      setWpData((prev) => (prev.includes('\n- ★') ? prev : prev + '\n\n' + lines.join('\n')));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [row.dedupKey]);

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
              <input type="datetime-local" className="sales-date" value={data.salesDate || ''} onChange={(e) => save('salesDate', e.target.value)} />
              {data.salesDate
                ? <a className="btn primary" href={googleCalendarUrl({ title: `${data.salesStatus} — ${data.name}`, when: data.salesDate, location: data.address })} target="_blank" rel="noreferrer">📅 Add to Google Calendar</a>
                : <span className="muted" style={{ fontSize: 12 }}>Pick a date &amp; time first</span>}
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
