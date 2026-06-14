import { describe, it, expect } from 'vitest';
import { computeLeadScore } from './leadScore';
import { computeOpportunityScore } from './websiteOpportunity';
import { classifyWebsite } from './websiteStatus';
import type { BusinessSignals } from './types';

describe('computeLeadScore', () => {
  it('scores a websiteless, low-review, no-social business as HOT', () => {
    const s: BusinessSignals = {
      websiteStatus: 'NO_WEBSITE',
      reviewCount: 12,
      hasFacebook: false,
      hasInstagram: false,
      hasBookingSystem: false,
    };
    const r = computeLeadScore(s);
    // 50 + 15 + 10 + 10 + 15 = 100 (clamped)
    expect(r.score).toBe(100);
    expect(r.temperature).toBe('HOT');
    expect(r.breakdown.find((c) => c.rule === 'no_website')?.points).toBe(50);
  });

  it('does not apply old-site/no-ssl rules when there is no website', () => {
    const r = computeLeadScore({ websiteStatus: 'NO_WEBSITE', domainAgeYears: 9, hasSsl: false });
    expect(r.breakdown.some((c) => c.rule === 'website_older_5y')).toBe(false);
    expect(r.breakdown.some((c) => c.rule === 'no_ssl')).toBe(false);
  });

  it('scores a healthy business as COLD', () => {
    const r = computeLeadScore({
      websiteStatus: 'HAS_WEBSITE',
      domainAgeYears: 2,
      hasSsl: true,
      reviewCount: 500,
      hasFacebook: true,
      hasInstagram: true,
      hasGooglePosts: true,
      hasBookingSystem: true,
      hasOnlineOrdering: true,
    });
    expect(r.score).toBe(0);
    expect(r.temperature).toBe('COLD');
  });
});

describe('computeOpportunityScore', () => {
  it('ranks a no-website business with a full-build pitch first', () => {
    const r = computeOpportunityScore({ websiteStatus: 'NO_WEBSITE', hasBookingSystem: false });
    expect(r.score).toBeGreaterThan(0);
    expect(r.pitches[0]).toMatch(/full website build/i);
  });

  it('surfaces technical gaps only when a site exists', () => {
    const r = computeOpportunityScore({
      websiteStatus: 'HAS_WEBSITE',
      pageSpeedScore: 20,
      isMobileFriendly: false,
      hasSsl: false,
      hasFacebookPixel: false,
      hasGoogleAnalytics: false,
      hasMetaAdsPixel: false,
    });
    expect(r.breakdown.map((b) => b.rule)).toEqual(
      expect.arrayContaining(['slow_website', 'not_mobile', 'no_ssl', 'no_fb_pixel', 'no_ga', 'no_meta_ads']),
    );
  });
});

describe('classifyWebsite', () => {
  it('maps a facebook url to FACEBOOK_ONLY', () => {
    expect(classifyWebsite({ rawWebsite: 'https://facebook.com/joespizza' })).toBe('FACEBOOK_ONLY');
  });
  it('maps missing url to NO_WEBSITE', () => {
    expect(classifyWebsite({ rawWebsite: null })).toBe('NO_WEBSITE');
  });
  it('detects a parked domain from body markers', () => {
    expect(
      classifyWebsite({
        rawWebsite: 'https://example.com',
        probe: { finalUrl: 'https://example.com', status: 200, redirected: false, ssl: true, reachable: true, html: 'Buy this domain at sedoparking' },
      }),
    ).toBe('DOMAIN_PARKED');
  });
});
