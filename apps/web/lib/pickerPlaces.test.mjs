import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_CENTERS, STATE_CENTERS, clockIn, zoneOfPlace } from './pickerPlaces.mjs';

test('every country and state on the map has a clock', () => {
  for (const country of Object.keys(COUNTRY_CENTERS)) assert.notEqual(zoneOfPlace(country), '', country);
  for (const state of Object.keys(STATE_CENTERS)) assert.notEqual(zoneOfPlace('USA', state), '', state);
  assert.equal(Object.keys(STATE_CENTERS).length, 51);
});

test('states keep their own clocks, not one for the whole country', () => {
  assert.equal(zoneOfPlace('USA', 'New York'), 'America/New_York');
  assert.equal(zoneOfPlace('USA', 'Texas'), 'America/Chicago');
  assert.equal(zoneOfPlace('USA', 'Colorado'), 'America/Denver');
  assert.equal(zoneOfPlace('USA', 'California'), 'America/Los_Angeles');
  assert.equal(zoneOfPlace('USA', 'Arizona'), 'America/Phoenix');
  assert.equal(zoneOfPlace('USA', 'Hawaii'), 'Pacific/Honolulu');
  assert.equal(zoneOfPlace('Hungary'), 'Europe/Budapest');
  assert.equal(zoneOfPlace('UK'), 'Europe/London');
});

test('a place that is not on the map has no zone', () => {
  assert.equal(zoneOfPlace('Atlantis'), '');
  assert.equal(zoneOfPlace('USA', 'Atlantis'), '');
});

test('clockIn reads the weekday and the time on the zone\'s own clock', () => {
  const noonUtc = new Date('2026-01-06T12:00:00Z'); // a Tuesday, winter time

  assert.equal(clockIn('Europe/Budapest', noonUtc), 'Tue 13:00');
  assert.equal(clockIn('America/New_York', noonUtc), 'Tue 07:00');
  assert.equal(clockIn('Pacific/Honolulu', noonUtc), 'Tue 02:00');
  assert.equal(clockIn('', noonUtc), '');
  assert.equal(clockIn('Not/AZone', noonUtc), '');
});
