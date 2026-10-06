import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DELAY_MS, MIN_DELAY_MS, MAX_DELAY_MS,
  nextDelay, backoffDelay, lockIsFree, appendLog, longestGapMs,
} from './outreachRunner.mjs';

test('nextDelay follows the server hint inside the allowed range', () => {
  assert.equal(nextDelay(30_000), 30_000);
  assert.equal(nextDelay(1_000), MIN_DELAY_MS);
  assert.equal(nextDelay(3_600_000), MAX_DELAY_MS);
});

test('nextDelay falls back to the default rhythm on a missing or broken hint', () => {
  for (const v of [undefined, null, 0, -5, NaN, 'soon', {}]) assert.equal(nextDelay(v), DEFAULT_DELAY_MS);
});

test('the watchdog limit of 10 minutes is never reached by a planned wait', () => {
  assert.ok(MAX_DELAY_MS < 10 * 60_000);
});

test('backoff grows 30 s, 1 min, 2 min, 5 min and then stays at 5 min', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 50].map(backoffDelay), [30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
  assert.equal(backoffDelay(0), 30_000);
});

test('a tab may run when the lock is missing, its own, or run out', () => {
  assert.equal(lockIsFree(null, 'a', 100), true);
  assert.equal(lockIsFree({ id: 'a', until: 500 }, 'a', 100), true);
  assert.equal(lockIsFree({ id: 'b', until: 100 }, 'a', 100), true);
  assert.equal(lockIsFree({ id: 'b', until: 500 }, 'a', 100), false);
});

test('a damaged lock does not block the loop', () => {
  assert.equal(lockIsFree({ id: 'b' }, 'a', 100), true);
  assert.equal(lockIsFree('junk', 'a', 100), true);
});

test('appendLog keeps the newest entries up to the cap', () => {
  let log = [];
  for (let i = 1; i <= 5; i++) log = appendLog(log, { at: i }, 3);
  assert.deepEqual(log.map((e) => e.at), [3, 4, 5]);
});

test('appendLog does not change the log it was given', () => {
  const log = [{ at: 1 }];
  appendLog(log, { at: 2 });
  assert.equal(log.length, 1);
});

test('longestGapMs is the longest pause between neighbouring ticks', () => {
  assert.equal(longestGapMs([]), 0);
  assert.equal(longestGapMs([{ at: 10 }]), 0);
  assert.equal(longestGapMs([{ at: 0 }, { at: 45 }, { at: 700 }, { at: 745 }]), 655);
});
