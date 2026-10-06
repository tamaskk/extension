// Turns a sequence text with {{variables}} into the text for one lead. Pure.
//
// The texts are edited on screen, not in code, so a mistyped variable is not a
// build error but a silent one at send time: a {{nmae}} in a subject would send
// hundreds of people an email titled " website". That cannot be taken back, so
// rendering never guesses: whatever it could not fill in, it reports, and
// lib/outreachPreflight.mjs keeps such an email from going out.

const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
// Anything between double braces, also what VAR does not accept ("{{first name}}"):
// the editor lists these as mistakes instead of not seeing them at all.
// The name is trimmed in code, not by the pattern: with optional blanks on both
// sides of a lazy match, a long run of spaces after "{{" took minutes to scan.
const ANY_BRACES = /\{\{([^{}]*)\}\}/g;

// The variables a text may use, each a real field of a lead or a part of one.
// Nothing here is made up: a value that is not on the lead is not a variable.
export const VARIABLES = {
  name: 'Business name',
  category: 'Category, in the language Maps showed it in',
  rating: 'Rating',
  reviewCount: 'Number of reviews',
  website: 'Website',
  websiteStatus: 'Website status',
  address: 'Full address',
  street: 'Street and number, from the address',
  city: 'City, from the address',
  aiSummary: 'AI summary',
  aiPainPoints: 'AI pain points',
  aiPitch: 'AI pitch',
  opportunityScore: 'Opportunity score',
  topPitch: 'Top pitch',
};
// The lead fields the variables are read from; what a query has to select.
export const VARIABLE_FIELDS = ['name', 'category', 'rating', 'reviewCount', 'website', 'websiteStatus', 'address', 'aiSummary', 'aiPainPoints', 'aiPitch', 'opportunityScore', 'topPitch'];

export function isKnownVariable(name) {
  return Object.prototype.hasOwnProperty.call(VARIABLES, name);
}

const STREET_WORD = /(^|\s)(utca|u\.|út|útja|tér|tere|körút|krt\.?|köz|sétány|sor|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|highway|hwy\.?|plaza|court|ct\.?)(\s|$)/i;
const hasDigit = (s) => /\d/.test(s);

// Street and city out of a Maps address. Two shapes occur:
//   "123 Main St, Houston, TX 77002, USA"    street first, then the city
//   "Budapest, Váci út 1, 1132 Hungary"      city first, then the street
//   "1132 Budapest, Váci út 1"               the same with the postcode in front
// Either part is '' when it cannot be told: a text that needs it is then not
// sent to this lead, which is better than a wrong street in a first line.
export function parseAddress(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { street: '', city: '' };
  const [first, second = ''] = parts;
  // four to six digits and then a name with no street word in it: a postcode and a city
  const zipCity = STREET_WORD.test(first) ? null : first.match(/^\d{4,6}\s+(\D+)$/);
  if (zipCity) return { street: hasDigit(second) || STREET_WORD.test(second) ? second : '', city: zipCity[1].trim() };
  if (hasDigit(first) || STREET_WORD.test(first)) {
    // the part after the street is the city unless it is a postcode or a country line
    return { street: first, city: second && !hasDigit(second) ? second : '' };
  }
  return { street: hasDigit(second) || STREET_WORD.test(second) ? second : '', city: first };
}

// The values of the variables for one lead.
export function renderContext(lead) {
  const l = lead || {};
  const ctx = {};
  for (const f of VARIABLE_FIELDS) ctx[f] = typeof l[f] === 'string' ? l[f].trim() : l[f];
  const { street, city } = parseAddress(l.address);
  ctx.street = street;
  ctx.city = city;
  return ctx;
}

// → { out, missing }. `missing` names every variable that had no value, a
// mistyped name among them; each is left out of the text. With `mark` the gap
// stays visible as [name], for a preview.
export function render(tpl, ctx, mark = false) {
  const missing = [];
  const out = String(tpl || '').replace(VAR, (_, key) => {
    const v = ctx ? ctx[key] : undefined;
    if (v === undefined || v === null || v === '') {
      if (!missing.includes(key)) missing.push(key);
      return mark ? `[${key}]` : '';
    }
    return String(v);
  });
  return { out, missing };
}

// The names between double braces in a text, in order of first use.
export function variablesIn(text) {
  const names = [];
  for (const m of String(text || '').matchAll(ANY_BRACES)) { const name = m[1].trim(); if (!names.includes(name)) names.push(name); }
  return names;
}

// Every variable the steps of a sequence use: [{ name, known, stepIds }].
// Switched-off steps count too: they can be switched on again.
export function usedVariables(seq) {
  const out = new Map();
  for (const s of (seq && Array.isArray(seq.steps) ? seq.steps : [])) {
    if (!s) continue;
    for (const name of variablesIn(`${s.subject || ''}\n${s.body || ''}`)) {
      if (!out.has(name)) out.set(name, { name, known: isKnownVariable(name), stepIds: [] });
      out.get(name).stepIds.push(s.id);
    }
  }
  return [...out.values()];
}

// For each used variable, how many of these leads have no value for it:
// [{ name, known, stepIds, missing, of }]. An unknown name is missing for all.
export function missingCounts(seq, leads) {
  const contexts = (leads || []).map(renderContext);
  const empty = (v) => v === undefined || v === null || v === '';
  return usedVariables(seq).map((v) => ({
    ...v,
    missing: v.known ? contexts.filter((c) => empty(c[v.name])).length : contexts.length,
    of: contexts.length,
  }));
}
