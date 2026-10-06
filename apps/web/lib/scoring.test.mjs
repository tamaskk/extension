// Parity test: the web scoring (lib/scoring.mjs) and the extension scoring
// (apps/extension/lib/scoring.js) are two copies of one engine. The extension
// is plain JS with no build step and apps do not import from each other, so the
// copies cannot be merged; this test fails the moment they disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { score, classifyWebsite } from './scoring.mjs';

// The extension file is an IIFE that attaches to `self`; run it against a stub.
const extSrc = readFileSync(new URL('../../extension/lib/scoring.js', import.meta.url), 'utf8');
const root = {};
new Function('self', extSrc)(root);
const ext = root.GridLeadsScoring;

const WEBSITES = [
  undefined, null, '', 'not a url',
  'https://example.com', 'http://www.example.com/menu',
  'https://facebook.com/joespizza', 'https://www.facebook.com/x', 'https://m.facebook.com/x',
  'https://fb.me/x', 'https://fb.com/x', 'https://business.fb.com/x',
  'https://instagram.com/x', 'https://www.instagram.com/x',
  // look-alike hosts: a real site, not a social page
  'https://myfacebook.com', 'https://notinstagram.com', 'https://xfb.com', 'https://facebook.com.evil.example',
];
const STATUSES = [undefined, 'HAS_WEBSITE', 'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN',
  'DOMAIN_EXPIRED', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION', 'NOT_WORKING', 'REDIRECTS'];
const REVIEWS = [undefined, null, 0, 1, 49, 50, 999, 10000, 250000, -5, '120', 'abc'];
const RATINGS = [undefined, null, 0, 3.4, 3.5, 4.2, 4.5, 4.8, 5, '4.7', 'n/a'];
const BOOKING = [undefined, null, true, false];

test('classifyWebsite agrees with the extension', () => {
  for (const w of WEBSITES) assert.equal(classifyWebsite(w), ext.classifyWebsite(w), `website ${JSON.stringify(w)}`);
});

test('score agrees with the extension on every input combination', () => {
  let n = 0;
  for (const website of WEBSITES) for (const websiteStatus of STATUSES) for (const reviewCount of REVIEWS)
    for (const rating of RATINGS) for (const hasBookingHint of BOOKING) {
      const input = { website, websiteStatus, reviewCount, rating, hasBookingHint };
      assert.deepEqual(score(input), ext.score(input), JSON.stringify(input));
      n++;
    }
  assert.ok(n > 80000);
});

test('scores are always finite numbers in range', () => {
  for (const reviewCount of REVIEWS) for (const rating of RATINGS) {
    const s = score({ websiteStatus: 'NO_WEBSITE', reviewCount, rating });
    assert.ok(Number.isFinite(s.opportunityScore) && s.opportunityScore >= 0 && s.opportunityScore <= 100, JSON.stringify({ reviewCount, rating, s }));
    assert.ok(Number.isFinite(s.leadScore) && s.leadScore >= 0 && s.leadScore <= 100);
  }
});

test('the reference case: no website, 10k reviews, 4.8 stars scores 100 and is hot', () => {
  const s = score({ websiteStatus: 'NO_WEBSITE', reviewCount: 10000, rating: 4.8 });
  assert.equal(s.opportunityScore, 100);
  assert.equal(s.leadTemperature, 'HOT');
  assert.equal(s.topPitch, 'No website — sell a full website build (highest ticket).');
});
