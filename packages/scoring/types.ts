// Shared scoring types for GridLeads.
// These mirror the Prisma enums but live in the scoring package so the engine
// has zero dependency on Prisma and can run inside the worker, the API, or the
// Chrome extension's service worker.

export type WebsiteStatus =
  | 'UNKNOWN'
  | 'HAS_WEBSITE'
  | 'NO_WEBSITE'
  | 'FACEBOOK_ONLY'
  | 'INSTAGRAM_ONLY'
  | 'BROKEN'
  | 'REDIRECTS'
  | 'NOT_WORKING'
  | 'DOMAIN_EXPIRED'
  | 'DOMAIN_PARKED'
  | 'UNDER_CONSTRUCTION';

export type Temperature = 'COLD' | 'WARM' | 'HOT';

/** Normalized facts about a business, gathered by the scraper + website probe. */
export interface BusinessSignals {
  websiteStatus: WebsiteStatus;
  /** Age of the domain in years, if WHOIS resolved. */
  domainAgeYears?: number | null;
  hasSsl?: boolean | null;
  reviewCount?: number | null;
  rating?: number | null;
  hasFacebook?: boolean | null;
  hasInstagram?: boolean | null;
  hasGooglePosts?: boolean | null;
  hasBookingSystem?: boolean | null;
  hasOnlineOrdering?: boolean | null;

  // Website Opportunity Engine probe results (subset; see websiteOpportunity.ts)
  pageSpeedScore?: number | null; // 0-100 from Lighthouse/PSI
  isMobileFriendly?: boolean | null;
  hasFacebookPixel?: boolean | null;
  hasGoogleAnalytics?: boolean | null;
  hasMetaAdsPixel?: boolean | null;
}

export interface ScoreContribution {
  rule: string;
  points: number;
  reason: string;
}

export interface ScoreResult {
  score: number; // clamped 0-100
  temperature: Temperature;
  breakdown: ScoreContribution[];
}
