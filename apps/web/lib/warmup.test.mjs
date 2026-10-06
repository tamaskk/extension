import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIERS, DEFAULT_DAILY_LIMIT, IDLE_DAYS, dayKey, daysBetween, dayStart,
  validateWarmup, normalizeTiers, warmupStatus, dailyCapFor, describeWarmup,
} from './warmup.mjs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const sender = (over = {}) => ({ dailyLimit: 100, firstSendAt: daysAgo(8), warmup: { enabled: true, tiers: DEFAULT_TIERS }, ...over });

test('a first send 8 days ago puts the account on the second tier: 20 a day', () => {
  assert.equal(dailyCapFor(sender(), NOW), 20);
});

test('with the day-7 tier removed the same account is back at 10 a day', () => {
  const tiers = DEFAULT_TIERS.filter((t) => t.fromDay !== 7);

  assert.equal(dailyCapFor(sender({ warmup: { enabled: true, tiers } }), NOW), 10);
});

test('the last tier holds for good', () => {
  const tiers = [...DEFAULT_TIERS, { fromDay: 60, dailyLimit: 50 }];

  assert.equal(dailyCapFor(sender({ firstSendAt: daysAgo(70), warmup: { enabled: true, tiers } }), NOW), 50);
  assert.equal(dailyCapFor(sender({ firstSendAt: daysAgo(4000), warmup: { enabled: true, tiers } }), NOW), 50);
});

test('the account\'s own ceiling wins over a higher tier', () => {
  const s = sender({ dailyLimit: 25, firstSendAt: daysAgo(30) });

  assert.equal(dailyCapFor(s, NOW), 25);
});

test('an account that has sent nothing yet is on the first tier', () => {
  assert.equal(dailyCapFor(sender({ firstSendAt: '' }), NOW), 10);
  assert.equal(warmupStatus(sender({ firstSendAt: '' }), NOW).day, null);
});

test('the first tier is still held back by a lower ceiling', () => {
  assert.equal(dailyCapFor(sender({ firstSendAt: '', dailyLimit: 5 }), NOW), 5);
});

test('with the warm-up off or empty the ceiling is the limit', () => {
  assert.equal(dailyCapFor(sender({ warmup: { enabled: false, tiers: DEFAULT_TIERS } }), NOW), 100);
  assert.equal(dailyCapFor(sender({ warmup: { enabled: true, tiers: [] } }), NOW), 100);
  assert.equal(dailyCapFor(sender({ warmup: undefined }), NOW), 100);
});

test('an account without a ceiling gets the default one', () => {
  assert.equal(dailyCapFor({ warmup: { enabled: false, tiers: [] } }, NOW), DEFAULT_DAILY_LIMIT);
});

test('a ceiling of 0 stops the account', () => {
  assert.equal(dailyCapFor(sender({ dailyLimit: 0 }), NOW), 0);
});

test('a tier lower than the one before it is followed: stepping back works', () => {
  const tiers = [{ fromDay: 0, dailyLimit: 30 }, { fromDay: 5, dailyLimit: 10 }];

  assert.equal(dailyCapFor(sender({ warmup: { enabled: true, tiers } }), NOW), 10);
});

test('the tier changes exactly on its start day', () => {
  assert.equal(dailyCapFor(sender({ firstSendAt: daysAgo(6) }), NOW), 10);
  assert.equal(dailyCapFor(sender({ firstSendAt: daysAgo(7) }), NOW), 20);
  assert.equal(dailyCapFor(sender({ firstSendAt: daysAgo(21) }), NOW), 35);
});

test('the day turns at midnight in Budapest, not in UTC', () => {
  // 22:30 UTC on 6 October is already 00:30 on the 7th in Budapest (UTC+2)
  assert.equal(dayKey(new Date('2026-10-06T22:30:00.000Z')), '2026-10-07');
  assert.equal(dayKey(new Date('2026-10-06T21:30:00.000Z')), '2026-10-06');
});

test('days are calendar days: a send late at night is a day old the next morning', () => {
  const first = '2026-10-06T21:50:00.000Z'; // 23:50 in Budapest

  assert.equal(daysBetween(first, new Date('2026-10-06T21:55:00.000Z')), 0);
  assert.equal(daysBetween(first, new Date('2026-10-06T22:10:00.000Z')), 1);
});

test('the clock change in autumn neither skips a day nor counts one twice', () => {
  // Budapest goes from UTC+2 to UTC+1 on 25 October 2026: that day lasts 25 hours
  const first = '2026-10-24T10:00:00.000Z';

  assert.equal(daysBetween(first, new Date('2026-10-25T22:30:00.000Z')), 1); // 23:30 on the 25th
  assert.equal(daysBetween(first, new Date('2026-10-25T23:30:00.000Z')), 2); // 00:30 on the 26th
});

test('the clock change in spring neither skips a day nor counts one twice', () => {
  // Budapest goes from UTC+1 to UTC+2 on 29 March 2026: that day lasts 23 hours
  const first = '2026-03-28T10:00:00.000Z';

  assert.equal(daysBetween(first, new Date('2026-03-29T21:30:00.000Z')), 1); // 23:30 on the 29th
  assert.equal(daysBetween(first, new Date('2026-03-29T22:30:00.000Z')), 2); // 00:30 on the 30th
});

