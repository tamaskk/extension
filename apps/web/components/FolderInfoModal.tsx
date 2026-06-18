'use client';

// Reference city lists per country. Folder/sub-folder names look like
// "<City> Restaurants" — we cut the last word to get the city, then report which
// of these are still missing. The right list is chosen from the folder name.
const US_CITIES = [
  'NewYork City', 'Los Angeles', 'Houston', 'Miami', 'Chichago', 'San Antonio', 'San Diego', 'Dallas',
  'Fort Worth', 'Jacksonville', 'Austin', 'San Jose', 'Charlotte', 'Columbus', 'Indianapolis', 'San Francisco',
  'Seattle', 'Denver', 'Nashville', 'Oklahoma City', 'Washington', 'El Paso', 'Las Vegas', 'Boston', 'Portland',
  'Memphis', 'Detroit', 'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson', 'Sacramento', 'Kansas City', 'Atlanta',
  'Colorado Springs', 'Omaha', 'Raleigh', 'Virginia Beach', 'Long Beach', 'Oakland', 'Minneapolis', 'Tulsa',
  'Bakersfield', 'Wichita', 'Arlington', 'New Orleans', 'Tampa', 'Orlando', 'Honolulu', 'Fort Lauderdale',
  'Flagstaff', 'Riverside', 'Naples', 'Salinas', 'Buffalo', 'Melbourne', 'Salt Lake City', 'St. Louis',
  'Savannah', 'Charleston', 'Key West', 'Sedona', 'Asheville', 'Branson', 'Gatlinburg', 'Monterey', 'Napa',
  'Sonoma', 'Santa Fe',
];
// from countries/hungary.json (the "city" of each entry)
const HU_CITIES = [
  'Budapest', 'Kecskemét', 'Pécs', 'Békéscsaba', 'Miskolc', 'Szeged', 'Székesfehérvár', 'Győr', 'Debrecen', 'Eger',
  'Szolnok', 'Tatabánya', 'Salgótarján', 'Kaposvár', 'Nyíregyháza', 'Szekszárd', 'Szombathely', 'Veszprém',
  'Zalaegerszeg', 'Érd', 'Sopron', 'Nagykanizsa', 'Dunaújváros', 'Hódmezővásárhely', 'Dunakeszi', 'Szigetszentmiklós',
  'Cegléd', 'Baja', 'Mosónmagyaróvár', 'Vác', 'Gödöllő', 'Esztergom', 'Gyöngyös', 'Kazinbarcika', 'Orosháza', 'Ajka',
  'Pápa', 'Kiskunfélegyháza', 'Hajdúböszörmény', 'Gyula', 'Keszthely', 'Balatonalmádi', 'Balatonboglár',
  'Balatonföldvár', 'Balatonfüred', 'Balatonkenese', 'Balatonlelle', 'Badacsonytomaj', 'Fonyód', 'Siófok', 'Zamárdi',
  'Hévíz', 'Tapolca', 'Sümeg', 'Zalakaros', 'Marcali',
];
function referenceCitiesFor(folderName: string): string[] {
  return /hungary|magyar|hungar/i.test(folderName) ? HU_CITIES : US_CITIES;
}

// loose, accent-insensitive normalize so "St. Louis" == "st louis", "Pécs" == "pecs"
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export default function FolderInfoModal({ name, cities, folderCount, projectCount, onClose }:
  { name: string; cities: string[]; folderCount: number; projectCount: number; onClose: () => void }) {
  const MASTER_CITIES = referenceCitiesFor(name);
  const present = new Set(cities.map(norm).filter(Boolean));
  const missing = MASTER_CITIES.filter((c) => !present.has(norm(c)));
  const covered = MASTER_CITIES.filter((c) => present.has(norm(c)));
  const masterSet = new Set(MASTER_CITIES.map(norm));
  // cities present in the folder that aren't on the reference list (typos / extras)
  const extra = [...new Set(cities.filter((c) => c && !masterSet.has(norm(c))))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">ⓘ {name} — city coverage</div>
            <div className="modal-sub">{covered.length} of {MASTER_CITIES.length} reference cities present · <b style={{ color: 'var(--hot)' }}>{missing.length} missing</b></div>
          </div>
          <div className="modal-actions"><button className="btn" onClick={onClose}>✕ Close</button></div>
        </div>
        <div className="modal-body">
          <div className="fi-stats">
            <div className="fi-stat"><div className="fi-num">{folderCount.toLocaleString()}</div><div className="fi-lbl">sub-folders inside</div></div>
            <div className="fi-stat"><div className="fi-num">{projectCount.toLocaleString()}</div><div className="fi-lbl">projects total</div></div>
          </div>
          <div className="fi-sec">
            <div className="fi-h">❌ Missing cities ({missing.length})</div>
            {missing.length ? <div className="fi-chips">{missing.map((c) => <span key={c} className="chip red">{c}</span>)}</div>
              : <div className="muted">All reference cities are covered 🎉</div>}
          </div>
          <div className="fi-sec">
            <div className="fi-h">✅ Present ({covered.length})</div>
            {covered.length ? <div className="fi-chips">{covered.map((c) => <span key={c} className="chip green">{c}</span>)}</div>
              : <div className="muted">None of the reference cities found here.</div>}
          </div>
          {extra.length > 0 && (
            <div className="fi-sec">
              <div className="fi-h">➕ In this folder but not on the reference list ({extra.length})</div>
              <div className="fi-chips">{extra.map((c) => <span key={c} className="chip gray">{c}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
