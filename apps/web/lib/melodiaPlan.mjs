// Which leads go on to Melodia, and in what shape. Pure: POST /api/melodia
// hands in the leads the operator ticked on the dashboard, lib/melodia.ts sends
// the answer. Nothing is sent on its own: the operator decides, lead by lead.
//
// Only a lead with a website of its own goes: Melodia's rules ask for real
// companies with their official site, and it tells repeats apart by the site.
import { bestEmail, emailQuality, isPlatformHost } from './emailQuality.mjs';

// Melodia takes at most this many companies per request.
export const MELODIA_BATCH = 200;

// A project's country (lib/projectGeo.ts) → its two-letter code; INT for the rest.
const ISO = { Austria: 'AT', Belgium: 'BE', Canada: 'CA', France: 'FR', Greece: 'GR', 'Hong Kong': 'HK', Hungary: 'HU', Italy: 'IT', Netherlands: 'NL', Portugal: 'PT', Spain: 'ES', Switzerland: 'CH', Taipei: 'TW', UK: 'GB', USA: 'US' };
export const countryCode = (country) => ISO[country] || 'INT';

// gridleads_<type>_<country>, lower case, a dash for every space: gridleads_it-companies_hu
export const sourceOf = (type, code) => `gridleads_${String(type).trim().toLowerCase().replace(/\s+/g, '-')}_${String(code).toLowerCase()}`;

const hostOf = (website) => {
  try { return new URL(/^https?:\/\//i.test(website) ? website : 'http://' + website).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|linkedin\.com|google\.com|g\.page|business\.site)$/;

// One lead → the company Melodia takes, or null when it does not go there.
//   lead     { name, website, websiteStatus, category, email, emails }
//   project  { type, country } from parseProjectGeo; the type names the source
export function companyFor(lead, project) {
  const l = lead || {};
  if (!project || !project.type || !l.name) return null;
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
