import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  norm, verticalFromPrefix, splitQuery, buildRegionIndex, regionFromRest, planFor,
} from './organize.mjs';

// A small fixture index. States listed first so they win over same-named cities.
const idx = buildRegionIndex([
  { name: 'Arkansas', country: 'USA' },
  { name: 'Texas', country: 'USA' },
  { name: 'Indiana', country: 'USA' },
  { name: 'New York', country: 'USA' },
  { name: 'West Virginia', country: 'USA' },
  { name: 'Austin', country: 'USA' },
  { name: 'Salt Lake City', country: 'USA' },
  { name: 'Budapest', country: 'Hungary' },
  { name: 'Toronto', country: 'Canada' },
]);

test('norm: lowercases, strips accents & punctuation, collapses spaces', () => {
  assert.equal(norm('  Békéscsaba  City! '), 'bekescsaba city');
  assert.equal(norm('NewYork-City'), 'newyork city');
  assert.equal(norm(null), '');
});

test('verticalFromPrefix: known prefixes map to canonical nouns', () => {
  assert.equal(verticalFromPrefix('plumbers near'), 'Plumbers');
  assert.equal(verticalFromPrefix('electricians near'), 'Electricians');
  assert.equal(verticalFromPrefix('restaurants near'), 'Restaurants');
  assert.equal(verticalFromPrefix('restuarants near'), 'Restaurants'); // misspelling
  assert.equal(verticalFromPrefix('hvac near'), 'HVAC');
  assert.equal(verticalFromPrefix('dentists near'), 'Dentists');
});

test('verticalFromPrefix: unknown prefix falls back to title-case', () => {
  assert.equal(verticalFromPrefix('dog groomers near'), 'Dog Groomers');
  assert.equal(verticalFromPrefix('  CAR washes   near '), 'Car Washes');
});

test('splitQuery: splits on the first " near "', () => {
  assert.deepEqual(splitQuery('plumbers near Adona city Arkansas'),
    { prefix: 'plumbers near', rest: 'Adona city Arkansas' });
  assert.equal(splitQuery('clinica'), null);
  assert.equal(splitQuery('search-2026-06-14T08:30'), null);
  assert.equal(splitQuery('plumbers near   '), null); // empty rest
});

test('regionFromRest: matches the trailing region', () => {
  assert.deepEqual(regionFromRest('Adona city Arkansas', idx), { region: 'Arkansas', country: 'USA' });
  assert.deepEqual(regionFromRest('Allandale Austin', idx), { region: 'Austin', country: 'USA' });
  assert.deepEqual(regionFromRest('Agincourt Toronto', idx), { region: 'Toronto', country: 'Canada' });
  assert.deepEqual(regionFromRest('Belváros Budapest', idx), { region: 'Budapest', country: 'Hungary' });
});

test('regionFromRest: prefers the longest multi-word suffix', () => {
  assert.deepEqual(regionFromRest('Sugar House Salt Lake City', idx), { region: 'Salt Lake City', country: 'USA' });
  assert.deepEqual(regionFromRest('Harlem New York', idx), { region: 'New York', country: 'USA' });
  assert.deepEqual(regionFromRest('Charleston West Virginia', idx), { region: 'West Virginia', country: 'USA' });
});

test('regionFromRest: a place that merely contains a region word resolves to the true suffix', () => {
  // "Washington city Indiana" — region is Indiana, not Washington
  assert.deepEqual(regionFromRest('Washington city Indiana', idx), { region: 'Indiana', country: 'USA' });
});

test('regionFromRest: returns null when no known region is found', () => {
  assert.equal(regionFromRest('Somewhere Unknownland', idx), null);
});

test('planFor: full plan for a state vertical', () => {
  assert.deepEqual(planFor('plumbers near Rowlett city Texas', idx), {
    vertical: 'Plumbers', region: 'Texas', country: 'USA',
    subName: 'Texas Plumbers', rootName: 'USA Plumbers',
  });
});

test('planFor: full plan for a city vertical (restaurants)', () => {
  assert.deepEqual(planFor('restaurants near Allandale Austin', idx), {
    vertical: 'Restaurants', region: 'Austin', country: 'USA',
    subName: 'Austin Restaurants', rootName: 'USA Restaurants',
  });
  assert.deepEqual(planFor('restaurants near Agincourt Toronto', idx), {
    vertical: 'Restaurants', region: 'Toronto', country: 'Canada',
    subName: 'Toronto Restaurants', rootName: 'Canada Restaurants',
  });
});

test('planFor: returns null for junk / unparseable queries', () => {
  assert.equal(planFor('clinica', idx), null);
  assert.equal(planFor('search-2026-06-15T09:52', idx), null);
  assert.equal(planFor('plumbers near Nowhereville', idx), null); // unknown region
});

test('planFor: idempotent target names (running twice yields same plan)', () => {
  const a = planFor('electricians near Adona city Arkansas', idx);
  const b = planFor('electricians near Adona city Arkansas', idx);
  assert.deepEqual(a, b);
  assert.equal(a.subName, 'Arkansas Electricians');
  assert.equal(a.rootName, 'USA Electricians');
});
