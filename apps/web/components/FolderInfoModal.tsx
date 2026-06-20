'use client';

import { useEffect, useState } from 'react';
import { COUNTRY_CITIES, COUNTRY_NAMES } from '@/lib/countries';

// loose, accent-insensitive normalize so "St. Louis" == "st louis", "Pécs" == "pecs"
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function detectCountry(folderName: string): string {
  const n = folderName.toLowerCase();
  let best = '';
  for (const c of COUNTRY_NAMES) if (n.includes(c.toLowerCase()) && c.length > best.length) best = c;
  return best || 'USA';
}

type Ref = { mode: 'country' | 'state'; name: string };

export default function FolderInfoModal({ name, cities, folderCount, projectCount, onClose }:
  { name: string; cities: string[]; folderCount: number; projectCount: number; onClose: () => void }) {
  const LS_KEY = 'gridleads_folder_ref:' + name;
  const [ref, setRef] = useState<Ref>(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) { const p = JSON.parse(s); if (p && (p.mode === 'country' || p.mode === 'state') && p.name) return p; } } catch { /* */ }
    return { mode: 'country', name: detectCountry(name) };
  });
  const [states, setStates] = useState<{ cities: Record<string, string[]>; names: string[] } | null>(null);

  // lazy-load the (large) US-states dataset only when State mode is used
  useEffect(() => {
    if (ref.mode !== 'state' || states) return;
    let cancelled = false;
    import('@/lib/states').then((m) => { if (!cancelled) setStates({ cities: m.STATE_CITIES, names: m.STATE_NAMES }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ref.mode, states]);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ref)); } catch { /* */ } }, [LS_KEY, ref]);

  const loadingState = ref.mode === 'state' && !states;
  const refCities = ref.mode === 'country' ? (COUNTRY_CITIES[ref.name] || []) : (states?.cities[ref.name] || []);
  const present = new Set(cities.map(norm).filter(Boolean));
  const missing = refCities.filter((c) => !present.has(norm(c)));
  const covered = refCities.filter((c) => present.has(norm(c)));
  const masterSet = new Set(refCities.map(norm));
  const extra = [...new Set(cities.filter((c) => c && !masterSet.has(norm(c))))].sort((a, b) => a.localeCompare(b));

  const pickMode = (mode: 'country' | 'state') => {
    if (mode === ref.mode) return;
    if (mode === 'country') setRef({ mode, name: detectCountry(name) });
    else setRef({ mode, name: '' }); // state name set once the dataset loads
  };
  // once states load with no selection yet, default to a detected or first state
  useEffect(() => {
    if (ref.mode === 'state' && states && !states.cities[ref.name]) {
      const det = states.names.find((s) => name.toLowerCase().includes(s.toLowerCase())) || states.names[0];
      setRef({ mode: 'state', name: det });
    }
  }, [states, ref.mode, ref.name, name]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">ⓘ {name} — coverage</div>
            <div className="modal-sub">{loadingState ? 'Loading states…' : <>{covered.length} of {refCities.length} {ref.name} {ref.mode === 'state' ? 'places' : 'cities'} present · <b style={{ color: 'var(--hot)' }}>{missing.length} missing</b></>}</div>
          </div>
          <div className="modal-actions">
            <div className="fi-mode">
              <button className={`fi-mode-btn ${ref.mode === 'country' ? 'active' : ''}`} onClick={() => pickMode('country')}>Country</button>
              <button className={`fi-mode-btn ${ref.mode === 'state' ? 'active' : ''}`} onClick={() => pickMode('state')}>State</button>
            </div>
            {ref.mode === 'country'
              ? <select className="fi-country" value={ref.name} onChange={(e) => setRef({ mode: 'country', name: e.target.value })}>
                  {COUNTRY_NAMES.map((c) => <option key={c} value={c}>{c} ({COUNTRY_CITIES[c].length})</option>)}
                </select>
              : <select className="fi-country" value={ref.name} disabled={!states} onChange={(e) => setRef({ mode: 'state', name: e.target.value })}>
                  {!states ? <option>Loading…</option> : states.names.map((s) => <option key={s} value={s}>{s} ({states.cities[s].length})</option>)}
                </select>}
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body">
          <div className="fi-stats">
            <div className="fi-stat"><div className="fi-num">{folderCount.toLocaleString()}</div><div className="fi-lbl">sub-folders inside</div></div>
            <div className="fi-stat"><div className="fi-num">{projectCount.toLocaleString()}</div><div className="fi-lbl">projects total</div></div>
          </div>
          {!loadingState && <>
            <div className="fi-sec">
              <div className="fi-h">❌ Missing ({missing.length})</div>
              {missing.length ? <div className="fi-chips">{missing.map((c) => <span key={c} className="chip red">{c}</span>)}</div>
                : <div className="muted">All {ref.name} places are covered 🎉</div>}
            </div>
            <div className="fi-sec">
              <div className="fi-h">✅ Present ({covered.length})</div>
              {covered.length ? <div className="fi-chips">{covered.map((c) => <span key={c} className="chip green">{c}</span>)}</div>
                : <div className="muted">None of the {ref.name} reference places found here.</div>}
            </div>
            {extra.length > 0 && (
              <div className="fi-sec">
                <div className="fi-h">➕ In this folder but not on the {ref.name} list ({extra.length})</div>
                <div className="fi-chips">{extra.map((c) => <span key={c} className="chip gray">{c}</span>)}</div>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}
