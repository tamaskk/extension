import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ZONES, TEST_MODE_MAX, zoneOf, windowOf, isInsideWindow, nextOpening, zonesOpenNow, runLimits } from './sendWindow.mjs';

const at = (lat, lng, over = {}) => ({ lat, lng, address: '', ...over });
const NEW_YORK = at(40.7128, -74.006);
const CHICAGO = at(41.8781, -87.6298);
const DENVER = at(39.7392, -104.9903);
const LOS_ANGELES = at(34.0522, -118.2437);
const BUDAPEST = at(47.4979, 19.0402);
const SENDER = {}; // the defaults: Monday to Friday, 7:00 to 19:00
// Tuesday 20 October 2026, 14:00 in Budapest (CEST) = 8:00 New York, 7:00 Chicago, 6:00 Denver, 5:00 Los Angeles
const TUESDAY = new Date('2026-10-20T12:00:00.000Z');
const SATURDAY = new Date('2026-10-24T15:00:00.000Z');

test('a Bronx coordinate is on the east coast clock, a Los Angeles one on the west coast clock', () => {
  assert.equal(zoneOf(at(40.8448, -73.8648)), 'America/New_York');
  assert.equal(zoneOf(LOS_ANGELES), 'America/Los_Angeles');
});

test('the four continental zones are told apart', () => {
  assert.deepEqual([NEW_YORK, CHICAGO, DENVER, LOS_ANGELES].map(zoneOf), ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']);
});

test('cities near the zone borders land on the right side', () => {
  const cases = [
    [39.7684, -86.1581, 'America/New_York'],   // Indianapolis
    [36.1627, -86.7816, 'America/Chicago'],    // Nashville
    [33.749, -84.388, 'America/New_York'],     // Atlanta
    [30.4213, -87.2169, 'America/Chicago'],    // Pensacola
    [29.7604, -95.3698, 'America/Chicago'],    // Houston
    [31.7619, -106.485, 'America/Denver'],     // El Paso
    [35.0844, -106.6504, 'America/Denver'],    // Albuquerque
    [40.7608, -111.891, 'America/Denver'],     // Salt Lake City
    [43.615, -116.2023, 'America/Denver'],     // Boise
    [36.1699, -115.1398, 'America/Los_Angeles'], // Las Vegas
    [47.6062, -122.3321, 'America/Los_Angeles'], // Seattle
    [45.5152, -122.6784, 'America/Los_Angeles'], // Portland
  ];

  for (const [lat, lng, zone] of cases) assert.equal(zoneOf(at(lat, lng)), zone, `${lat}, ${lng}`);
});

test('Arizona has a zone of its own, because it does not change its clocks', () => {
  assert.equal(zoneOf(at(33.4484, -112.074)), 'America/Phoenix');
  assert.equal(zoneOf(at(32.2226, -110.9747)), 'America/Phoenix');
});

test('Alaska, Hawaii and Canada are covered', () => {
  assert.equal(zoneOf(at(61.2181, -149.9003)), 'America/Anchorage');
  assert.equal(zoneOf(at(21.3069, -157.8583)), 'Pacific/Honolulu');
  assert.equal(zoneOf(at(43.6532, -79.3832)), 'America/New_York'); // Toronto keeps the same clock
  assert.equal(zoneOf(at(49.2827, -123.1207)), 'America/Los_Angeles'); // Vancouver
  assert.equal(zoneOf(at(44.6488, -63.5752)), 'America/Halifax');
});

test('a Hungarian coordinate is on the Central European clock', () => {
  assert.equal(zoneOf(BUDAPEST), 'Europe/Budapest');
  assert.equal(zoneOf(at(46.253, 20.1414)), 'Europe/Budapest'); // Szeged
});

test('the other countries of the lead list get their own clock', () => {
  assert.equal(zoneOf(at(51.5074, -0.1278)), 'Europe/London');
  assert.equal(zoneOf(at(38.7223, -9.1393)), 'Europe/Lisbon');
  assert.equal(zoneOf(at(37.9838, 23.7275)), 'Europe/Athens');
  assert.equal(zoneOf(at(48.8566, 2.3522)), 'Europe/Budapest'); // Paris: the same clock as Budapest
  assert.equal(zoneOf(at(22.3193, 114.1694)), 'Asia/Hong_Kong');
  assert.equal(zoneOf(at(25.033, 121.5654)), 'Asia/Taipei');
});

test('a Hungarian address without coordinates is recognised from its text', () => {
  assert.equal(zoneOf({ address: 'Budapest, Váci út 1, 1132 Hungary' }), 'Europe/Budapest');
  assert.equal(zoneOf({ lat: null, lng: null, address: 'Szeged, Kárász u. 5, 6720 Magyarország.' }), 'Europe/Budapest');
});

test('a lead with no coordinates and no known address has no zone, without an error', () => {
  for (const lead of [{}, null, undefined, { lat: null, lng: null }, { lat: 0, lng: 0 }, { lat: 'x', lng: 'y', address: 'somewhere' }]) {
    assert.equal(zoneOf(lead), '');
  }
});

test('a lead without a zone is never inside the window and has no next opening', () => {
  for (const moment of [TUESDAY, SATURDAY, new Date('2026-10-20T03:00:00.000Z')]) assert.equal(isInsideWindow({}, SENDER, moment), false);
  assert.equal(nextOpening({}, SENDER, TUESDAY), null);
});

test('a zone stored on the lead is used as it is', () => {
  assert.equal(zoneOf({ ...NEW_YORK, seq: { tz: 'America/Denver' } }), 'America/Denver');
});

test('at 14:00 in Budapest only the east coast and the central zone are inside the window', () => {
  const open = [NEW_YORK, CHICAGO, DENVER, LOS_ANGELES].map((l) => isInsideWindow(l, SENDER, TUESDAY));

  assert.deepEqual(open, [true, true, false, false]);
});

test('on a Saturday nobody is inside the default window', () => {
  for (const lead of [NEW_YORK, CHICAGO, DENVER, LOS_ANGELES, BUDAPEST]) assert.equal(isInsideWindow(lead, SENDER, SATURDAY), false);
});

test('the window ends at its last hour on the recipient\'s clock', () => {
  // 18:59 and 19:00 in New York (EDT, UTC-4)
  assert.equal(isInsideWindow(NEW_YORK, SENDER, new Date('2026-10-20T22:59:00.000Z')), true);
  assert.equal(isInsideWindow(NEW_YORK, SENDER, new Date('2026-10-20T23:00:00.000Z')), false);
});

test('the weekday is the recipient\'s weekday, not the server\'s', () => {
  // Saturday 01:00 UTC is still Friday 18:00 in Los Angeles
  assert.equal(isInsideWindow(LOS_ANGELES, SENDER, new Date('2026-10-24T01:00:00.000Z')), true);
  // Monday 06:00 UTC is Monday 08:00 in Budapest, but still Sunday in Los Angeles
  assert.equal(isInsideWindow(BUDAPEST, SENDER, new Date('2026-10-26T07:00:00.000Z')), true);
  assert.equal(isInsideWindow(LOS_ANGELES, SENDER, new Date('2026-10-26T07:00:00.000Z')), false);
});

test('a sender can have days and hours of its own', () => {
  const sender = { sendDays: [6], windowFrom: 10, windowTo: 12 };

  assert.deepEqual(windowOf(sender), { days: [6], from: 10, to: 12 });
  assert.equal(isInsideWindow(BUDAPEST, sender, new Date('2026-10-24T08:30:00.000Z')), true); // Saturday 10:30 in Budapest
  assert.equal(isInsideWindow(BUDAPEST, sender, TUESDAY), false);
});

test('Arizona stays an hour behind Denver in summer', () => {
  // 13:30 UTC in July: 7:30 in Denver (MDT), 6:30 in Phoenix (MST)
  const july = new Date('2026-07-14T13:30:00.000Z');

  assert.equal(isInsideWindow(DENVER, SENDER, july), true);
  assert.equal(isInsideWindow(at(33.4484, -112.074), SENDER, july), false);
});

test('the next opening is now when the window is open', () => {
  assert.equal(nextOpening(NEW_YORK, SENDER, TUESDAY).toISOString(), TUESDAY.toISOString());
});

test('the next opening for a lead still asleep is 7:00 on its own clock', () => {
  // Los Angeles is at 5:00; 7:00 PDT is 14:00 UTC
  assert.equal(nextOpening(LOS_ANGELES, SENDER, TUESDAY).toISOString(), '2026-10-20T14:00:00.000Z');
});

test('after Friday evening the next opening is Monday morning', () => {
  // Friday 20:00 in Budapest; Monday 26 October is after the clock change, so 7:00 CET is 06:00 UTC
  const next = nextOpening(BUDAPEST, SENDER, new Date('2026-10-23T18:00:00.000Z'));

  assert.equal(next.toISOString(), '2026-10-26T06:00:00.000Z');
});

test('a window that never opens has no next opening', () => {
  assert.equal(nextOpening(BUDAPEST, { windowFrom: 9, windowTo: 9 }, TUESDAY), null);
});

test('zonesOpenNow keeps the zones where it is a sending hour', () => {
  const zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Budapest', 'America/New_York'];

  assert.deepEqual(zonesOpenNow(zones, SENDER, TUESDAY), ['America/New_York', 'America/Chicago', 'Europe/Budapest']);
});

test('an unknown stored zone does not break the check', () => {
  assert.equal(typeof isInsideWindow({ seq: { tz: 'Mars/Olympus' } }, SENDER, TUESDAY), 'boolean');
});

test('test mode sends without a window but at most three emails', () => {
  assert.deepEqual(runLimits({ testMode: true }), { checkWindow: false, maxSends: TEST_MODE_MAX });
  assert.equal(TEST_MODE_MAX, 3);
});

test('ignoreWindow drops the window and nothing else; by default the window is checked', () => {
  assert.deepEqual(runLimits({ ignoreWindow: true }), { checkWindow: false, maxSends: null });
  assert.deepEqual(runLimits({}), { checkWindow: true, maxSends: null });
  assert.deepEqual(runLimits(), { checkWindow: true, maxSends: null });
});

test('every zone the lookup can answer with is in the list the dispatcher asks about', () => {
  const places = [NEW_YORK, CHICAGO, DENVER, LOS_ANGELES, BUDAPEST, at(33.4484, -112.074), at(61.2181, -149.9003), at(21.3069, -157.8583), at(44.6488, -63.5752), at(51.5074, -0.1278), at(38.7223, -9.1393), at(37.9838, 23.7275), at(22.3193, 114.1694), at(25.033, 121.5654), at(50.4452, -104.6189), at(47.5615, -52.7126)];

  for (const p of places) assert.ok(ALL_ZONES.includes(zoneOf(p)), zoneOf(p));
});
