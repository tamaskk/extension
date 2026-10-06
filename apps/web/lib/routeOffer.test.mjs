import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARGIN, CATEGORY_TABLE, routeOffer } from './routeOffer.mjs';

const CLINIC = { name: 'City Dental Clinic', category: 'Dental clinic', reviewCount: 400, rating: 3.1, phone: '+1 555 0100' };
const CAFE = { name: 'Corner Cafe', category: 'Cafe', reviewCount: 12, rating: 4.9 };

test('a clinic with 400 reviews at 3.1 gets the AI offer', () => {
  const r = routeOffer(CLINIC);

  assert.equal(r.offer, 'ai');
  assert.ok(r.reasons.includes('sok értékelés, gyenge átlag'));
  assert.ok(r.reasons.includes('időpontos kategória'));
});

test('a cafe with 12 reviews at 4.9 gets the social offer', () => {
  const r = routeOffer(CAFE);

  assert.equal(r.offer, 'social');
  assert.deepEqual(r.reasons, ['látványkategória', 'kevés értékelés, jó átlag']);
});

test('a lead with only a name does not throw, and is a close call for social', () => {
  for (const lead of [{ name: 'Somebody' }, {}, null, undefined, 'junk']) {
    const r = routeOffer(lead);

    assert.equal(r.offer, 'social');
    assert.deepEqual(r.reasons, ['határeset']);
    assert.equal(r.score, 0);
  }
});

test('two leads within the margin both go to social and are marked as close calls', () => {
  // AI 30 (category) against social 30 (few reviews, good average): a tie
  const tied = { category: 'Dentist', reviewCount: 10, rating: 4.8 };
  // AI 35 (many reviews, weak average) against social 30 (visual category): 5 apart, AI ahead
  const aiAhead = { category: 'Restaurant', reviewCount: 300, rating: 3.5 };

  for (const lead of [tied, aiAhead]) {
    const r = routeOffer(lead);

    assert.equal(r.offer, 'social');
    assert.ok(r.reasons.includes('határeset'));
  }
});

test('exactly the margin apart is a clear decision', () => {
  // AI 30 + 20 = 50 against social 30 + 10 = 40
  const lead = { category: 'Hair salon and beauty', phone: '1', hasBookingHint: false, websiteStatus: 'FACEBOOK_ONLY' };

  const r = routeOffer(lead);

  assert.equal(MARGIN, 10);
  assert.equal(r.offer, 'ai');
  assert.equal(r.reasons.includes('határeset'), false);
});

test('the same lead gives the same answer every time', () => {
  assert.deepEqual(routeOffer(CLINIC), routeOffer({ ...CLINIC }));
  assert.deepEqual(routeOffer(CAFE), routeOffer(CAFE));
});

test('missing fields give no points and no error', () => {
  assert.deepEqual(routeOffer({ category: null, reviewCount: null, rating: undefined, phone: '', hasBookingHint: null }), { offer: 'social', score: 0, reasons: ['határeset'] });
  assert.equal(routeOffer({ reviewCount: '400', rating: '3.1' }).score, 0); // text is not a number
});

test('a phone without online booking pulls towards AI', () => {
  const r = routeOffer({ category: 'Auto repair shop', phone: '+36 1 234 5678', hasBookingHint: false });

  assert.equal(r.offer, 'ai');
  assert.ok(r.reasons.includes('van telefon, nincs online foglalás'));
});

test('a booking engine found on the website outweighs the scraper\'s hint', () => {
  const lead = { category: 'Lawyer', phone: '1', hasBookingHint: false, sig: { checkedAt: '2026-10-06T10:00:00.000Z', booking: 'Calendly', instagram: 'x' } };

  assert.equal(routeOffer(lead).reasons.includes('van telefon, nincs online foglalás'), false);
});

test('complaints about reaching the business pull towards AI', () => {
  for (const aiPainPoints of ['Several reviewers say nobody picked up the phone.', 'They never called back.', 'Többen írják, hogy nem vették fel a telefont.', 'Hosszú várakozás.']) {
    assert.ok(routeOffer({ aiPainPoints }).reasons.includes('az értékelések elérhetőségi panaszt említenek'), aiPainPoints);
  }
});

test('a website without an Instagram link pulls towards social, but only once the site was read', () => {
  const read = { category: 'Florist', sig: { checkedAt: '2026-10-06T10:00:00.000Z', booking: '', instagram: '' } };
  const unread = { category: 'Florist' };

  assert.ok(routeOffer(read).reasons.includes('a weboldal nem mutat Instagramra'));
  assert.equal(routeOffer(unread).reasons.includes('a weboldal nem mutat Instagramra'), false);
});

test('Hungarian categories are understood', () => {
  assert.equal(routeOffer({ category: 'Fogorvos', reviewCount: 250, rating: 3.6 }).offer, 'ai');
  assert.equal(routeOffer({ category: 'Kávézó', reviewCount: 8, rating: 4.8 }).offer, 'social');
});

test('the score stays between 0 and 100', () => {
  const max = routeOffer({ category: 'Dental clinic repair', reviewCount: 900, rating: 2.5, phone: '1', hasBookingHint: false, aiPainPoints: 'nobody answered' });

  assert.ok(max.score <= 100 && max.score >= 0);
  assert.equal(max.offer, 'ai');
});

test('the category table is one constant with both sides, in both languages', () => {
  assert.ok(CATEGORY_TABLE.ai.includes('clinic') && CATEGORY_TABLE.ai.includes('klinika'));
  assert.ok(CATEGORY_TABLE.social.includes('cafe') && CATEGORY_TABLE.social.includes('kávézó'));
});
