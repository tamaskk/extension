import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionMap, findRegionSuffix } from './regionLookup.mjs';

const map = buildRegionMap(['York', 'New York', 'Texas', 'USA', 'Bécs', 'West Virginia', 'Virginia']);
const find = (q) => findRegionSuffix(q.toLowerCase(), map);

test('finds the region a query ends with', () => {
  assert.equal(find('plumbers near Austin city Texas'), 'Texas');
  assert.equal(find('cafes near Belváros Bécs'), 'Bécs');
});

test('the longest region wins', () => {
  assert.equal(find('dentists near Soho New York'), 'New York');
  assert.equal(find('bars near Charleston West Virginia'), 'West Virginia');
  assert.equal(find('bars near Richmond Virginia'), 'Virginia');
});

test('the whole query can be the region', () => {
  assert.equal(find('New York'), 'New York');
  assert.equal(find('usa'), 'USA');
});

test('only whole words match', () => {
  assert.equal(find('plumbers near Newyork'), '');
  assert.equal(find('plumbers near XTexas'), '');
});

test('no known region gives an empty string', () => {
  assert.equal(find('plumbers near Atlantis'), '');
  assert.equal(find(''), '');
});

test('returns the original spelling, first one wins for the same lower-case name', () => {
  const m = buildRegionMap(['Paris', 'PARIS']);
  assert.equal(findRegionSuffix('hotels near paris', m), 'Paris');
});

test('repeated spaces do not hide the region', () => {
  assert.equal(find('dentists near  Graz   Texas'), 'Texas');
});
