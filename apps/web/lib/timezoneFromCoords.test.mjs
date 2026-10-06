import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, timezoneFromCoords } from './timezoneFromCoords.mjs';

test('New York and Los Angeles are on the two coasts\' clocks', () => {
  assert.equal(timezoneFromCoords(40.7128, -74.006), 'America/New_York');
  assert.equal(timezoneFromCoords(34.0522, -118.2437), 'America/Los_Angeles');
});

test('Denver and Phoenix are two zones, because Arizona does not change its clocks', () => {
  assert.equal(timezoneFromCoords(39.7392, -104.9903), 'America/Denver');
  assert.equal(timezoneFromCoords(33.4484, -112.074), 'America/Phoenix');
});

test('Budapest is on the Central European clock, by coordinates and by country', () => {
  assert.equal(timezoneFromCoords(47.4979, 19.0402), 'Europe/Budapest');
  assert.equal(timezoneFromCoords(null, null, 'Hungary'), 'Europe/Budapest');
});

test('a missing or zero coordinate gives nothing, without an error', () => {
  for (const [lat, lng] of [[null, null], [undefined, undefined], [0, 0], ['', ''], ['x', 'y'], [NaN, NaN], [47.5, null]]) {
    assert.equal(timezoneFromCoords(lat, lng), '', `${lat}, ${lng}`);
  }
});

test('a place the lookup does not cover gives nothing, not a guess', () => {
  assert.equal(timezoneFromCoords(-33.8688, 151.2093), ''); // Sydney
  assert.equal(timezoneFromCoords(35.6762, 139.6503), '');  // Tokyo
  assert.equal(timezoneFromCoords(40.7128, -74.006, 'Other'), 'America/New_York');
});

test('a country with one clock answers without coordinates; one with several does not', () => {
  assert.equal(timezoneFromCoords(null, null, 'UK'), 'Europe/London');
  assert.equal(timezoneFromCoords(null, null, 'USA'), '');
  assert.equal(timezoneFromCoords(null, null, 'Canada'), '');
});

test('the list of zones holds everything the lookup can answer with', () => {
  const places = [[40.7, -74], [41.9, -87.6], [39.7, -105], [34, -118.2], [33.4, -112], [61.2, -149.9], [21.3, -157.9], [44.6, -63.6], [47.56, -52.7], [50.4, -104.6], [51.5, -0.1], [38.7, -9.1], [37.98, 23.7], [22.3, 114.2], [25, 121.6], [47.5, 19]];

  for (const [lat, lng] of places) assert.ok(ZONES.includes(timezoneFromCoords(lat, lng)), `${lat}, ${lng}`);
});
