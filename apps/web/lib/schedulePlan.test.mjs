import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP_MAX_MS, GAP_MIN_MS, capacityPlan, daysAhead, fillSchedule, parseDay, roomFor } from './schedulePlan.mjs';

// a Wednesday, 10:00 in Budapest
const NOW = new Date('2026-10-21T08:00:00.000Z');
const sender = (senderId, language, over = {}) => ({ senderId, language, dailyLimit: 100, firstSendAt: '', warmup: { enabled: false, tiers: [] }, ...over });
const lead = (key, language = 'hu', tz = 'Europe/Budapest') => ({ key, language, tz });
const leads = (n, language, tz) => Array.from({ length: n }, (_, i) => lead(`${language || 'hu'}${i}`, language, tz));
const opts = (over = {}) => ({ fromDay: '2026-10-21', toDay: '2026-12-31', now: NOW, random: () => 0, ...over });

test('daysAhead lists calendar days in Budapest, across the clock change', () => {
  const days = daysAhead(NOW, 6);
  assert.deepEqual(days.map((d) => d.day), ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  assert.equal(new Date(days[0].start).toISOString(), '2026-10-20T22:00:00.000Z');
  // the clocks go back on the 25th: that day is 25 hours long and the next starts at 23:00 UTC
  assert.equal(days[4].end - days[4].start, 25 * 3_600_000);
  assert.equal(new Date(days[5].start).toISOString(), '2026-10-25T23:00:00.000Z');
});

test('a day off has no room, a sending day has the limit', () => {
  const cap = capacityPlan([sender('a', 'hu', { dailyLimit: 40 })], daysAhead(NOW, 6));
  assert.deepEqual(cap.get('a').map((r) => r.free), [40, 40, 40, 0, 0, 40]);
  assert.deepEqual(cap.get('a').map((r) => r.open), [true, true, true, false, false, true]);
});

test('the limit of a later day follows the warm-up tiers', () => {
  const s = sender('a', 'hu', { firstSendAt: '2026-10-16T08:00:00.000Z', warmup: { enabled: true, tiers: [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }] } });
  // day 5, 6 and 7 since the first send: the tier changes on Friday
  assert.deepEqual(capacityPlan([s], daysAhead(NOW, 3)).get('a').map((r) => r.cap), [10, 10, 20]);
});

test('an account that never sent starts its tiers on the first sending day', () => {
  const s = sender('a', 'hu', { warmup: { enabled: true, tiers: [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 2, dailyLimit: 20 }] } });
  assert.deepEqual(capacityPlan([s], daysAhead(NOW, 3)).get('a').map((r) => r.cap), [10, 10, 20]);
});

test('sent today and leads already due take room, and what does not fit moves on', () => {
  const booked = new Map([['a', new Map([['2026-10-21', 8], ['2026-10-22', 3], ['2026-10-24', 2]])]]);
  const rows = capacityPlan([sender('a', 'hu', { dailyLimit: 10 })], daysAhead(NOW, 6), { booked, sentToday: new Map([['a', 5]]) }).get('a');
  // today 5 sent + 8 due = 13 of 10, so 3 move to Thursday beside its own 3; Saturday's 2 wait for Monday
  assert.deepEqual(rows.map((r) => r.booked), [13, 6, 0, 2, 2, 2]);
  assert.deepEqual(rows.map((r) => r.free), [0, 4, 10, 0, 0, 8]);
});

test('leads fill the earliest days first and stop at the last day of the range', () => {
  const senders = [sender('a', 'hu', { dailyLimit: 2 })];
  const cap = capacityPlan(senders, daysAhead(NOW, 10));
  const r = fillSchedule(leads(7), senders, cap, opts({ toDay: '2026-10-26' }));
  // Wed, Thu, Fri, then Monday; the weekend is skipped; 2 a day
  assert.deepEqual(r.placed.map((p) => p.day), ['2026-10-21', '2026-10-21', '2026-10-22', '2026-10-22', '2026-10-23', '2026-10-23', '2026-10-26']);
  const short = fillSchedule(leads(7), senders, cap, opts({ toDay: '2026-10-22' }));
  assert.equal(short.placed.length, 4);
  assert.deepEqual(short.left, ['hu4', 'hu5', 'hu6']);
});

test('fewer leads than room: all of them go in, on the first days', () => {
  const senders = [sender('a', 'hu', { dailyLimit: 40 }), sender('b', 'hu', { dailyLimit: 40 })];
  const r = fillSchedule(leads(50), senders, capacityPlan(senders, daysAhead(NOW, 10)), opts());
  assert.equal(r.left.length, 0);
  assert.equal(r.placed.filter((p) => p.day === '2026-10-21').length, 50);
  // spread between the two accounts, not one filled before the other gets any
  assert.equal(r.filled.get('a').get('2026-10-21'), 25);
  assert.equal(r.filled.get('b').get('2026-10-21'), 25);
});

