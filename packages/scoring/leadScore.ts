import type { BusinessSignals, ScoreContribution, ScoreResult, Temperature } from './types';

/**
 * Lead Scoring Engine.
 *
 * Implements the weighted rule set from the product spec. Each rule is pure and
 * additive; the total is clamped to 0-100. We keep the full breakdown so the UI
 * can show *why* a lead is hot ("No website +50, <50 reviews +15, ...").
 *
 * The weights are config, not magic numbers — expose them per-organization later
 * so agencies can tune scoring to their offer (e.g. a booking-SaaS reseller may
 * weight "no booking system" higher).
 */

export interface LeadScoreWeights {
  noWebsite: number;
  websiteOlderThan5y: number;
  noSsl: number;
  fewReviews: number; // < fewReviewsThreshold
  fewReviewsThreshold: number;
  noFacebook: number;
  noInstagram: number;
  noGooglePosts: number;
  noBookingSystem: number;
  noOnlineOrdering: number;
}

export const DEFAULT_LEAD_WEIGHTS: LeadScoreWeights = {
  noWebsite: 50,
  websiteOlderThan5y: 20,
  noSsl: 20,
  fewReviews: 15,
  fewReviewsThreshold: 50,
  noFacebook: 10,
  noInstagram: 10,
  noGooglePosts: 10,
  noBookingSystem: 15,
  noOnlineOrdering: 15,
};

const WEBSITELESS_STATUSES = new Set([
  'NO_WEBSITE',
  'FACEBOOK_ONLY',
  'INSTAGRAM_ONLY',
  'DOMAIN_EXPIRED',
  'NOT_WORKING',
  'BROKEN',
]);

export function temperatureFor(score: number): Temperature {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}

export function computeLeadScore(
  s: BusinessSignals,
  weights: LeadScoreWeights = DEFAULT_LEAD_WEIGHTS,
): ScoreResult {
  const b: ScoreContribution[] = [];
  const add = (cond: boolean | null | undefined, rule: string, points: number, reason: string) => {
    if (cond) b.push({ rule, points, reason });
  };

  const hasNoWebsite = WEBSITELESS_STATUSES.has(s.websiteStatus);
  add(hasNoWebsite, 'no_website', weights.noWebsite, `Website status is ${s.websiteStatus}`);

  // Only score "old website" / "no ssl" when there *is* a site to judge.
  if (!hasNoWebsite) {
    add(
      (s.domainAgeYears ?? 0) > 5,
      'website_older_5y',
      weights.websiteOlderThan5y,
      `Domain is ${s.domainAgeYears} years old`,
    );
    add(s.hasSsl === false, 'no_ssl', weights.noSsl, 'Site served without valid SSL');
  }

  add(
    (s.reviewCount ?? 0) < weights.fewReviewsThreshold,
    'few_reviews',
    weights.fewReviews,
    `Only ${s.reviewCount ?? 0} reviews (< ${weights.fewReviewsThreshold})`,
  );

  add(s.hasFacebook === false, 'no_facebook', weights.noFacebook, 'No Facebook presence');
  add(s.hasInstagram === false, 'no_instagram', weights.noInstagram, 'No Instagram presence');
  add(s.hasGooglePosts === false, 'no_google_posts', weights.noGooglePosts, 'No Google Posts');
  add(s.hasBookingSystem === false, 'no_booking', weights.noBookingSystem, 'No booking system');
  add(s.hasOnlineOrdering === false, 'no_online_ordering', weights.noOnlineOrdering, 'No online ordering');

  const raw = b.reduce((sum, c) => sum + c.points, 0);
  const score = Math.max(0, Math.min(100, raw));

  return { score, temperature: temperatureFor(score), breakdown: b };
}