test('daysBetween gives null for a date it cannot read', () => {
  assert.equal(daysBetween('', NOW), null);
  assert.equal(daysBetween('soon', NOW), null);
});

test('today starts at midnight in Budapest, in summer and in winter time', () => {
  assert.equal(dayStart(new Date('2026-10-20T10:00:00.000Z')).toISOString(), '2026-10-19T22:00:00.000Z');
  assert.equal(dayStart(new Date('2026-12-01T10:00:00.000Z')).toISOString(), '2026-11-30T23:00:00.000Z');
});

test('today starts at the right instant on both clock-change days', () => {
  assert.equal(dayStart(new Date('2026-10-25T15:00:00.000Z')).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(dayStart(new Date('2026-03-29T15:00:00.000Z')).toISOString(), '2026-03-28T23:00:00.000Z');
});

test('the default tiers are sound', () => {
  assert.equal(validateWarmup(DEFAULT_TIERS), null);
});

test('a warm-up needs at least one tier', () => {
  assert.match(validateWarmup([]), /at least one tier/);
  assert.match(validateWarmup(undefined), /at least one tier/);
});

test('the first tier must start on day 0', () => {
  assert.match(validateWarmup([{ fromDay: 3, dailyLimit: 10 }]), /start on day 0/);
});

test('start day and limit must be whole numbers, 0 or more', () => {
  for (const bad of [1.5, -1, '7', NaN, null]) {
    assert.match(validateWarmup([{ fromDay: 0, dailyLimit: 10 }, { fromDay: bad, dailyLimit: 10 }]), /start day/, String(bad));
    assert.match(validateWarmup([{ fromDay: 0, dailyLimit: bad }]), /daily limit/, String(bad));
  }
});

test('two tiers on the same day are an error', () => {
  assert.match(validateWarmup([{ fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }, { fromDay: 7, dailyLimit: 25 }]), /Two tiers start on day 7/);
});

test('a tier lower than the one before it passes validation', () => {
  assert.equal(validateWarmup([{ fromDay: 0, dailyLimit: 30 }, { fromDay: 5, dailyLimit: 10 }]), null);
});

test('normalizeTiers sorts by start day and keeps only the two fields', () => {
  const tiers = normalizeTiers([{ fromDay: '14', dailyLimit: '30', junk: 1 }, { fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }]);

  assert.deepEqual(tiers, [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }, { fromDay: 14, dailyLimit: 30 }]);
});

test('the status line says the same number as dailyCapFor', () => {
  for (const s of [sender(), sender({ firstSendAt: '' }), sender({ dailyLimit: 25, firstSendAt: daysAgo(30) }), sender({ warmup: { enabled: false, tiers: [] } })]) {
    assert.ok(describeWarmup(s, NOW).includes(`${dailyCapFor(s, NOW)} a day`));
  }
});

test('the status line names the ceiling when it holds a tier back', () => {
  const line = describeWarmup(sender({ dailyLimit: 25, firstSendAt: daysAgo(30) }), NOW);

  assert.match(line, /the tier allows 35, the ceiling of 25 holds it back/);
});

test('an account that was silent for more than 3 days comes back one tier lower', () => {
  // day 30 would be 35 a day; its last email was 4 days ago
  const s = sender({ firstSendAt: daysAgo(30), lastSentBeforeToday: daysAgo(4) });

  const status = warmupStatus(s, NOW);

  assert.equal(IDLE_DAYS, 3);
  assert.equal(status.cap, 30);
  assert.equal(status.steppedBack, true);
  assert.equal(status.idleDays, 4);
  assert.match(describeWarmup(s, NOW), /Stepped back one tier, because it sent nothing for 4 days/);
});

test('a pause of 3 days or less changes nothing', () => {
  for (const days of [1, 2, 3]) {
    const status = warmupStatus(sender({ firstSendAt: daysAgo(30), lastSentBeforeToday: daysAgo(days) }), NOW);

    assert.equal(status.cap, 35, `${days} days`);
    assert.equal(status.steppedBack, false);
  }
});

test('an account on the first tier cannot step back further', () => {
  const status = warmupStatus(sender({ firstSendAt: daysAgo(2), lastSentBeforeToday: daysAgo(10) }), NOW);

  assert.equal(status.cap, 10);
  assert.equal(status.steppedBack, false);
});

test('an account whose last send is not known is not stepped back', () => {
  assert.equal(warmupStatus(sender({ firstSendAt: daysAgo(30) }), NOW).steppedBack, false);
  assert.equal(warmupStatus(sender({ firstSendAt: daysAgo(30), lastSentBeforeToday: '' }), NOW).cap, 35);
});

test('a step back never lifts the limit, also when the tier below allows more', () => {
  const tiers = [{ fromDay: 0, dailyLimit: 30 }, { fromDay: 5, dailyLimit: 10 }];

  const status = warmupStatus(sender({ firstSendAt: daysAgo(30), lastSentBeforeToday: daysAgo(9), warmup: { enabled: true, tiers } }), NOW);

  assert.equal(status.cap, 10);
});

test('the step back never lifts a limit above the ceiling', () => {
  assert.equal(dailyCapFor(sender({ dailyLimit: 12, firstSendAt: daysAgo(30), lastSentBeforeToday: daysAgo(9) }), NOW), 12);
});