test('a lead only goes to a sender of its language', () => {
  const senders = [sender('hu1', 'hu', { dailyLimit: 1 }), sender('en1', 'en', { dailyLimit: 3 })];
  const cap = capacityPlan(senders, daysAhead(NOW, 3));
  const r = fillSchedule([...leads(2, 'hu'), ...leads(2, 'en', 'America/New_York'), lead('x', 'de')], senders, cap, opts());
  assert.deepEqual(r.placed.map((p) => [p.key, p.senderId, p.day]), [['hu0', 'hu1', '2026-10-21'], ['hu1', 'hu1', '2026-10-22'], ['en0', 'en1', '2026-10-21'], ['en1', 'en1', '2026-10-21']]);
  assert.deepEqual(r.left, ['x']);
  assert.equal(roomFor('en', senders, cap, '2026-10-21', '2026-10-23'), 9);
  assert.equal(roomFor('hu', senders, cap, '2026-10-22', '2026-10-23'), 2);
});

test('the due time is a sending hour where the lead is, inside the day', () => {
  const senders = [sender('a', 'en', { dailyLimit: 1 })];
  const cap = capacityPlan(senders, daysAhead(NOW, 3));
  const r = fillSchedule(leads(2, 'en', 'America/New_York'), senders, cap, opts());
  // today: New York is at 4:00, its window opens at 7:00 = 11:00 UTC; tomorrow the same
  assert.deepEqual(r.placed.map((p) => p.at), ['2026-10-21T11:00:00.000Z', '2026-10-22T11:00:00.000Z']);
  // a lead whose window is open now is due now
  const hu = fillSchedule(leads(1, 'en'), senders, cap, opts());
  assert.equal(hu.placed[0].at, NOW.toISOString());
});

test('a range that starts later leaves the days before it alone', () => {
  const senders = [sender('a', 'hu', { dailyLimit: 5 })];
  const r = fillSchedule(leads(3), senders, capacityPlan(senders, daysAhead(NOW, 10)), opts({ fromDay: '2026-10-26', toDay: '2026-10-27' }));
  assert.deepEqual(r.placed.map((p) => p.day), ['2026-10-26', '2026-10-26', '2026-10-26']);
  assert.equal(r.placed[0].at, '2026-10-26T06:00:00.000Z');
});

test('parseDay takes a real calendar day only', () => {
  assert.equal(parseDay('2026-10-21'), '2026-10-21');
  assert.equal(parseDay('2026-02-30'), '');
  assert.equal(parseDay('21/10/2026'), '');
  assert.equal(parseDay(undefined), '');
});

// a repeatable stand-in for Math.random
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test('the emails of a sender on one day are 10 to 20 minutes apart, never evenly', () => {
  const senders = [sender('a', 'hu', { dailyLimit: 15 }), sender('b', 'hu', { dailyLimit: 15 })];
  const r = fillSchedule(leads(30), senders, capacityPlan(senders, daysAhead(NOW, 3)), opts({ random: seeded(7) }));
  assert.equal(r.placed.filter((p) => p.day === '2026-10-21').length, 30);
  for (const id of ['a', 'b']) {
    const times = r.placed.filter((p) => p.senderId === id).map((p) => Date.parse(p.at));
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    assert.equal(gaps.length, 14);
    assert.ok(gaps.every((g) => g >= GAP_MIN_MS && g <= GAP_MAX_MS), gaps.join(' '));
    assert.ok(new Set(gaps).size > 10);
    // not on the minute
    assert.ok(times.some((t) => t % 60_000 !== 0));
  }
});

test('new leads follow the ones already booked on the day', () => {
  const senders = [sender('a', 'hu', { dailyLimit: 10 })];
  const booked = Date.parse('2026-10-22T07:30:00.000Z');
  const cap = capacityPlan(senders, daysAhead(NOW, 3), { booked: new Map([['a', new Map([['2026-10-22', 3]])]]), lastDue: new Map([['a', new Map([['2026-10-22', booked]])]]) });
  const r = fillSchedule(leads(2), senders, cap, opts({ fromDay: '2026-10-22' }));
  assert.deepEqual(r.placed.map((p) => Date.parse(p.at) - booked), [GAP_MIN_MS, 2 * GAP_MIN_MS]);
});

test('a day whose sending hours are used up takes no more, whatever its limit', () => {
  // 18:30 in Budapest: the window closes at 19:00, so three emails fit at 10 minutes
  const late = new Date('2026-10-21T16:30:00.000Z');
  const senders = [sender('a', 'hu', { dailyLimit: 50 })];
  const r = fillSchedule(leads(5), senders, capacityPlan(senders, daysAhead(late, 3)), opts({ now: late }));
  assert.deepEqual(r.placed.map((p) => p.day), ['2026-10-21', '2026-10-21', '2026-10-21', '2026-10-22', '2026-10-22']);
  assert.equal(r.placed[2].at, '2026-10-21T16:50:00.000Z');
  assert.equal(r.placed[3].at, '2026-10-22T05:00:00.000Z');
});
