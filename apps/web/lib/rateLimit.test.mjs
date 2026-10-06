import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limit, resetLimits } from './rateLimit.mjs';

test('allows up to max calls in the window, then blocks', () => {
  resetLimits();
  for (let i = 0; i < 3; i++) assert.equal(limit('a', 3, 1000, 100 + i).ok, true);
  const r = limit('a', 3, 1000, 200);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfter, 1); // oldest call at 100 leaves the window at 1100
});

test('a blocked call does not extend the block', () => {
  resetLimits();
  limit('a', 1, 1000, 0);
  assert.equal(limit('a', 1, 1000, 500).ok, false);
  assert.equal(limit('a', 1, 1000, 900).ok, false);
  assert.equal(limit('a', 1, 1000, 1001).ok, true);
});

test('keys are counted separately', () => {
  resetLimits();
  assert.equal(limit('a', 1, 1000, 0).ok, true);
  assert.equal(limit('b', 1, 1000, 0).ok, true);
  assert.equal(limit('a', 1, 1000, 1).ok, false);
});

test('retryAfter is whole seconds, rounded up', () => {
  resetLimits();
  limit('a', 1, 15 * 60_000, 0);
  assert.equal(limit('a', 1, 15 * 60_000, 1).retryAfter, 900);
});
