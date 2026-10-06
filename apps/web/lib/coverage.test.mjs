import { test } from 'node:test';
import assert from 'node:assert/strict';
import { covNorm, makeCoverage } from './coverage.mjs';

const cov = makeCoverage({
  stateRegions: ['Alabama', 'Virginia', 'West Virginia', 'Texas'],
  countryNames: ['USA', 'Hungary', 'UK'],
  statePlaces: { Alabama: [['Abbeville city', 2378], ['Adamsville city', 4178], ['Addison town', 669]], 'West Virginia': [['Charleston city', 48000], ['Beckley city', 17000]] },
  areasByFile: { hungary: { Budapest: ['Belváros', 'Aquincum', 'Újpest'] } },
});

test('covNorm lower-cases, strips accents and punctuation', () => {
  assert.equal(covNorm('  Bécs – Óbuda! '), 'becs obuda');
});

test('a state is found at the start of a folder name, the longest name first', () => {
  assert.equal(cov.covStateOf('Alabama Physical Therapy'), 'alabama'); // two-word business type
  assert.equal(cov.covStateOf('West Virginia Plumbers'), 'west virginia');
  assert.equal(cov.covStateOf('Virginia Plumbers'), 'virginia');
  assert.equal(cov.covStateOf('Budapest Restaurants'), null);
});

test('the region of a folder name is everything but its last word', () => {
  assert.equal(cov.covRegionOf('Budapest Restaurants'), 'Budapest');
  assert.equal(cov.covRegionOf('Texas'), 'Texas');
});

test('a country prefix marks a root folder', () => {
  assert.equal(cov.covCountryPrefix('USA Restaurants'), 'USA');
  assert.equal(cov.covCountryPrefix('Alabama Plumbers'), undefined);
});

test('a state folder: missing = reference places with no project naming them', () => {
  const parts = ['plumbers near Abbeville city Alabama', 'plumbers near Addison town Alabama'];
  assert.equal(cov.accurateMissing('Alabama Plumbers', parts), 1); // Adamsville city
  assert.equal(cov.accurateMissing('Alabama Plumbers', []), 3);
});

test('a place only counts as a whole word sequence', () => {
  assert.equal(cov.accurateMissing('Alabama Plumbers', ['plumbers near NewAbbeville city Alabama']), 3);
});

test('a city folder is checked against its areas, accents ignored', () => {
  assert.equal(cov.accurateMissing('Budapest Restaurants', ['restaurants near Belvaros Budapest', 'restaurants near Újpest Budapest']), 1);
});

test('roots and unknown regions have no accurate number', () => {
  assert.equal(cov.accurateMissing('USA Restaurants', ['x']), undefined);
  assert.equal(cov.accurateMissing('Atlantis Bakeries', ['x']), undefined);
});
