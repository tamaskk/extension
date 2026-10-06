import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHT, variantGroup, pickVariant, enoughData } from './outreachVariant.mjs';

const step = (id, over = {}) => ({ id, delayDays: 0, subject: `S ${id}`, body: `B ${id}`, sameThread: false, enabled: true, ...over });
const keys = (n) => Array.from({ length: n }, (_, i) => `0x47${(i * 2654435761 >>> 0).toString(16)}:0x${i.toString(16)}`);
const share = (steps, parentId, list) => {
  const counts = {};
  for (const k of list) { const id = pickVariant(steps, parentId, k).id; counts[id] = (counts[id] || 0) + 1; }
  return counts;
};

test('a step without variants is always itself', () => {
  const steps = [step('a'), step('b')];

  for (const k of keys(20)) assert.equal(pickVariant(steps, 'a', k).id, 'a');
});

test('two wordings at 50 to 50 split 200 leads about in half', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a' })];

  const counts = share(steps, 'a', keys(200));

  assert.equal(counts.a + counts.a2, 200);
  assert.ok(counts.a > 75 && counts.a < 125, `a got ${counts.a}`);
});

test('weights of 80 and 20 are followed', () => {
  const steps = [step('a', { weight: 80 }), step('a2', { variantOf: 'a', weight: 20 })];

  const counts = share(steps, 'a', keys(1000));

  assert.ok(counts.a > 740 && counts.a < 860, `a got ${counts.a}`);
});

test('the same lead always gets the same wording', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a' }), step('a3', { variantOf: 'a' })];

  const first = keys(300).map((k) => pickVariant(steps, 'a', k).id);
  const second = keys(300).map((k) => pickVariant(steps.slice().reverse().reverse(), 'a', k).id);

  assert.deepEqual(first, second);
});

test('a variant that is switched off is never picked', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a', enabled: false })];

  assert.deepEqual(share(steps, 'a', keys(200)), { a: 200 });
});

test('any number of variants can share a step', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a' }), step('a3', { variantOf: 'a' }), step('a4', { variantOf: 'a' })];

  const counts = share(steps, 'a', keys(800));

  assert.equal(Object.keys(counts).length, 4);
  for (const n of Object.values(counts)) assert.ok(n > 140 && n < 260, `one wording got ${n}`);
});

test('a wording without a weight counts as the default', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a', weight: DEFAULT_WEIGHT })];

  const counts = share(steps, 'a', keys(400));

  assert.ok(counts.a > 160 && counts.a < 240);
});

test('variants of another step are not in the group', () => {
  const steps = [step('a'), step('b'), step('b2', { variantOf: 'b' })];

  assert.deepEqual(variantGroup(steps, 'a').map((s) => s.id), ['a']);
  assert.deepEqual(variantGroup(steps, 'b').map((s) => s.id), ['b', 'b2']);
});

test('a step that does not exist, or a variant asked for as a step, gives nothing', () => {
  const steps = [step('a'), step('a2', { variantOf: 'a' })];

  assert.equal(pickVariant(steps, 'zz', 'k1'), null);
  assert.equal(pickVariant(steps, 'a2', 'k1'), null);
});

test('fewer than 100 sends is too little data', () => {
  assert.equal(enoughData(99), false);
  assert.equal(enoughData(100), true);
  assert.equal(enoughData(undefined), false);
});
