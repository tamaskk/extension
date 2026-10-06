import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteSignals } from './siteSignals.mjs';

test('a booking engine is found by its name in the page', () => {
  assert.equal(siteSignals('<a href="https://calendly.com/dr-kovacs/30min">Book</a>').booking, 'Calendly');
  assert.equal(siteSignals('<iframe src="https://booksy.com/widget/code.js?id=12"></iframe>').booking, 'Booksy');
  assert.equal(siteSignals('<script src="https://www.opentable.com/widget/reservation/loader"></script>').booking, 'OpenTable');
  assert.equal(siteSignals('<a href="https://www.fresha.com/a/salon-budapest">Időpont</a>').booking, 'Fresha');
  assert.equal(siteSignals('<a href="https://app.acuityscheduling.com/schedule.php?owner=1">Book</a>').booking, 'Acuity');
});

test('an ordering service is found the same way', () => {
  assert.equal(siteSignals('<a href="https://wolt.com/hu/hun/budapest/restaurant/roma">Rendelés</a>').ordering, 'Wolt');
  assert.equal(siteSignals('<a href="https://www.ubereats.com/store/roma">Order</a>').ordering, 'Uber Eats');
});

test('the Instagram handle the site links to is read', () => {
  assert.equal(siteSignals('<a href="https://www.instagram.com/Pizzeria.Roma/">Insta</a>').instagram, 'pizzeria.roma');
  assert.equal(siteSignals("<a href='https://instagram.com/roma_bp?igshid=1'>").instagram, 'roma_bp');
});

test('a link to a post or to Instagram itself is not a handle', () => {
  assert.equal(siteSignals('<a href="https://www.instagram.com/p/CxYz123/">').instagram, '');
  assert.equal(siteSignals('<a href="https://www.instagram.com/explore/tags/pizza/">').instagram, '');
});

test('a page with none of them gives three empty values', () => {
  assert.deepEqual(siteSignals('<html><body><h1>Welcome</h1></body></html>'), { booking: '', ordering: '', instagram: '' });
  assert.deepEqual(siteSignals(''), { booking: '', ordering: '', instagram: '' });
  assert.deepEqual(siteSignals(null), { booking: '', ordering: '', instagram: '' });
});

test('the result is three short strings, never a piece of the page', () => {
  const big = '<a href="https://calendly.com/x">' + 'x'.repeat(50_000) + '</a><a href="https://instagram.com/roma">';

  const s = siteSignals(big);

  assert.ok(JSON.stringify(s).length < 100);
});
