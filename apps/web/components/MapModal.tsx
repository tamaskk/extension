'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NO_SITE } from '@/lib/types';
import { useGrid } from '@/lib/store';
import { COUNTRY_NAMES, COUNTRY_CITIES } from '@/lib/countries';

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
      <a class="mp-crm" href="#" role="button" data-crm="${esc(p.name)}">🗂 Open in CRM</a>
      <div class="mp-btns">
        <a href="${esc(gmaps)}" target="_blank" rel="noreferrer">📍 Google Maps</a>
        ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noreferrer">🌐 Website</a>` : ''}
        ${p.phone ? `<a href="tel:${esc(p.phone)}">📞 Call</a>` : ''}
      </div>
    </div>`;
}

type Scope = { type: 'all' | 'folder' | 'project'; id: string };

export default function MapModal({ onClose, inline, onOpenCrm, project, folder, filter, search, categories, ptypes, pregions }:
  { onClose: () => void; inline?: boolean; onOpenCrm?: (name: string) => void; title?: string; project: string | null; folder: string | null; filter: string; search: string; categories?: string[]; ptypes?: string[]; pregions?: string[] }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const onOpenCrmRef = useRef(onOpenCrm);
  onOpenCrmRef.current = onOpenCrm;
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

  // business types = the verticals of the ROOT folders ("USA Restaurants" → "Restaurants"),
  // i.e. drop the leading country name; de-duplicated.
  const bizTypes = useMemo(() => {
    const desc = [...COUNTRY_NAMES].sort((a, b) => b.length - a.length);
    const set = new Set<string>();
    for (const f of Object.values(folders)) {
      if (f.parentId) continue; // root folders only
      const n = (f.name || '').trim();
      const c = desc.find((x) => n.toLowerCase().startsWith(x.toLowerCase() + ' '));
      if (!c) continue;          // only "<Country> <Vertical>" roots
      const v = n.slice(c.length).trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [folders]);

  const scopeValue = scope.type === 'all' ? 'all' : (scope.type === 'folder' ? 'f:' : 'p:') + scope.id;

  // ── inline cascade filter: business type → country → (USA: state→city) / (other: city→area)
  const [cas, setCas] = useState({ biz: '', country: '', state: '', city: '', area: '' });
  const [stateData, setStateData] = useState<{ names: string[]; places: Record<string, [string, number][]> } | null>(null);
  const [areaData, setAreaData] = useState<Record<string, Record<string, string[]>> | null>(null);
  const fileKey = (c: string) => c.toLowerCase().replace(/\s+/g, '');
  useEffect(() => {
    if (!inline) return;
    if (cas.country === 'USA' && !stateData) import('@/lib/states').then((m) => setStateData({ names: m.STATE_NAMES, places: m.STATE_PLACES })).catch(() => {});
    if (cas.country && cas.country !== 'USA' && !areaData) import('@/lib/countryAreas').then((m) => setAreaData(m.COUNTRY_AREAS_BY_FILE)).catch(() => {});
  }, [inline, cas.country, stateData, areaData]);

  const cityOptions = cas.country === 'USA'
    ? (stateData?.places[cas.state]?.map(([n]) => n) || [])
    : (cas.country ? (COUNTRY_CITIES[cas.country] || []) : []);
  const areaOptions = (cas.country && cas.country !== 'USA' && cas.city) ? (areaData?.[fileKey(cas.country)]?.[cas.city] || []) : [];

  // effective query params: combines the folder/project scope picker with the
  // cascade (business type → country → state/city or city/area). `none` = nothing
  // selected → plot nothing (don't load everything on first open).
  const eff = (() => {
    if (!inline) return { project: scope.type === 'project' ? scope.id : null, folder: scope.type === 'folder' ? scope.id : null, ptypes: ptypes || [], pregions: pregions || [], search: search || '', none: false };
    const p = cas.biz ? cas.biz.toLowerCase() + ' near' : ''; // vertical → query prefix
    let project: string | null = scope.type === 'project' ? scope.id : null;
    const folder: string | null = scope.type === 'folder' ? scope.id : null;
    let pt: string[] = []; let pr: string[] = []; let sr = '';
    if (cas.country === 'USA') {
      if (p && cas.state && cas.city) project = `${p} ${cas.city} ${cas.state}`;
      else { if (p) pt = [p]; if (cas.state) pr = [cas.state]; if (cas.city) sr = cas.city; }
    } else if (cas.country) {
      if (p && cas.city && cas.area) project = `${p} ${cas.area} ${cas.city}`;
      else { if (p) pt = [p]; if (cas.city) pr = [cas.city]; if (cas.area) sr = cas.area; }
    } else if (p) { pt = [p]; }
    const none = !(folder || project || pt.length || pr.length || sr);
    return { project, folder, ptypes: pt, pregions: pr, search: sr, none };
  })();
  const effKey = JSON.stringify(eff);

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
    // delegate clicks on the popup's "Open in CRM" button back to React
    const el = mapEl.current;
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.('.mp-crm') as HTMLElement | null;
      if (!t) return;
      e.preventDefault();
      const name = t.getAttribute('data-crm') || '';
      if (name && onOpenCrmRef.current) onOpenCrmRef.current(name);
    };
    if (el) el.addEventListener('click', onClick);
    return () => { cancelled = true; if (el) el.removeEventListener('click', onClick); if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  // (re)load markers whenever the scope changes
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    let cancelled = false;
    (async () => {
      const L = window.L;
      if (eff.none) {
        if (clusterRef.current) { mapInstance.current.removeLayer(clusterRef.current); clusterRef.current = null; }
        if (highlightRef.current) { mapInstance.current.removeLayer(highlightRef.current); highlightRef.current = null; }
        setStatus('Choose a business type / state / city above to plot leads.');
        return;
      }
      setStatus('Loading leads…');
      const q = eff.folder ? { folder: eff.folder } : eff.project ? { project: eff.project } : {};
      const geo = await api.getGeo({ ...q, filter, search: eff.search, categories, ptypes: eff.ptypes, pregions: eff.pregions }).catch(() => ({ points: [], total: 0, capped: false }));
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
      const place = inline ? ''
        : scope.type === 'folder' ? cityFromFolder(folders[scope.id]?.name)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, effKey, filter, (categories || []).join('')]);

  const onPick = (v: string) => {
    if (v === 'all') setScope({ type: 'all', id: '' });
    else if (v.startsWith('f:')) setScope({ type: 'folder', id: v.slice(2) });
    else setScope({ type: 'project', id: v.slice(2) });
  };

  const scopePicker = (
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
  );

  // inline: fills the main content area (a view, not a modal) with a cascade filter
  if (inline) {
    return (
      <section className="mapview">
        <div className="mapview-bar">
          <div className="mapview-filters">
            {scopePicker}
            <select className="map-select" value={cas.biz} onChange={(e) => setCas((c) => ({ ...c, biz: e.target.value }))}>
              <option value="">Choose business type</option>
              {bizTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="map-select" value={cas.country} onChange={(e) => setCas((c) => ({ ...c, country: e.target.value, state: '', city: '', area: '' }))}>
              <option value="">Choose country</option>
              {COUNTRY_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {cas.country === 'USA' ? (
              <>
                <select className="map-select" value={cas.state} disabled={!stateData} onChange={(e) => setCas((c) => ({ ...c, state: e.target.value, city: '' }))}>
                  <option value="">{stateData ? 'Choose state' : 'Loading…'}</option>
                  {(stateData?.names || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="map-select" value={cas.city} disabled={!cas.state} onChange={(e) => setCas((c) => ({ ...c, city: e.target.value, area: '' }))}>
                  <option value="">Choose city</option>
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            ) : cas.country ? (
              <>
                <select className="map-select" value={cas.city} onChange={(e) => setCas((c) => ({ ...c, city: e.target.value, area: '' }))}>
                  <option value="">Choose city</option>
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="map-select" value={cas.area} disabled={!cas.city || !areaData} onChange={(e) => setCas((c) => ({ ...c, area: e.target.value }))}>
                  <option value="">{cas.city && !areaData ? 'Loading…' : 'Choose area'}</option>
                  {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </>
            ) : null}
            {(cas.biz || cas.country) && <button className="btn" onClick={() => setCas({ biz: '', country: '', state: '', city: '', area: '' })}>✕ Clear</button>}
          </div>
          <div className="mapview-status">🗺 <span className="muted">{status}</span></div>
        </div>
        <div ref={mapEl} className="mapview-canvas" />
      </section>
    );
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗺 Map</div>
            <div className="modal-sub">{status}</div>
          </div>
          <div className="modal-actions">
            {scopePicker}
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={mapEl} className="map-canvas" />
      </div>
    </div>
  );
}
