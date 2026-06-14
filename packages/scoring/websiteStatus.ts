import type { WebsiteStatus } from './types';

/**
 * Website Status Detector.
 *
 * Runs in the enrichment worker. Given a raw website URL scraped from Google
 * Maps (often missing, often a social link), it classifies the business into one
 * of the WebsiteStatus buckets used by the scoring engines and the filters.
 *
 * This module is deliberately dependency-light: the caller injects a `fetch`-like
 * probe so it can be unit-tested with mocks and reused in the extension. WHOIS /
 * parked-domain detection is delegated to an injected resolver.
 */

export interface ProbeResult {
  finalUrl: string;
  status: number;
  redirected: boolean;
  ssl: boolean;
  html: string; // truncated body for heuristics
  reachable: boolean;
}

export interface WhoisResult {
  registered: boolean;
  expired: boolean;
  parked: boolean;
  ageYears: number | null;
}

export interface ClassifyInput {
  rawWebsite?: string | null;
  probe?: ProbeResult | null;
  whois?: WhoisResult | null;
}

const PARKED_MARKERS = [
  'this domain is for sale',
  'buy this domain',
  'parked free',
  'godaddy.com/domains',
  'sedoparking',
  'hugedomains',
];
const CONSTRUCTION_MARKERS = [
  'under construction',
  'coming soon',
  'site is being built',
  'launching soon',
];

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function classifyWebsite(input: ClassifyInput): WebsiteStatus {
  const { rawWebsite, probe, whois } = input;

  if (!rawWebsite) return 'NO_WEBSITE';

  const h = host(rawWebsite);
  // Social-only "websites" — extremely common for local businesses.
  if (h.endsWith('facebook.com') || h === 'fb.me' || h.endsWith('fb.com')) return 'FACEBOOK_ONLY';
  if (h.endsWith('instagram.com')) return 'INSTAGRAM_ONLY';

  if (whois?.expired) return 'DOMAIN_EXPIRED';
  if (whois && !whois.registered) return 'DOMAIN_EXPIRED';

  // Could not reach the server at all.
  if (!probe || !probe.reachable) return 'NOT_WORKING';
  if (probe.status >= 400) return 'BROKEN';

  const body = (probe.html || '').toLowerCase();
  if (whois?.parked || PARKED_MARKERS.some((m) => body.includes(m))) return 'DOMAIN_PARKED';
  if (CONSTRUCTION_MARKERS.some((m) => body.includes(m))) return 'UNDER_CONSTRUCTION';

  // Redirect to a *different* domain often means the original is dead/sold.
  if (probe.redirected && host(probe.finalUrl) !== h) return 'REDIRECTS';

  return 'HAS_WEBSITE';
}

/** Convenience: does this status mean "no usable website"? Used by filters. */
export function isWebsiteless(status: WebsiteStatus): boolean {
  return (
    status === 'NO_WEBSITE' ||
    status === 'FACEBOOK_ONLY' ||
    status === 'INSTAGRAM_ONLY' ||
    status === 'DOMAIN_EXPIRED' ||
    status === 'NOT_WORKING' ||
    status === 'BROKEN'
  );
}
