// Coverage matrix: for every business type and every region (a US state, a
// country, a city), how many of the region's reference places a project already
// names. A project query is "<business type> near <place…> <region>"; a full run
// of one type over one region has a project for every reference place.
//
// The index is built for every type that occurs, so the screen can change its
// columns without another pass over the projects.
import { covNorm } from './coverage.mjs';
import { findRegionSuffix } from './regionLookup.mjs';

// The columns the screen starts with.
export const DEFAULT_COVERAGE_TYPES = [
  'massage', 'hairsalon', 'bar', 'barber', 'nailsalon', 'landscaping', 'spa', 'florist',
  'dental clinic', 'medical clinic', 'physiotherapist', 'financial planner', 'restaurants', 'private clinic',
];

// Batch prefixes are typed by hand: "hair salons", "hairsalon" and "Hair Salon"
// are one type. Spaces and a plural s do not tell two types apart.
export const typeKey = (type) => covNorm(type).replace(/ /g, '').replace(/s$/, '');

const regionMap = (rows) => {
  const regions = new Map();
  for (const r of rows) { const n = covNorm(r.region); if (n) regions.set(n, n); }
  return regions;
};

// "<type> near <place…> <region>" → its parts, normalised. `region` is '' when
// the query ends with no known region or names no place before it.
function parseQuery(query, regions) {
  const q = covNorm(query);
  if (!q) return null;
  const near = q.indexOf(' near ');
  const cut = near >= 0 ? near : q.indexOf(' ');
  if (cut <= 0) return null;
  const label = q.slice(0, cut);
  const key = typeKey(label);
  if (!key) return null;
  const rest = q.slice(near >= 0 ? near + 6 : cut + 1);
  const region = findRegionSuffix(rest, regions);
  if (!region || region.length === rest.length) return { label, key, region: '', place: '' };
  return { label, key, region, place: rest.slice(0, rest.length - region.length).trim() };
}

/**
 * @param {string[]} queries project queries
 * @param {{ region: string, names: string[] }[]} rows reference list of each region
 * @returns {{ types: { key: string, label: string, projects: number }[], present: Record<string, Record<number, number>> }}
 *   `present[typeKey][rowIndex]` is how many reference places of that row have a project; rows without any are left out.
 */
export function buildCoverageIndex(queries, rows) {
  const regions = regionMap(rows);
  const places = new Map();   // "<typeKey>|<region>" → Set of place names
  const spellings = new Map(); // typeKey → Map(spelling → projects)
  for (const query of queries) {
    const p = parseQuery(query, regions);
    if (!p) continue;
    const seen = spellings.get(p.key) || new Map();
    seen.set(p.label, (seen.get(p.label) || 0) + 1);
    spellings.set(p.key, seen);
    if (!p.region) continue;
    const id = `${p.key}|${p.region}`;
    const set = places.get(id) || new Set();
    set.add(p.place);
    places.set(id, set);
  }

  const rowsOfRegion = new Map(); // a state and a city can share a name ("Washington")
  rows.forEach((r, i) => { const n = covNorm(r.region); rowsOfRegion.set(n, [...(rowsOfRegion.get(n) || []), i]); });

  /** @type {Record<string, Record<number, number>>} */
  const present = {};
  for (const [id, set] of places) {
    const bar = id.indexOf('|');
    const key = id.slice(0, bar);
    for (const i of rowsOfRegion.get(id.slice(bar + 1)) || []) {
      let n = 0;
      for (const name of rows[i].names) if (set.has(covNorm(name))) n++;
      if (n) (present[key] ||= {})[i] = n;
    }
  }

  const types = [...spellings].map(([key, seen]) => {
    let label = ''; let best = 0; let projects = 0;
    for (const [s, n] of seen) { projects += n; if (n > best) { best = n; label = s; } }
    return { key, label, projects };
  }).sort((a, b) => b.projects - a.projects);

  return { types, present };
}

// Places still without a project, for one cell.
export function missingIn(present, type, rowIndex, total) {
  return Math.max(0, total - (present[typeKey(type)]?.[rowIndex] || 0));
}

/**
 * The reference places of every row that no project of this type names, in the
 * list's own order and spelling: what a batch still has to search.
 * @param {string[]} queries
 * @param {{ region: string, names: string[] }[]} rows
 * @param {string} type
 * @returns {string[][]} one list per row
 */
export function missingPlaces(queries, rows, type) {
  const regions = regionMap(rows);
  const wanted = typeKey(type);
  const done = new Map(); // region → Set of place names
  for (const query of queries) {
    const p = parseQuery(query, regions);
    if (!p || p.key !== wanted || !p.region) continue;
    const set = done.get(p.region) || new Set();
    set.add(p.place);
    done.set(p.region, set);
  }
  return rows.map((r) => {
    const set = done.get(covNorm(r.region));
    return set ? r.names.filter((n) => !set.has(covNorm(n))) : [...r.names];
  });
}
