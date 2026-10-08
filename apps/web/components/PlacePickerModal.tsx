'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLeaflet } from '@/lib/leafletLoader';
import { COUNTRY_CITIES } from '@/lib/countries';
import { COUNTRY_CENTERS, STATE_CENTERS, clockIn, zoneOfPlace } from '@/lib/pickerPlaces.mjs';
import { isInsideWindow } from '@/lib/sendWindow.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pick where the next leads come from, on a map: a country, a US state, or a
// city of a country. Every label carries the time it is there right now, and is
// green while it is a sending hour there (Monday to Friday, 7 to 19 by default),
// because that decides whether an email put in now goes out today.

const STATES_FROM_ZOOM = 4; // below this the states would sit on top of each other: the country has one label
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const centers = COUNTRY_CENTERS;
const stateCenters = STATE_CENTERS;
// open = a sending hour there now, by the default window; a sender's own window can differ
const openNow = (zone: string, now: Date) => !!zone && (isInsideWindow({ seq: { tz: zone } }, undefined, now) as boolean);

interface Props {
  countries: string[];              // the countries the sequence's language is written to
  country: string; region: string;  // what is picked now
  onPick: (country: string, region: string) => void;
  onClose: () => void;
}

export default function PlacePickerModal({ countries, country, region, onPick, onClose }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(3);
  const [now, setNow] = useState(() => new Date());
  const [sel, setSel] = useState({ country, region });
  const selRef = useRef(sel);
  selRef.current = sel;

  // the clocks move: once every 20 seconds is enough for a minute hand
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(() => {
      if (cancelled || !mapEl.current) return;
      const L = (window as any).L;
      const start = centers[country] || centers.USA;
      const map = L.map(mapEl.current, { worldCopyJump: true }).setView(start, country === 'USA' ? 4 : 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 10 }).addTo(map);
      map.on('zoomend', () => setZoom(map.getZoom()));
      mapRef.current = map;
      setZoom(map.getZoom());
      setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // the map is made once; what is picked is drawn by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the labels, drawn again when the zoom passes the states' threshold, the minute turns or the pick changes
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const L = (window as any).L;
    if (layerRef.current) mapRef.current.removeLayer(layerRef.current);
    const group = L.layerGroup();
    const label = (name: string, at: [number, number], zone: string, onClick: (() => void) | null, picked: boolean, extra = '') => {
      const cls = `cpick-label${!onClick ? ' off' : openNow(zone, now) ? ' open' : ''}${picked ? ' picked' : ''}`;
      const m = L.marker(at, { icon: L.divIcon({ className: '', html: `<div class="${cls}"><b>${esc(name)}</b><span>${esc(extra || clockIn(zone, now))}</span></div>`, iconSize: [0, 0] }), keyboard: !!onClick, title: name });
      if (onClick) m.on('click', onClick);
      group.addLayer(m);
    };
    const showStates = zoom >= STATES_FROM_ZOOM && countries.includes('USA');
    for (const [name, at] of Object.entries(centers)) {
      if (name === 'USA' && showStates) continue;
      const allowed = countries.includes(name);
      label(name, at, zoneOfPlace(name), allowed ? () => setSel({ country: name, region: '' }) : null, selRef.current.country === name && !selRef.current.region,
        name === 'USA' ? 'zoom in for states' : !allowed ? 'other language' : '');
    }
    if (showStates) for (const [name, at] of Object.entries(stateCenters)) label(name, at, zoneOfPlace('USA', name), () => setSel({ country: 'USA', region: name }), selRef.current.country === 'USA' && selRef.current.region === name);
    group.addTo(mapRef.current);
    layerRef.current = group;
  }, [ready, zoom, now, sel, countries]);

  const cities = useMemo(() => (sel.country && sel.country !== 'USA' ? COUNTRY_CITIES[sel.country] || [] : []), [sel.country]);
  // a city keeps its country's clock; a state its own
  const zone = sel.country === 'USA' && sel.region ? zoneOfPlace('USA', sel.region) : zoneOfPlace(sel.country);
  const wholeUsa = sel.country === 'USA' && !sel.region;
  const name = [sel.region, sel.country].filter(Boolean).join(', ');

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label="Pick a place">
        <div className="modal-head">
          <div>
            <div className="modal-title">
              📍 {name || 'Pick a place'}
              {name && !wholeUsa && <> · <span className="cpick-time">{clockIn(zone, now) || 'time unknown'}</span> <span className={`chip ${openNow(zone, now) ? 'green' : 'gray'}`}>{openNow(zone, now) ? 'sending hours now' : 'outside sending hours'}</span></>}
              {wholeUsa && <> · <span className="muted">four clocks, from {clockIn('America/New_York', now)} in the east to {clockIn('America/Los_Angeles', now)} in the west</span></>}
            </div>
            <div className="modal-sub">Click a country or a state. Green = a sending hour there right now (Monday to Friday, 7 to 19), so an email put in now can go out today.</div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" disabled={!sel.country} onClick={() => { onPick(sel.country, sel.region); onClose(); }}>Use {name || 'this'}</button>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        {failed && <div className="empty">The map could not be loaded. Use the lists on the page instead.</div>}
        <div ref={mapEl} className="map-canvas cpick-map" />
        {cities.length > 0 && (
          <div className="cpick-cities">
            <span className="muted">Cities of {sel.country}:</span>
            <button className={`chipbtn ${!sel.region ? 'active' : ''}`} onClick={() => setSel({ country: sel.country, region: '' })}>The whole country</button>
            {cities.map((c) => <button key={c} className={`chipbtn ${sel.region === c ? 'active' : ''}`} onClick={() => setSel({ country: sel.country, region: c })}>{c}</button>)}
          </div>
        )}
        {sel.country === 'USA' && sel.region && (
          <div className="cpick-cities">
            <span className="muted">{sel.region} is picked.</span>
            <button className="chipbtn" onClick={() => setSel({ country: 'USA', region: '' })}>The whole USA instead</button>
          </div>
        )}
      </div>
    </div>
  );
}
