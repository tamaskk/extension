'use client';

import type { LeadRow } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = {
  HAS_WEBSITE: 'Has site', NO_WEBSITE: 'No website', FACEBOOK_ONLY: 'Facebook only', INSTAGRAM_ONLY: 'Instagram only',
  BROKEN: 'Broken', DOMAIN_EXPIRED: 'Expired', DOMAIN_PARKED: 'Parked', UNDER_CONSTRUCTION: 'Under constr.', NOT_WORKING: 'Not working', REDIRECTS: 'Redirects',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return <div className="ld-row"><div className="ld-k">{label}</div><div className="ld-v">{children}</div></div>;
}

export default function LeadDetailModal({ row, registry, onClose }:
  { row: LeadRow; registry?: Record<string, string>; onClose: () => void }) {
  const gmaps = row.mapsUrl || (row.lat != null && row.lng != null ? `https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}` : '');
  const opp = row.opportunityScore || 0;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">{row.name}</div>
            <div className="modal-sub">{[row.category, row.rating ? `★ ${row.rating}${row.reviewCount ? ` (${row.reviewCount.toLocaleString()})` : ''}` : ''].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="modal-actions"><button className="btn" onClick={onClose}>✕ Close</button></div>
        </div>
        <div className="modal-body">
          <div className="ld-actions">
            {gmaps && <a className="btn" href={gmaps} target="_blank" rel="noreferrer">📍 Google Maps</a>}
            {row.website && <a className="btn" href={row.website} target="_blank" rel="noreferrer">🌐 Website</a>}
            {row.phone && <a className="btn" href={`tel:${row.phone}`}>📞 Call</a>}
            {row.email && <a className="btn" href={`mailto:${row.email}`}>✉ Email</a>}
          </div>

          {row.topPitch && <div className="ld-pitch">💡 {row.topPitch}</div>}

          <div className="ld-grid">
            <Row label="Opportunity">
              <span className="ld-opp"><span className="ld-opp-bar"><span style={{ width: `${opp}%` }} /></span>{opp}</span>
              {row.leadTemperature && <span className={`temp ${row.leadTemperature}`} style={{ marginLeft: 8 }}>{row.leadTemperature}</span>}
            </Row>
            <Row label="Lead score">{row.leadScore ?? '—'}</Row>
            <Row label="Website">{STATUS_LABEL[row.websiteStatus] || row.websiteStatus || '—'}{row.website ? <> · <a className="mlink" href={row.website} target="_blank" rel="noreferrer">{row.website}</a></> : ''}</Row>
            <Row label="Rating">{row.rating != null ? `★ ${row.rating}` : '—'}</Row>
            <Row label="Reviews">{row.reviewCount != null ? row.reviewCount.toLocaleString() : '—'}</Row>
            <Row label="Phone">{row.phone || '—'}</Row>
            <Row label="Email">{row.email || '—'}</Row>
            <Row label="Category">{row.category || '—'}</Row>
            <Row label="Address">{row.address || '—'}</Row>
            <Row label="Coordinates">{row.lat != null && row.lng != null ? `${row.lat}, ${row.lng}` : '—'}</Row>
            <Row label="Online booking">{row.hasBookingHint === true ? 'Yes' : row.hasBookingHint === false ? 'No' : '—'}</Row>
            <Row label="Checked">{row.checked ? 'Yes' : 'No'}</Row>
            <Row label="Project">{row._project}</Row>
            <Row label="Scraped at">{row.scrapedAt ? new Date(row.scrapedAt).toLocaleString() : '—'}</Row>
            <Row label="Place ID">{row.placeId || '—'}</Row>
            <Row label="CID">{row.cid || '—'}</Row>
          </div>

          {(row.tags && row.tags.length > 0) && (
            <div className="ld-tags">
              {row.tags.map((t) => { const c = (registry && registry[t]) || '#6366f1'; return <span key={t} className="tagchip" style={{ background: c }}>{t}</span>; })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
