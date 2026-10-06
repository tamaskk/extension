// Find the known region a project query ends with ("… Austin city Texas" →
// "Texas"). There are hundreds of region names and hundreds of thousands of
// queries; testing every name against every query took seconds on the main
// thread. A query has only a handful of word-boundary suffixes, so look those
// up in a map instead.

// lower-case name → original spelling. Longest names first, and the first
// spelling of a name is kept, to match what the old longest-first scan returned.
export function buildRegionMap(names) {
  const map = new Map();
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const k = n.toLowerCase();
    if (!map.has(k)) map.set(k, n);
  }
  return map;
}

// `lc` is the lower-cased query. The whole query is tried first, then every
// suffix that starts after a space, left to right — so the longest region wins
// ("new york" before "york"). Returns '' when the query ends with no known region.
export function findRegionSuffix(lc, map) {
  const whole = map.get(lc);
  if (whole) return whole;
  for (let i = lc.indexOf(' '); i >= 0; i = lc.indexOf(' ', i + 1)) {
    const hit = map.get(lc.slice(i + 1));
    if (hit) return hit;
  }
  return '';
}
