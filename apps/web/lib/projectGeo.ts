// Business type + geography of a project, derived from its search query.
// A project query is "<business type> near <place…> <region>", where <region>
// is whatever the batch used as its suffix: a US state ("… Austin city Texas"),
// a country ("… Graz Austria") or a city ("… Aquincum Budapest").
import { COUNTRY_CITIES } from '@/lib/countries';
import { COUNTRY_REGIONS, STATE_REGIONS } from '@/lib/regionNames';
import { buildRegionMap, findRegionSuffix } from '@/lib/regionLookup.mjs';

// region (lower-case) → country
const REGION_COUNTRY = new Map<string, string>();
for (const c of COUNTRY_REGIONS) REGION_COUNTRY.set(c.toLowerCase(), c);
for (const [country, cities] of Object.entries(COUNTRY_CITIES)) for (const city of cities) if (!REGION_COUNTRY.has(city.toLowerCase())) REGION_COUNTRY.set(city.toLowerCase(), country);
for (const s of STATE_REGIONS) REGION_COUNTRY.set(s.toLowerCase(), 'USA'); // a state name wins over a same-named city

// known regions by lower-case name; the lookup tries the longest suffix first,
// so "New York" is matched before "York"
const KNOWN: Map<string, string> = buildRegionMap([...COUNTRY_REGIONS, ...STATE_REGIONS, ...Object.values(COUNTRY_CITIES).flat()]);

export const OTHER_COUNTRY = 'Other';

// → { type: "plumbers", region: "Texas", country: "USA" }
export function parseProjectGeo(query: string): { type: string; region: string; country: string } | null {
  const s = String(query || '').trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  const ni = lc.indexOf(' near ');
  const type = (ni >= 0 ? s.slice(0, ni) : s.split(/\s+/).slice(0, 1).join(' ')).trim().toLowerCase();
  let region: string = findRegionSuffix(lc, KNOWN);
  if (!region) { const w = s.split(/\s+/); region = w[w.length - 1]; }
  return { type, region, country: REGION_COUNTRY.get(region.toLowerCase()) || OTHER_COUNTRY };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// query starts with this business type
export function typeRegex(type: string) { return new RegExp('^' + esc(type.trim()) + '(\\s|$)', 'i'); }
// query ends with this region
export function regionRegex(region: string) { return new RegExp('(^|\\s)' + esc(region.trim()) + '$', 'i'); }
// query ends with the country's name, one of its cities, or (USA) a state
export function countryRegex(country: string) {
  const names = [...REGION_COUNTRY.entries()].filter(([, c]) => c === country).map(([r]) => r);
  if (!names.length) return null;
  return new RegExp('(^|\\s)(' + names.sort((a, b) => b.length - a.length).map(esc).join('|') + ')$', 'i');
}
