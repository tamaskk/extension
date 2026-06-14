import type { BusinessSignals, ScoreContribution, ScoreResult } from './types';
import { temperatureFor } from './leadScore';

/**
 * Website Opportunity Engine  —  the core USP.
 *
 * Where the Lead Score answers "how qualified is this lead overall?", the
 * Opportunity Score answers a sharper, sales-ready question:
 *   "How much website/marketing work could I sell this business right now?"
 *
 * It scores concrete, demonstrable technical gaps a web designer / marketing
 * agency can fix and invoice for. Every signal maps to a pitch line, so the UI
 * can render an auto-generated "sales angle" next to the score.
 *
 * Output: 0-100 "Website Sales Opportunity Score" + a breakdown the rep can
 * read aloud on a cold call ("You have no SSL, your site isn't mobile-friendly,
 * and you're not running a Meta pixel — here's what that's costing you...").
 */

export interface OpportunityWeights {
  noWebsite: number;
  slowWebsite: number; // pageSpeedScore below slowThreshold
  slowThreshold: number;
  notMobileFriendly: number;
  noSsl: number;
  noOnlineBooking: number;
  noFacebookPixel: number;
  noGoogleAnalytics: number;
  noMetaAdsPixel: number;
}

export const DEFAULT_OPPORTUNITY_WEIGHTS: OpportunityWeights = {
  noWebsite: 30, // biggest, single-fix, highest-ticket opportunity
  slowWebsite: 12,
  slowThreshold: 50,
  notMobileFriendly: 14,
  noSsl: 12,
  noOnlineBooking: 10,
  noFacebookPixel: 8,
  noGoogleAnalytics: 8,
  noMetaAdsPixel: 6,
};

const WEBSITELESS = new Set([
  'NO_WEBSITE',
  'FACEBOOK_ONLY',
  'INSTAGRAM_ONLY',
  'DOMAIN_EXPIRED',
  'NOT_WORKING',
  'BROKEN',
  'DOMAIN_PARKED',
  'UNDER_CONSTRUCTION',
]);

/** Human-readable sales angle for each opportunity rule. */
export const OPPORTUNITY_PITCH: Record<string, string> = {
  no_website: 'No website — sell a full website build (highest ticket).',
  slow_website: 'Slow site — sell a performance/redesign engagement.',
  not_mobile: 'Not mobile-friendly — most local traffic is mobile; sell responsive rebuild.',
  no_ssl: 'No SSL — security warning scares customers; quick win upsell.',
  no_online_booking: 'No online booking — sell a booking/scheduling integration.',
  no_fb_pixel: 'No Facebook Pixel — they cannot retarget; sell ads setup.',
  no_ga: 'No Google Analytics — flying blind; sell analytics + reporting retainer.',
  no_meta_ads: 'No Meta Ads pixel — sell paid-social management.',
};

export interface OpportunityResult extends ScoreResult {
  /** Ready-to-use sales angles for the detected gaps, highest value first. */
  pitches: string[];
}

export function computeOpportunityScore(
  s: BusinessSignals,
  weights: OpportunityWeights = DEFAULT_OPPORTUNITY_WEIGHTS,
): OpportunityResult {
  const b: ScoreContribution[] = [];
  const add = (cond: boolean | null | undefined, rule: string, points: number, reason: string) => {
    if (cond) b.push({ rule, points, reason });
  };

  const noSite = WEBSITELESS.has(s.websiteStatus);
  add(noSite, 'no_website', weights.noWebsite, `Website status: ${s.websiteStatus}`);

  // The on-page technical signals only make sense if a site actually responds.
  if (!noSite) {
    add(
      typeof s.pageSpeedScore === 'number' && s.pageSpeedScore < weights.slowThreshold,
      'slow_website',
      weights.slowWebsite,
      `PageSpeed ${s.pageSpeedScore}/100 (< ${weights.slowThreshold})`,
    );
    add(s.isMobileFriendly === false, 'not_mobile', weights.notMobileFriendly, 'Fails mobile-friendly check');
    add(s.hasSsl === false, 'no_ssl', weights.noSsl, 'No valid SSL certificate');
    add(s.hasFacebookPixel === false, 'no_fb_pixel', weights.noFacebookPixel, 'No Facebook Pixel detected');
    add(s.hasGoogleAnalytics === false, 'no_ga', weights.noGoogleAnalytics, 'No Google Analytics detected');
    add(s.hasMetaAdsPixel === false, 'no_meta_ads', weights.noMetaAdsPixel, 'No Meta Ads pixel detected');
  }

  // "No online booking" applies whether or not there is a site.
  add(s.hasBookingSystem === false, 'no_online_booking', weights.noOnlineBooking, 'No online booking system');

  const raw = b.reduce((sum, c) => sum + c.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const pitches = [...b]
    .sort((x, y) => y.points - x.points)
    .map((c) => OPPORTUNITY_PITCH[c.rule])
    .filter(Boolean);

  return { score, temperature: temperatureFor(score), breakdown: b, pitches };
}
