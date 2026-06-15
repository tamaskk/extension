'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NO_SITE } from '@/lib/types';
import { useGrid } from '@/lib/store';

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

const norm = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2'); // "NewYork" → "New York"
// Folder names are "<City...> <BusinessType>" — drop the last word to get the city.
function cityFromFolder(name?: string): string {
  const parts = String(name || '').trim().split(/\s+/);
  return norm(parts.length > 1 ? parts.slice(0, -1).join(' ') : (name || ''));
}
// Project queries are "restaurants near <Area... City>" — drop the first 2 words.
function areaFromProject(query?: string): string {
  const parts = String(query || '').trim().split(/\s+/);
  return norm(parts.length > 2 ? parts.slice(2).join(' ') : (query || ''));
}
// Geocode a (US) city via OpenStreetMap Nominatim → its actual boundary polygon + bbox.
async function geocodeCity(city: string): Promise<{ geojson: any; box: [[number, number], [number, number]] } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&q=${encodeURIComponent(city + ', USA')}`, { headers: { 'Accept-Language': 'en' } });
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const x = arr[0];
    const bb = x.boundingbox; // [south, north, west, east]
    return { geojson: x.geojson || null, box: [[+bb[0], +bb[2]], [+bb[1], +bb[3]]] };
  } catch { return null; }
}
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

type Scope = { type: 'all' | 'folder' | 'project'; id: string };

export default function MapModal({ onClose, project, folder, filter, search }:
  { onClose: () => void; title?: string; project: string | null; folder: string | null; filter: string; search: string }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const highlightRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading map…');
  const [scope, setScope] = useState<Scope>(() => folder ? { type: 'folder', id: folder } : project ? { type: 'project', id: project } : { type: 'all', id: '' });

  const folders = useGrid((s) => s.folders);
  const summaries = useGrid((s) => s.summaries);
  const folderList = useMemo(() => Object.values(folders).sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.createdAt < b.createdAt ? -1 : 1)), [folders]);
  const projectList = useMemo(() => Object.values(summaries).sort((a, b) => String(a.name).localeCompare(String(b.name))), [summaries]);

  const scopeValue = scope.type === 'all' ? 'all' : (scope.type === 'folder' ? 'f:' : 'p:') + scope.id;

  // init the map once (after Leaflet loads)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([loadCss(LEAFLET_CSS), loadCss(MC_CSS), loadCss(MC_CSS2)]);
        await loadScript(LEAFLET_JS);
        await loadScript(MC_JS);
        if (cancelled || !mapEl.current) return;
        const L = window.L;
        const map = L.map(mapEl.current, { worldCopyJump: true }).setView([39.8, -98.5], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
        mapInstance.current = map;
        setReady(true);
      } catch { if (!cancelled) setStatus('❌ Could not load the map.'); }
    })();
    return () => { cancelled = true; if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  // (re)load markers whenever the scope changes
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    let cancelled = false;
    (async () => {
      const L = window.L;
      setStatus('Loading leads…');
      const q = scope.type === 'folder' ? { folder: scope.id } : scope.type === 'project' ? { project: scope.id } : {};
      const geo = await api.getGeo({ ...q, filter, search }).catch(() => ({ points: [], total: 0, capped: false }));
      if (cancelled || !mapInstance.current) return;
      if (clusterRef.current) { mapInstance.current.removeLayer(clusterRef.current); clusterRef.current = null; }
      const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
      const bounds: [number, number][] = [];
      for (const p of geo.points) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
        const noSite = NO_SITE.has(p.websiteStatus as never);
        const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: noSite ? '#f43f5e' : '#22c55e', weight: 1, fillColor: noSite ? '#f43f5e' : '#22c55e', fillOpacity: 0.7 });
        m.bindPopup(popupHtml(p), { minWidth: 210 });
        cluster.addLayer(m);
        bounds.push([p.lat, p.lng]);
      }
      mapInstance.current.addLayer(cluster);
      clusterRef.current = cluster;

      // clear any previous city highlight
      if (highlightRef.current) { mapInstance.current.removeLayer(highlightRef.current); highlightRef.current = null; }

      let framed = false;
      let cityNote = '';
      const place = scope.type === 'folder' ? cityFromFolder(folders[scope.id]?.name)
        : scope.type === 'project' ? areaFromProject(scope.id)
        : '';
      if (place) {
        {
          const city = place;
          const g = await geocodeCity(city);
          if (cancelled || !mapInstance.current) return;
          if (g) {
            const style = { color: '#6366f1', weight: 2, fillColor: '#6366f1', fillOpacity: 0.14 };
            const isPoly = g.geojson && (g.geojson.type === 'Polygon' || g.geojson.type === 'MultiPolygon');
            const layer = isPoly
              ? L.geoJSON(g.geojson, { style, interactive: false })
              : L.rectangle(g.box, style); // point / no-polygon → filled bbox area
            layer.addTo(mapInstance.current);
            highlightRef.current = layer;
            mapInstance.current.fitBounds(isPoly ? layer.getBounds() : g.box, { padding: [20, 20] });
            cityNote = ` · 📍 ${city}`;
            framed = true;
          }
        }
      }
      if (!framed) {
        if (bounds.length) mapInstance.current.fitBounds(bounds, { padding: [30, 30] });
        else mapInstance.current.setView([39.8, -98.5], 4);
      }
      setTimeout(() => mapInstance.current && mapInstance.current.invalidateSize(), 80);
      setStatus(`${geo.points.length.toLocaleString()} plotted${geo.capped ? ` (first ${geo.points.length.toLocaleString()} of ${geo.total.toLocaleString()})` : ''}${cityNote} · 🔴 no website · 🟢 has site`);
    })();
    return () => { cancelled = true; };
  }, [ready, scope, filter, search]);

  const onPick = (v: string) => {
    if (v === 'all') setScope({ type: 'all', id: '' });
    else if (v.startsWith('f:')) setScope({ type: 'folder', id: v.slice(2) });
    else setScope({ type: 'project', id: v.slice(2) });
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗺 Map</div>
            <div className="modal-sub">{status}</div>
          </div>
          <div className="modal-actions">
            <select className="map-select" value={scopeValue} onChange={(e) => onPick(e.target.value)}>
              <option value="all">All leads</option>
              {folderList.length > 0 && (
                <optgroup label="Folders">
                  {folderList.map((f) => <option key={f.id} value={`f:${f.id}`}>📁 {f.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Projects">
                {projectList.map((p) => <option key={p.query} value={`p:${p.query}`}>{p.name}</option>)}
              </optgroup>
            </select>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={mapEl} className="map-canvas" />
      </div>
    </div>
  );
}
