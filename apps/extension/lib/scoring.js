// GridLeads scoring — shared by the background service worker and pages.
// Attaches to `self` so it works in a SW (importScripts) and in a window.
(function (root) {
  const WEBSITELESS = new Set([
    'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY',
    'DOMAIN_EXPIRED', 'NOT_WORKING', 'BROKEN', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION',
  ]);

  const OPPORTUNITY_PITCH = {
    no_website: 'No website — sell a full website build (highest ticket).',
    no_online_booking: 'No online booking — sell a booking/scheduling integration.',
    few_reviews: 'Few reviews — sell a reputation / review-generation service.',
    facebook_only: 'Only a Facebook page — sell a real website.',
    instagram_only: 'Only an Instagram page — sell a real website.',
  };

  function classifyWebsite(website) {
    if (!website) return 'NO_WEBSITE';
    let host = '';
    try { host = new URL(website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'HAS_WEBSITE'; }
    // Exact domain or subdomain only — endsWith() would misclassify e.g. myfacebook.com.
    const isDomain = (d) => host === d || host.endsWith('.' + d);
    if (isDomain('facebook.com') || host === 'fb.me' || isDomain('fb.com')) return 'FACEBOOK_ONLY';
    if (isDomain('instagram.com')) return 'INSTAGRAM_ONLY';
    return 'HAS_WEBSITE';
  }

  function temperatureFor(score) {
    if (score >= 70) return 'HOT';
    if (score >= 40) return 'WARM';
    return 'COLD';
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Opportunity Engine v2 — best lead = a successful business (many reviews, high
  // rating) with NO real website. no website + 10k reviews + 4.8★ = 100.
  function score(b) {
    const status = b.websiteStatus || classifyWebsite(b.website);
    const noSite = WEBSITELESS.has(status);
    // Number() coercion so a non-numeric field from an imported bundle can't turn
    // reviewBoost/log10 (and thus opportunityScore) into NaN.
    const reviews = Math.max(0, Number(b.reviewCount) || 0);
    const rating = Number(b.rating) || 0;
    const pitches = [];

    let opp = 0;
    if (noSite) {
      const base = status === 'NO_WEBSITE' ? 55
        : (status === 'FACEBOOK_ONLY' || status === 'INSTAGRAM_ONLY') ? 48
        : 42;
      const reviewBoost = 30 * clamp(Math.log10(reviews + 1) / 4, 0, 1); // 10k+ → 30
      const ratingBoost = 15 * clamp((rating - 3.5) / (4.8 - 3.5), 0, 1); // 4.8★+ → 15
      opp = base + reviewBoost + ratingBoost;
      pitches.push(status === 'FACEBOOK_ONLY' ? OPPORTUNITY_PITCH.facebook_only
        : status === 'INSTAGRAM_ONLY' ? OPPORTUNITY_PITCH.instagram_only
        : OPPORTUNITY_PITCH.no_website);
      if (b.hasBookingHint === false) pitches.push(OPPORTUNITY_PITCH.no_online_booking);
    } else if (b.hasBookingHint === false) {
      opp = 12;
      pitches.push(OPPORTUNITY_PITCH.no_online_booking);
    }
    if (reviews < 50) pitches.push(OPPORTUNITY_PITCH.few_reviews);
    const opportunityScore = Math.round(clamp(opp, 0, 100));

    let leadPts = 0;
    if (noSite) leadPts += 50;
    if (reviews < 50) leadPts += 15;
    if (b.hasBookingHint === false) leadPts += 15;
    if (rating >= 4.5) leadPts += 10;
    const leadScore = Math.min(100, leadPts);

    return {
      websiteStatus: status,
      leadScore,
      leadTemperature: temperatureFor(opportunityScore),
      opportunityScore,
      topPitch: pitches[0] || '',
    };
  }

  root.GridLeadsScoring = { score, classifyWebsite };
})(typeof self !== 'undefined' ? self : this);
