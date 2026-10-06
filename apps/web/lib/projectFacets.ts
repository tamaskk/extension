// Business type and region of a project, read from its search query:
// "<business type> near <city...> <state/country>".

// region names that are more than one word (so the suffix is detected correctly)
const MULTI = ['New York', 'New Jersey', 'New Mexico', 'New Hampshire', 'North Carolina', 'North Dakota', 'South Carolina', 'South Dakota', 'Rhode Island', 'West Virginia', 'District of Columbia', 'Hong Kong', 'Costa Rica', 'Puerto Rico', 'New Orleans'];
const MULTI_LC = MULTI.map((m) => m.toLowerCase());

export function parseProject(q: string): { type: string; region: string } | null {
  const s = String(q || '').trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  let type: string;
  const ni = lc.indexOf(' near ');
  if (ni >= 0) type = s.slice(0, ni + 5); // "<type...> near"
  else type = s.split(/\s+/).slice(0, 2).join(' ');
  let region = '';
  for (let i = 0; i < MULTI_LC.length; i++) { if (lc === MULTI_LC[i] || lc.endsWith(' ' + MULTI_LC[i])) { region = MULTI[i]; break; } }
  if (!region) { const w = s.split(/\s+/); region = w[w.length - 1]; }
  return { type: type.trim(), region: region.trim() };
}
