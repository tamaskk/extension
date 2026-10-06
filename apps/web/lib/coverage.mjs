// Folder coverage: how many of the places a folder should cover are missing.
// A folder is named "<region> <business type>"; its reference list is the
// places of that US state or the areas of that city.
//
// Shared by the sidebar (the cheap estimate) and by the server, which computes
// the accurate number for every folder — the browser no longer has all project
// names to do it.

export const covNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// `statePlaces` (state → [[place, population]]) and `areasByFile` (file → city →
// areas) are only needed for accurateMissing; the name helpers work without them.
export function makeCoverage({ stateRegions, countryNames, statePlaces = {}, areasByFile = {} }) {
  const stateSet = new Set(stateRegions.map(covNorm));
  // States sorted longest-first so "West Virginia" wins over "Virginia".
  const statesDesc = [...stateRegions].map(covNorm).sort((a, b) => b.length - a.length);
  const countriesDesc = [...countryNames].sort((a, b) => b.length - a.length);

  // The US state a folder name STARTS WITH ("Alabama Physical Therapy" →
  // "alabama"). Dropping only the last word broke on any 2+ word business type.
  const covStateOf = (name) => {
    const n = covNorm(name);
    for (const sk of statesDesc) if (n === sk || n.startsWith(sk + ' ')) return sk;
    return null;
  };
  const covRegionOf = (name) => { const w = String(name || '').trim().split(/\s+/); return w.length > 1 ? w.slice(0, -1).join(' ') : (name || ''); };
  const covCountryPrefix = (name) => { const n = covNorm(name); return countriesDesc.find((c) => n.startsWith(covNorm(c) + ' ')); };

  const placesByNorm = {};
  for (const [st, arr] of Object.entries(statePlaces)) placesByNorm[covNorm(st)] = arr.map((x) => x[0]);
  const areasByNorm = {};
  for (const file of Object.values(areasByFile)) for (const [city, arr] of Object.entries(file)) if (!areasByNorm[covNorm(city)]) areasByNorm[covNorm(city)] = arr;

  // Accurate "missing" for a state/city folder — the same token-in-haystack
  // match the coverage modal uses. `parts` are the names and queries of every
  // project under the folder, plus the region of each sub-folder name.
  // undefined: a country root, or a region with no reference list.
  const accurateMissing = (folderName, parts) => {
    if (covCountryPrefix(folderName)) return undefined;
    const reg = covStateOf(folderName) || covNorm(covRegionOf(folderName));
    const refNames = (stateSet.has(reg) && placesByNorm[reg]) ? placesByNorm[reg] : areasByNorm[reg];
    if (!refNames) return undefined;
    let blob = '';
    for (const p of parts) if (p) blob += ' ' + covNorm(p) + ' ';
    let present = 0;
    for (const nm of refNames) { const tok = ' ' + covNorm(nm) + ' '; if (tok.length > 2 && blob.includes(tok)) present++; }
    return Math.max(0, refNames.length - present);
  };

  return { stateSet, covStateOf, covRegionOf, covCountryPrefix, accurateMissing };
}
