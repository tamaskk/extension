import type { Temperature, WebsiteStatus } from './types';

// Port of the extension scoring engine. Lead score + Website Opportunity score.
const WEBSITELESS = new Set<WebsiteStatus>([
  'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY',
  'DOMAIN_EXPIRED', 'NOT_WORKING', 'BROKEN', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION',
]);

const OPPORTUNITY_PITCH: Record<string, string> = {
  no_website: 'No website — sell a full website build (highest ticket).',
  no_online_booking: 'No online booking — sell a booking/scheduling integration.',
  few_reviews: 'Few reviews — sell a reputation / review-generation service.',
  facebook_only: 'Only a Facebook page — sell a real website.',
  instagram_only: 'Only an Instagram page — sell a real website.',
};

export function classifyWebsite(website?: string | null): WebsiteStatus {
  if (!website) return 'NO_WEBSITE';
  let host = '';
  try { host = new URL(website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'HAS_WEBSITE'; }
  if (host.endsWith('facebook.com') || host === 'fb.me' || host.endsWith('fb.com')) return 'FACEBOOK_ONLY';
  if (host.endsWith('instagram.com')) return 'INSTAGRAM_ONLY';
  return 'HAS_WEBSITE';
}

export function temperatureFor(score: number): Temperature {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}

export interface ScoreInput {
  website?: string | null;
  websiteStatus?: WebsiteStatus;
  reviewCount?: number | null;
  rating?: number | null;
  hasBookingHint?: boolean | null;
}

export interface ScoreResult {
  websiteStatus: WebsiteStatus;
  leadScore: number;
  leadTemperature: Temperature;
  opportunityScore: number;
  topPitch: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Opportunity Engine v2 — "how valuable is it to sell THIS business a website".
 * The best lead is a clearly successful business (many reviews, high rating) that
 * has NO real website. Such a place reaches ~100. A site-less place nobody reviews
 * stays mid. A business that already has a real website is a low priority.
 *
 *   no website (base)           NO_WEBSITE 55 · social-only 48 · broken/expired 42
 *   + review boost (≤ 30)       log scale, 10k+ reviews → full 30
 *   + rating boost (≤ 15)       4.8★+ → full 15, ramps from 3.5★
 *   → no website + 10k reviews + 4.8★ = 100
 */
export function score(b: ScoreInput): ScoreResult {
  const status = b.websiteStatus || classifyWebsite(b.website);
  const noSite = WEBSITELESS.has(status);
  const reviews = Math.max(0, b.reviewCount ?? 0);
  const rating = b.rating ?? 0;
  const pitches: string[] = [];

  let opp = 0;
  if (noSite) {
    const base = status === 'NO_WEBSITE' ? 55
      : (status === 'FACEBOOK_ONLY' || status === 'INSTAGRAM_ONLY') ? 48
      : 42; // broken / expired / parked / not working / under construction
    const reviewBoost = 30 * clamp(Math.log10(reviews + 1) / 4, 0, 1); // 10k+ → 30
    const ratingBoost = 15 * clamp((rating - 3.5) / (4.8 - 3.5), 0, 1); // 4.8★+ → 15
    opp = base + reviewBoost + ratingBoost;
    pitches.push(status === 'FACEBOOK_ONLY' ? OPPORTUNITY_PITCH.facebook_only
      : status === 'INSTAGRAM_ONLY' ? OPPORTUNITY_PITCH.instagram_only
      : OPPORTUNITY_PITCH.no_website);
    if (b.hasBookingHint === false) pitches.push(OPPORTUNITY_PITCH.no_online_booking);
  } else if (b.hasBookingHint === false) {
    opp = 12; // already has a site — only a minor booking-integration upsell
    pitches.push(OPPORTUNITY_PITCH.no_online_booking);
  }
  if (reviews < 50) pitches.push(OPPORTUNITY_PITCH.few_reviews);
  const opportunityScore = Math.round(clamp(opp, 0, 100));

  // Lead score — a simpler "needs help + worth it" signal (kept for the Lead-score sort).
  let leadPts = 0;
  if (noSite) leadPts += 50;
  if (reviews < 50) leadPts += 15;
  if (b.hasBookingHint === false) leadPts += 15;
  if (rating >= 4.5) leadPts += 10;
  const leadScore = Math.min(100, leadPts);

  return {
    websiteStatus: status,
    leadScore,
    leadTemperature: temperatureFor(opportunityScore), // temperature now follows opportunity
    opportunityScore,
    topPitch: pitches[0] || '',
  };
}
