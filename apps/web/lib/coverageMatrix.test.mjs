import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageIndex, missingIn, missingPlaces, typeKey } from './coverageMatrix.mjs';

const rows = [
  { region: 'Alabama', names: ['Abbeville city', 'Adamsville city', 'Addison town'] },
  { region: 'West Virginia', names: ['Charleston city', 'Beckley city'] },
  { region: 'Virginia', names: ['Richmond city'] },
  { region: 'Budapest', names: ['Belváros', 'Aquincum', 'Újpest'] },
  { region: 'Hungary', names: ['Budapest', 'Pécs'] },
  { region: 'Washington', names: ['Seattle city'] },   // the state
  { region: 'Washington', names: ['Georgetown'] },     // the city
];

test('typeKey ignores case, spaces and a plural s', () => {
  assert.equal(typeKey('Hair Salons'), 'hairsalon');
  assert.equal(typeKey('hairsalon'), 'hairsalon');
  assert.equal(typeKey('restaurants'), typeKey('Restaurant'));
  assert.notEqual(typeKey('bar'), typeKey('barber'));
});

test('a project counts for the reference place its query names', () => {
  const { present } = buildCoverageIndex(['massage near Abbeville city Alabama', 'massage near Addison town Alabama'], rows);

  assert.equal(present.massage[0], 2);
  assert.equal(missingIn(present, 'massage', 0, 3), 1);
  assert.equal(missingIn(present, 'florist', 0, 3), 3);
});

test('the same place under two spellings of a type is counted once', () => {
  const { present, types } = buildCoverageIndex(['hair salons near Abbeville city Alabama', 'hairsalon near Abbeville city Alabama', 'hair salons near Addison town Alabama'], rows);

  assert.equal(present.hairsalon[0], 2);
  assert.deepEqual(types, [{ key: 'hairsalon', label: 'hair salons', projects: 3 }]);
});

test('the longest region wins, so West Virginia is not Virginia', () => {
  const { present } = buildCoverageIndex(['bars near Charleston city West Virginia'], rows);

  assert.equal(present.bar[1], 1);
  assert.equal(present.bar[2], undefined);
});

test('accents and punctuation do not hide a place', () => {
  const { present } = buildCoverageIndex(['spa near Ujpest Budapest', 'spa near Pécs Hungary'], rows);

  assert.equal(present.spa[3], 1);
  assert.equal(present.spa[4], 1);
});

test('a region name shared by a state and a city fills the row whose list has the place', () => {
  const { present } = buildCoverageIndex(['florist near Georgetown Washington'], rows);

  assert.equal(present.florist[5], undefined);
  assert.equal(present.florist[6], 1);
});

test('a place outside the reference list, or a query without a known region, counts for nothing', () => {
  const { present, types } = buildCoverageIndex(['bar near Nowhere Alabama', 'bar near Abbeville city Atlantis', 'bar', ''], rows);

  assert.deepEqual(present, {});
  assert.equal(types[0].projects, 2);
});

test('a query without "near" takes its first word as the type', () => {
  const { present } = buildCoverageIndex(['dentists Abbeville city Alabama'], rows);

  assert.equal(present.dentist[0], 1);
});

test('missingPlaces lists what a type still lacks, in the reference spelling', () => {
  const queries = ['hair salons near Abbeville city Alabama', 'bars near Addison town Alabama', 'hairsalon near Ujpest Budapest'];

  const missing = missingPlaces(queries, rows, 'hairsalon');

  assert.deepEqual(missing[0], ['Adamsville city', 'Addison town']);
  assert.deepEqual(missing[1], ['Charleston city', 'Beckley city']);
  assert.deepEqual(missing[3], ['Belváros', 'Aquincum']);
});

test('missingPlaces agrees with the counts of the index', () => {
  const queries = ['spa near Abbeville city Alabama', 'spa near Seattle city Washington', 'spa near Georgetown Washington'];

  const { present } = buildCoverageIndex(queries, rows);
  const missing = missingPlaces(queries, rows, 'Spas');

  rows.forEach((r, i) => assert.equal(missing[i].length, missingIn(present, 'spa', i, r.names.length)));
});
