// Which scraped leads go on to Melodia, and in what shape. Pure: the sync route
// (app/api/sync/route.ts) hands in the leads, lib/melodia.ts sends the answer.
//
// Melodia writes to IT companies, so only the leads of an IT search go there,
// and only the ones with a website of their own: its rules ask for real
// companies with their official site. A lead goes once its email lookup is
// done, so the address travels with it: Melodia skips a company it already
// has, and an address sent later would never reach it.
import { bestEmail, emailQuality, isPlatformHost } from './emailQuality.mjs';

// The batch prefixes (lib/bizTypes.ts, without "near") that count as IT companies.
export const IT_TYPES = ['software companies', 'it companies', 'app developers', 'it consultants', 'it services'];
// Melodia takes at most this many companies per request.
export const MELODIA_BATCH = 200;

// A project's country (lib/projectGeo.ts) → its two-letter code; INT for the rest.
const ISO = { Austria: 'AT', Belgium: 'BE', Canada: 'CA', France: 'FR', Greece: 'GR', 'Hong Kong': 'HK', Hungary: 'HU', Italy: 'IT', Netherlands: 'NL', Portugal: 'PT', Spain: 'ES', Switzerland: 'CH', Taipei: 'TW', UK: 'GB', USA: 'US' };
export const countryCode = (country) => ISO[country] || 'INT';

export const isItType = (type) => IT_TYPES.includes(String(type || '').trim().toLowerCase().replace(/\s+/g, ' '));

// gridleads_<type>_<country>, lower case, a dash for every space: gridleads_it-companies_hu
export const sourceOf = (type, code) => `gridleads_${String(type).trim().toLowerCase().replace(/\s+/g, '-')}_${String(code).toLowerCase()}`;

const hostOf = (website) => {
  try { return new URL(/^https?:\/\//i.test(website) ? website : 'http://' + website).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|linkedin\.com|google\.com|g\.page|business\.site)$/;

// One lead → the company Melodia takes, or null when it does not go there.
//   lead     { name, website, websiteStatus, category, email, emails, emailCheckedAt }
//   project  { type, country } from parseProjectGeo
export function companyFor(lead, project) {
  const l = lead || {};
  if (!project || !isItType(project.type)) return null;
  if (!l.name || !l.emailCheckedAt) return null;
  const website = String(l.website || '').trim();
  const host = hostOf(website);
  if (l.websiteStatus !== 'HAS_WEBSITE' || !host || SOCIAL.test(host) || isPlatformHost(host)) return null;
  const code = countryCode(project.country);
  const out = { company: String(l.name).slice(0, 200), website, country: code, source: sourceOf(project.type, code) };
  if (l.category) out.industry = String(l.category).slice(0, 100);
  // only addresses read off its website that are fit to write to, the best first
  const email = bestEmail(l).email;
  if (email) {
    out.email = email;
    const others = [...new Set([l.email, ...(Array.isArray(l.emails) ? l.emails : [])].map((e) => String(e || '').trim().toLowerCase()))]
      .filter((e) => e && e !== email && emailQuality(e, l).ok).slice(0, 5);
    if (others.length) out.otherEmails = others;
  }
  return out;
}
