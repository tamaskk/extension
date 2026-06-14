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
  hasBookingHint?: boolean | null;
}

export interface ScoreResult {
  websiteStatus: WebsiteStatus;
  leadScore: number;
  leadTemperature: Temperature;
  opportunityScore: number;
  topPitch: string;
}

export function score(b: ScoreInput): ScoreResult {
  const status = b.websiteStatus || classifyWebsite(b.website);
  const lead: { rule: string; points: number }[] = [];
  const opp: { rule: string; points: number }[] = [];
  const noSite = WEBSITELESS.has(status);

  if (noSite) {
    lead.push({ rule: 'no_website', points: 50 });
    opp.push({ rule: status === 'FACEBOOK_ONLY' ? 'facebook_only' : status === 'INSTAGRAM_ONLY' ? 'instagram_only' : 'no_website', points: 50 });
  }
  if ((b.reviewCount ?? 999) < 50) {
    lead.push({ rule: 'few_reviews', points: 15 });
    opp.push({ rule: 'few_reviews', points: 12 });
  }
  if (b.hasBookingHint === false) {
    lead.push({ rule: 'no_booking', points: 15 });
    opp.push({ rule: 'no_online_booking', points: 15 });
  }

  const leadScore = Math.min(100, lead.reduce((s, c) => s + c.points, 0));
  const oppScore = Math.min(100, opp.reduce((s, c) => s + c.points, 0));
  const pitches = [...opp].sort((a, c) => c.points - a.points)
    .map((c) => OPPORTUNITY_PITCH[c.rule]).filter(Boolean);

  return {
    websiteStatus: status,
    leadScore,
    leadTemperature: temperatureFor(leadScore),
    opportunityScore: oppScore,
    topPitch: pitches[0] || '',
  };
}
