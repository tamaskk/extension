'use client';

import { useEffect, useState } from 'react';
import { COUNTRY_CITIES, COUNTRY_NAMES } from '@/lib/countries';
import { STATE_REGIONS } from '@/lib/regionNames';

// loose, accent-insensitive normalize so "St. Louis" == "st louis", "Pécs" == "pecs"
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function detectCountry(folderName: string): string {
  const n = folderName.toLowerCase();
  let best = '';
  for (const c of COUNTRY_NAMES) if (n.includes(c.toLowerCase()) && c.length > best.length) best = c;
  return best || 'USA';
}

type Mode = 'country' | 'state' | 'usastates';
type Ref = { mode: Mode; name: string };

export default function FolderInfoModal({ name, cities, names, folderCount, projectCount, onClose }:
  { name: string; cities: string[]; names?: string[]; folderCount: number; projectCount: number; onClose: () => void }) {
  const LS_KEY = 'gridleads_folder_ref:' + name;
  const [ref, setRef] = useState<Ref>(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) { const p = JSON.parse(s); if (p && ['country', 'state', 'usastates'].includes(p.mode)) return p; } } catch { /* */ }
    return { mode: 'country', name: detectCountry(name) };
  });
  const [states, setStates] = useState<{ places: Record<string, [string, number][]>; names: string[] } | null>(null);

  // lazy-load the (large) US-states dataset only when single-State mode is used
  useEffect(() => {
    if (ref.mode !== 'state' || states) return;
    let cancelled = false;
    import('@/lib/states').then((m) => { if (!cancelled) setStates({ places: m.STATE_PLACES, names: m.STATE_NAMES }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ref.mode, states]);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ref)); } catch { /* */ } }, [LS_KEY, ref]);

  const loadingState = ref.mode === 'state' && !states;
  const statePlaces = ref.mode === 'state' ? (states?.places[ref.name] || []) : [];
  const refCities = ref.mode === 'country' ? (COUNTRY_CITIES[ref.name] || [])
    : ref.mode === 'usastates' ? STATE_REGIONS
    : statePlaces.map(([n]) => n);
  const unit = ref.mode === 'usastates' ? 'states' : ref.mode === 'state' ? 'places' : 'cities';
  const refLabel = ref.mode === 'usastates' ? 'USA' : ref.name;

  // a reference place is "present" if it appears as a whole, space-bounded token
  // sequence in any folder/project name — so "Abbeville city" matches the project
  // "plumbers near Abbeville city alamaba".
  const haystacks = [...new Set([...(names || []), ...cities])].map((s) => ' ' + norm(s) + ' ').filter((s) => s.trim());
  const isPresent = (place: string) => { const p = ' ' + norm(place) + ' '; return p.trim().length > 1 ? haystacks.some((h) => h.includes(p)) : false; };
  const missing = refCities.filter((c) => !isPresent(c));
  const covered = refCities.filter((c) => isPresent(c));
  const masterSet = new Set(refCities.map(norm));
  const extra = [...new Set(cities.filter((c) => c && !masterSet.has(norm(c))))].sort((a, b) => a.localeCompare(b));

  const pickMode = (mode: Mode) => {
    if (mode === ref.mode) return;
    if (mode === 'country') setRef({ mode, name: detectCountry(name) });
    else if (mode === 'usastates') setRef({ mode, name: 'USA' });
    else setRef({ mode, name: '' }); // single-state name set once the dataset loads
  };
  // once states load with no selection yet, default to a detected or first state
  useEffect(() => {
    if (ref.mode === 'state' && states && !states.places[ref.name]) {
      const det = states.names.find((s) => name.toLowerCase().includes(s.toLowerCase())) || states.names[0];
      setRef({ mode: 'state', name: det });
    }
  }, [states, ref.mode, ref.name, name]);

  // download the MISSING places as a batch-loadable JSON (state keeps population)
  const downloadMissing = () => {
    let content: string, filename: string;
    if (ref.mode === 'state') {
      const popOf = (nm: string) => { const pl = statePlaces.find(([n]) => n === nm); return pl ? pl[1] : 0; };
      const places = missing.map((nm) => ({ placeName: nm, population: String(popOf(nm)) }));
      content = JSON.stringify([{ state: ref.name, places }], null, 2);
      filename = `${ref.name}.json`;
    } else {
      content = JSON.stringify([{ city: ref.name, areas: missing }], null, 2);
      filename = `${ref.name}-missing.json`;
    }
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">ⓘ {name} — coverage</div>
            <div className="modal-sub">{loadingState ? 'Loading states…' : <>{covered.length} of {refCities.length} {refLabel} {unit} present · <b style={{ color: 'var(--hot)' }}>{missing.length} missing</b></>}</div>
          </div>
          <div className="modal-actions">
            <div className="fi-mode">
              <button className={`fi-mode-btn ${ref.mode === 'country' ? 'active' : ''}`} onClick={() => pickMode('country')}>Country</button>
              <button className={`fi-mode-btn ${ref.mode === 'state' ? 'active' : ''}`} onClick={() => pickMode('state')}>State</button>
              <button className={`fi-mode-btn ${ref.mode === 'usastates' ? 'active' : ''}`} onClick={() => pickMode('usastates')}>USA states</button>
            </div>
            {ref.mode === 'country' && (
              <select className="fi-country" value={ref.name} onChange={(e) => setRef({ mode: 'country', name: e.target.value })}>
                {COUNTRY_NAMES.map((c) => <option key={c} value={c}>{c} ({COUNTRY_CITIES[c].length})</option>)}
              </select>
            )}
            {ref.mode === 'state' && (
              <select className="fi-country" value={ref.name} disabled={!states} onChange={(e) => setRef({ mode: 'state', name: e.target.value })}>
                {!states ? <option>Loading…</option> : states.names.map((s) => <option key={s} value={s}>{s} ({states.places[s].length})</option>)}
              </select>
            )}
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
              <div className="fi-h fi-h-row">
                <span>❌ Missing ({missing.length})</span>
                {missing.length > 0 && ref.mode !== 'usastates' && <button className="btn fi-dl" onClick={downloadMissing} title="Download a batch-loadable JSON of the missing ones">⤓ Download JSON</button>}
              </div>
              {missing.length ? <div className="fi-chips">{missing.map((c) => <span key={c} className="chip red">{c}</span>)}</div>
                : <div className="muted">All {refLabel} {unit} are covered 🎉</div>}
            </div>
            <div className="fi-sec">
              <div className="fi-h">✅ Present ({covered.length})</div>
              {covered.length ? <div className="fi-chips">{covered.map((c) => <span key={c} className="chip green">{c}</span>)}</div>
                : <div className="muted">None of the {refLabel} reference {unit} found here.</div>}
            </div>
            {ref.mode !== 'usastates' && extra.length > 0 && (
              <div className="fi-sec">
                <div className="fi-h">➕ In this folder but not on the {refLabel} list ({extra.length})</div>
                <div className="fi-chips">{extra.map((c) => <span key={c} className="chip gray">{c}</span>)}</div>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}
