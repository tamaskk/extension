'use client';

import { useEffect, useState } from 'react';
import { COUNTRY_CITIES, COUNTRY_NAMES } from '@/lib/countries';

// loose, accent-insensitive normalize so "St. Louis" == "st louis", "Pécs" == "pecs"
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// guess the country from the folder name (e.g. "Hungary Restaurants" → Hungary)
function detectCountry(folderName: string): string {
  const n = folderName.toLowerCase();
  let best = '';
  for (const c of COUNTRY_NAMES) if (n.includes(c.toLowerCase()) && c.length > best.length) best = c;
  return best || 'USA';
}

export default function FolderInfoModal({ name, cities, folderCount, projectCount, onClose }:
  { name: string; cities: string[]; folderCount: number; projectCount: number; onClose: () => void }) {
  const LS_KEY = 'gridleads_folder_country:' + name;
  const [country, setCountry] = useState<string>(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s && COUNTRY_CITIES[s]) return s; } catch { /* */ }
    return detectCountry(name);
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, country); } catch { /* */ } }, [LS_KEY, country]);

  const refCities = COUNTRY_CITIES[country] || [];
  const present = new Set(cities.map(norm).filter(Boolean));
  const missing = refCities.filter((c) => !present.has(norm(c)));
  const covered = refCities.filter((c) => present.has(norm(c)));
  const masterSet = new Set(refCities.map(norm));
  const extra = [...new Set(cities.filter((c) => c && !masterSet.has(norm(c))))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">ⓘ {name} — city coverage</div>
            <div className="modal-sub">{covered.length} of {refCities.length} {country} cities present · <b style={{ color: 'var(--hot)' }}>{missing.length} missing</b></div>
          </div>
          <div className="modal-actions">
            <select className="fi-country" value={country} onChange={(e) => setCountry(e.target.value)} title="Which country is this folder for?">
              {COUNTRY_NAMES.map((c) => <option key={c} value={c}>{c} ({COUNTRY_CITIES[c].length})</option>)}
            </select>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body">
          <div className="fi-stats">
            <div className="fi-stat"><div className="fi-num">{folderCount.toLocaleString()}</div><div className="fi-lbl">sub-folders inside</div></div>
            <div className="fi-stat"><div className="fi-num">{projectCount.toLocaleString()}</div><div className="fi-lbl">projects total</div></div>
          </div>
          <div className="fi-sec">
            <div className="fi-h">❌ Missing cities ({missing.length})</div>
            {missing.length ? <div className="fi-chips">{missing.map((c) => <span key={c} className="chip red">{c}</span>)}</div>
              : <div className="muted">All {country} cities are covered 🎉</div>}
          </div>
          <div className="fi-sec">
            <div className="fi-h">✅ Present ({covered.length})</div>
            {covered.length ? <div className="fi-chips">{covered.map((c) => <span key={c} className="chip green">{c}</span>)}</div>
              : <div className="muted">None of the {country} reference cities found here.</div>}
          </div>
          {extra.length > 0 && (
            <div className="fi-sec">
              <div className="fi-h">➕ In this folder but not on the {country} list ({extra.length})</div>
              <div className="fi-chips">{extra.map((c) => <span key={c} className="chip gray">{c}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
