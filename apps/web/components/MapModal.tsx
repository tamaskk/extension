'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NO_SITE } from '@/lib/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { L: any } }

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const MC_CSS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
const MC_CSS2 = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
const MC_JS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';

function loadCss(href: string) {
  return new Promise<void>((res) => {
    if (document.querySelector(`link[href="${href}"]`)) return res();
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => res(); l.onerror = () => res();
    document.head.appendChild(l);
  });
}
function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const STATUS_LABEL: Record<string, string> = {
  HAS_WEBSITE: 'Has site', NO_WEBSITE: 'No website', FACEBOOK_ONLY: 'Facebook only', INSTAGRAM_ONLY: 'Instagram only',
  BROKEN: 'Broken', DOMAIN_EXPIRED: 'Expired', DOMAIN_PARKED: 'Parked', UNDER_CONSTRUCTION: 'Under constr.', NOT_WORKING: 'Not working', REDIRECTS: 'Redirects',
};

function popupHtml(p: any) {
  const noSite = NO_SITE.has(p.websiteStatus);
  const label = STATUS_LABEL[p.websiteStatus] || p.websiteStatus || '—';
  const meta = [p.category, p.rating ? `★ ${p.rating}${p.reviewCount ? ` (${p.reviewCount})` : ''}` : '', p.opportunityScore != null ? `⚡ ${p.opportunityScore}` : '']
    .filter(Boolean).map(esc).join(' · ');
  const gmaps = p.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return `
    <div class="mp">
      <div class="mp-name">${esc(p.name)}</div>
      ${meta ? `<div class="mp-meta">${meta}</div>` : ''}
      <div class="mp-tags"><span class="chip ${noSite ? 'red' : 'green'}">${esc(label)}</span>${p.leadTemperature ? `<span class="temp ${esc(p.leadTemperature)}">${esc(p.leadTemperature)}</span>` : ''}</div>
      ${p.phone ? `<div class="mp-phone">📞 ${esc(p.phone)}</div>` : ''}
      <div class="mp-btns">
        <a href="${esc(gmaps)}" target="_blank" rel="noreferrer">📍 Google Maps</a>
        ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noreferrer">🌐 Website</a>` : ''}
        ${p.phone ? `<a href="tel:${esc(p.phone)}">📞 Call</a>` : ''}
      </div>
    </div>`;
}

export default function MapModal({ onClose, title, project, folder, filter, search }:
  { onClose: () => void; title: string; project: string | null; folder: string | null; filter: string; search: string }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [status, setStatus] = useState('Loading map…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([loadCss(LEAFLET_CSS), loadCss(MC_CSS), loadCss(MC_CSS2)]);
        await loadScript(LEAFLET_JS);
        await loadScript(MC_JS);
        if (cancelled || !mapEl.current) return;
        const L = window.L;

        setStatus('Loading leads…');
        const geo = await api.getGeo({ project, folder, filter, search });
        if (cancelled || !mapEl.current) return;
        const pts = geo.points || [];

        const map = L.map(mapEl.current, { worldCopyJump: true }).setView([39.8, -98.5], 4);
        mapInstance.current = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);

        const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
        const bounds: [number, number][] = [];
        for (const p of pts) {
          if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
          const noSite = NO_SITE.has(p.websiteStatus as never);
          const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: noSite ? '#f43f5e' : '#22c55e', weight: 1, fillColor: noSite ? '#f43f5e' : '#22c55e', fillOpacity: 0.7 });
          m.bindPopup(popupHtml(p), { minWidth: 210 });
          cluster.addLayer(m);
          bounds.push([p.lat, p.lng]);
        }
        map.addLayer(cluster);
        if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
        setTimeout(() => map.invalidateSize(), 100);

        setStatus(`${pts.length.toLocaleString()} plotted${geo.capped ? ` (of ${geo.total.toLocaleString()} — first ${pts.length.toLocaleString()})` : ''} · 🔴 no website · 🟢 has site`);
      } catch {
        if (!cancelled) setStatus('❌ Could not load the map.');
      }
    })();
    return () => { cancelled = true; if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗺 Map — {title}</div>
            <div className="modal-sub">{status}</div>
          </div>
          <button className="btn" onClick={onClose}>✕ Close</button>
        </div>
        <div ref={mapEl} className="map-canvas" />
      </div>
    </div>
  );
}
