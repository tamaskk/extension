'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NO_SITE } from '@/lib/types';
import { useGrid } from '@/lib/store';
import { COUNTRY_NAMES, COUNTRY_CITIES } from '@/lib/countries';
import { gridItems, itemAt, mercatorX, mercatorY } from '@/lib/mapGrid.mjs';
import { loadLeaflet } from '@/lib/leafletLoader';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { L: any } }

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

// The leads of the map as one canvas layer. Leaflet markers were one object and
// one cluster entry per lead; here the points live in typed arrays and each
// view is drawn from them in a single pass (lib/mapGrid.mjs).
const DOT_R = 5;
const RED = '#f43f5e'; const GREEN = '#22c55e'; const ACCENT = '#6366f1';
type GridItem = { x: number; y: number; count: number; noSite: number; index: number };
const radiusOf = (it: { count: number }) => (it.count === 1 ? DOT_R : it.count < 100 ? 13 : it.count < 1000 ? 16 : it.count < 10000 ? 19 : 22);
const short = (n: number) => (n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k');

function makePointLayer(L: any, points: [number, number, number, string][], onPick: (key: string, latlng: [number, number]) => void) {
  const n = points.length;
  const xs = new Float64Array(n); const ys = new Float64Array(n); const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) { xs[i] = mercatorX(points[i][1]); ys[i] = mercatorY(points[i][0]); flags[i] = points[i][2] ? 1 : 0; }
  let items: GridItem[] = [];
  let frame = 0;

  const Layer = L.Layer.extend({
    onAdd(map: any) {
      this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
      this._canvas.style.pointerEvents = 'none';
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('move', this._schedule, this);
      map.on('moveend zoomend resize', this._draw, this);
      map.on('click', this._click, this);
      map.on('mousemove', this._hover, this);
      this._draw();
    },
    onRemove(map: any) {
      cancelAnimationFrame(frame);
      map.off('move', this._schedule, this);
      map.off('moveend zoomend resize', this._draw, this);
      map.off('click', this._click, this);
      map.off('mousemove', this._hover, this);
      map.getContainer().style.cursor = '';
      L.DomUtil.remove(this._canvas);
    },
    // while the map is dragged, at most one redraw per frame
    _schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => this._draw()); },
    _draw() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize();
      const origin = map.getPixelBounds().min;
      const zoom = map.getZoom();
      items = gridItems({ xs, ys, flags, scale: 256 * Math.pow(2, zoom), originX: origin.x, originY: origin.y, width: size.x, height: size.y, forceSingle: zoom >= map.getMaxZoom() - 1 }) as GridItem[];
      const dpr = window.devicePixelRatio || 1;
      const c: HTMLCanvasElement = this._canvas;
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      c.width = size.x * dpr; c.height = size.y * dpr;
      c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 11px system-ui, sans-serif';
      for (const it of items) {
        const r = radiusOf(it);
        ctx.beginPath();
        ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
        if (it.count === 1) {
          ctx.globalAlpha = 0.75; ctx.fillStyle = it.noSite ? RED : GREEN; ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.88; ctx.fillStyle = ACCENT; ctx.fill();
          ctx.globalAlpha = 1; ctx.lineWidth = 3;
          // the ring shows the share of leads without a website
          ctx.strokeStyle = GREEN; ctx.stroke();
          if (it.noSite) { ctx.beginPath(); ctx.arc(it.x, it.y, r, -Math.PI / 2, -Math.PI / 2 + (it.noSite / it.count) * Math.PI * 2); ctx.strokeStyle = RED; ctx.stroke(); }
          ctx.fillStyle = '#fff'; ctx.fillText(short(it.count), it.x, it.y);
        }
      }
    },
    _click(e: any) {
      const it = itemAt(items, e.containerPoint.x, e.containerPoint.y, radiusOf) as GridItem | null;
      if (!it) return;
      if (it.index >= 0) onPick(points[it.index][3], [points[it.index][0], points[it.index][1]]);
      else this._map.setZoomAround(e.containerPoint, Math.min(this._map.getMaxZoom(), this._map.getZoom() + 2));
    },
    _hover(e: any) {
      this._map.getContainer().style.cursor = itemAt(items, e.containerPoint.x, e.containerPoint.y, radiusOf) ? 'pointer' : '';
    },
  });
  return new Layer();
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
    if (!inline) return { project: scope.type === 'project' ? scope.id : null, folder: scope.type === 'folder' ? scope.id : null, ptypes: ptypes || [], pregions: pregions || [], search: search || '', country: '', none: false };
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
    // a business type with only a country picked: narrow to that country (it
    // used to plot the type worldwide)
    const country = pt.length && !pr.length && !sr && !project ? cas.country : '';
    return { project, folder, ptypes: pt, pregions: pr, search: sr, country, none };
  })();
  const effKey = JSON.stringify(eff);

  // init the map once (after Leaflet loads)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadLeaflet();
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
      const geo = await api.getGeo({ ...q, filter, search: eff.search, categories, ptypes: eff.ptypes, pregions: eff.pregions, country: eff.country }).catch(() => ({ points: [], total: 0, capped: false }));
      if (cancelled || !mapInstance.current) return;
      if (clusterRef.current) { mapInstance.current.removeLayer(clusterRef.current); clusterRef.current = null; }
      let south = 90; let north = -90; let west = 180; let east = -180;
      for (const [lat, lng] of geo.points) {
        if (lat < south) south = lat; if (lat > north) north = lat;
        if (lng < west) west = lng; if (lng > east) east = lng;
      }
      const bounds: [number, number][] = geo.points.length ? [[south, west], [north, east]] : [];
      const cluster = makePointLayer(L, geo.points as [number, number, number, string][], async (key, latlng) => {
        if (!mapInstance.current) return;
        // the popup is built on click from the key, not for every point up front
        const popup = L.popup({ minWidth: 210 }).setLatLng(latlng).setContent('<div class="mp">Loading…</div>').openOn(mapInstance.current);
        const res = await api.getLeadByKey(key).catch(() => null);
        const lead = res && res.rows && res.rows[0];
        popup.setContent(lead ? popupHtml(lead) : '<div class="mp">Could not load details.</div>');
      });
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
      setStatus(`${geo.points.length.toLocaleString()} plotted${geo.capped ? ' (the first ones; narrow the filter to see the rest)' : ''}${cityNote} · 🔴 no website · 🟢 has site`);
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
      {/* only the project in scope: one <option> per project was 240k DOM nodes; pick a project in the sidebar */}
      {scope.type === 'project' && (
        <optgroup label="Project">
          <option value={`p:${scope.id}`}>{summaries[scope.id]?.name || scope.id}</option>
        </optgroup>
      )}
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
