// Pure, dependency-free logic for auto-organizing projects into folders.
//
// Every project query looks like:  "<businessType> near <place…> <region>"
// From it we derive two folder names:
//   sub-folder = "<region> <vertical>"   e.g. "Texas Plumbers", "Austin Restaurants"
//   root       = "<country> <vertical>"  e.g. "USA Plumbers", "Hungary Restaurants"
//
// The region/country knowledge is INJECTED via a region index (buildRegionIndex)
// so these functions stay pure and unit-testable with small fixtures. The API
// route builds the real index from lib/countries + lib/regionNames.

/** Known "<type> near" prefixes → canonical vertical noun used in folder names. */
export const VERTICAL_MAP = {
  'plumbers near': 'Plumbers',
  'electricians near': 'Electricians',
  'dentists near': 'Dentists',
  'restaurants near': 'Restaurants',
  'restuarants near': 'Restaurants', // common misspelling seen in real data
  'hvac near': 'HVAC',
  'hvac contractors near': 'HVAC',
};

/** Lower-case, strip accents, collapse to single-spaced [a-z0-9]. */
export function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Title-case a space-separated string: "dog groomers" → "Dog Groomers". */
function titleCase(s) {
  return s.split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Map a "<type> near" prefix to its canonical vertical noun (or '' if empty). */
export function verticalFromPrefix(prefix) {
  const key = norm(prefix); // e.g. "plumbers near"
  if (VERTICAL_MAP[key]) return VERTICAL_MAP[key];
  const body = key.replace(/\bnear\b\s*$/, '').trim();
  return body ? titleCase(body) : '';
}

/** Split "<prefix> near <rest>" → { prefix:"… near", rest:"…" } or null. */
export function splitQuery(query) {
  const q = String(query == null ? '' : query).trim();
  const i = q.toLowerCase().indexOf(' near ');
  if (i < 0) return null;
  const rest = q.slice(i + 6).trim();
  if (!rest) return null;
  return { prefix: q.slice(0, i + 5), rest };
}

/**
 * Build a region index from [{ name, country }] entries.
 * Returns a Map keyed by normalized name → { name, country }.
 * Earlier entries win when two names normalize the same (pass US states first
 * so a state beats a same-named foreign city).
 */
export function buildRegionIndex(entries) {
  const byNorm = new Map();
  for (const e of entries) {
    const n = norm(e.name);
    if (n && !byNorm.has(n)) byNorm.set(n, { name: e.name, country: e.country });
  }
  return byNorm;
}

/**
 * Find the longest known region that `rest` ends with (up to 4 words).
 * Longest-suffix-first so multi-word regions ("New York", "Salt Lake City")
 * win over their trailing single word, while a place that merely *contains* a
 * region word ("Washington city Indiana") still resolves to the true suffix.
 * Returns { region, country } or null.
 */
export function regionFromRest(rest, byNorm) {
  const words = norm(rest).split(' ').filter(Boolean);
  if (!words.length) return null;
  const maxW = Math.min(4, words.length);
  for (let w = maxW; w >= 1; w--) {
    const hit = byNorm.get(words.slice(words.length - w).join(' '));
    if (hit) return { region: hit.name, country: hit.country };
  }
  return null;
}

/**
 * Compute the target folders for a project query.
 * Returns { vertical, region, country, subName, rootName } or null when the
 * query can't be parsed (junk queries, unknown region, …).
 */
export function planFor(query, byNorm) {
  const sp = splitQuery(query);
  if (!sp) return null;
  const vertical = verticalFromPrefix(sp.prefix);
  if (!vertical) return null;
  const r = regionFromRest(sp.rest, byNorm);
  if (!r) return null;
  return {
    vertical,
    region: r.region,
    country: r.country,
    subName: `${r.region} ${vertical}`,
    rootName: `${r.country} ${vertical}`,
  };
}
