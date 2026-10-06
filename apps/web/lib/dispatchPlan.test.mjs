import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingToday, assignSenders, companyDomainOf, pickOnePerDomain, domainHeldByAnother, minGapMs, gapState } from './dispatchPlan.mjs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
// a sender whose limit is simply its ceiling
const sender = (senderId, dailyLimit, over = {}) => ({ senderId, active: true, dailyLimit, firstSendAt: '', warmup: { enabled: false, tiers: [] }, ...over });
const keys = (n) => Array.from({ length: n }, (_, i) => `0x89c25${i.toString(16)}:0x${(i * 7919).toString(16)}`);
const share = (map, id) => [...map.values()].filter((v) => v === id).length;

test('what is left today is the limit minus what went out', () => {
  assert.equal(remainingToday(sender('a', 35), 12, NOW), 23);
});

test('what is left never goes below 0', () => {
  assert.equal(remainingToday(sender('a', 10), 10, NOW), 0);
  assert.equal(remainingToday(sender('a', 10), 14, NOW), 0);
});

test('what is left follows the warm-up tier, not only the ceiling', () => {
  const warming = sender('a', 100, { warmup: { enabled: true, tiers: [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 7, dailyLimit: 20 }] } });

  assert.equal(remainingToday(warming, 4, NOW), 6);
});

test('a sender on 10 a day and one on 35 a day share 1000 leads about 1 to 3.5', () => {
  const map = assignSenders(keys(1000), [sender('small', 10), sender('big', 35)], NOW);

  const small = share(map, 'small');
  assert.equal(map.size, 1000);
  assert.ok(small > 180 && small < 265, `small got ${small}`); // 10 / 45 of 1000 is 222
  assert.equal(small + share(map, 'big'), 1000);
});

test('the same input gives the same assignment', () => {
  const senders = [sender('small', 10), sender('big', 35)];

  const first = assignSenders(keys(500), senders, NOW);
  const second = assignSenders(keys(500).reverse(), senders.slice().reverse(), NOW);

  for (const k of keys(500)) assert.equal(first.get(k), second.get(k));
});

test('adding a sender moves leads only to the new one', () => {
  const before = assignSenders(keys(600), [sender('a', 20), sender('b', 20)], NOW);

  const after = assignSenders(keys(600), [sender('a', 20), sender('b', 20), sender('c', 20)], NOW);

  for (const k of keys(600)) assert.ok(after.get(k) === before.get(k) || after.get(k) === 'c');
  assert.ok(share(after, 'c') > 140 && share(after, 'c') < 260);
});

test('a sender that is switched off or has no room gets nothing', () => {
  const map = assignSenders(keys(200), [sender('on', 20), sender('off', 20, { active: false }), sender('zero', 0)], NOW);

  assert.equal(share(map, 'on'), 200);
});

test('with no usable sender nothing is assigned', () => {
  assert.equal(assignSenders(keys(5), [], NOW).size, 0);
  assert.equal(assignSenders(keys(5), [sender('off', 20, { active: false })], NOW).size, 0);
});

test('a single sender gets everything', () => {
  assert.equal(share(assignSenders(keys(50), [sender('only', 10)], NOW), 'only'), 50);
});

test('a company address gives its domain, a mailbox provider gives none', () => {
  assert.equal(companyDomainOf('Info@Pizzeria-Roma.hu'), 'pizzeria-roma.hu');
  assert.equal(companyDomainOf('someone@gmail.com'), '');
  assert.equal(companyDomainOf('valaki@freemail.hu'), '');
  assert.equal(companyDomainOf('not an address'), '');
});

test('of two leads at the same company domain only the first is taken', () => {
  const candidates = [{ key: 'k1', email: 'budapest@pizzeria-roma.hu' }, { key: 'k2', email: 'gyor@pizzeria-roma.hu' }];

  const { take, skipped } = pickOnePerDomain(candidates, new Set());

  assert.deepEqual(take.map((c) => c.key), ['k1']);
  assert.deepEqual(skipped, [{ key: 'k2', domain: 'pizzeria-roma.hu' }]);
});

test('two leads with gmail.com addresses are both taken', () => {
  const candidates = [{ key: 'k1', email: 'anna@gmail.com' }, { key: 'k2', email: 'bela@gmail.com' }];

  const { take, skipped } = pickOnePerDomain(candidates, new Set());

  assert.equal(take.length, 2);
  assert.deepEqual(skipped, []);
});

test('a lead is held back when its company domain already has a running sequence', () => {
  const candidates = [{ key: 'k1', email: 'info@pizzeria-roma.hu' }, { key: 'k2', email: 'hello@other.hu' }];

  const { take, skipped } = pickOnePerDomain(candidates, new Map([['pizzeria-roma.hu', ['k0']]]));

  assert.deepEqual(take.map((c) => c.key), ['k2']);
  assert.deepEqual(skipped, [{ key: 'k1', domain: 'pizzeria-roma.hu' }]);
});

test('before a send, a lead is not held back by its own running sequence', () => {
  const active = new Map([['pizzeria-roma.hu', ['k1']]]);

  assert.equal(domainHeldByAnother(active, 'info@pizzeria-roma.hu', 'k1'), false);
  assert.equal(domainHeldByAnother(active, 'gyor@pizzeria-roma.hu', 'k2'), true);
});

test('before a send, mailbox providers never hold a lead back', () => {
  const active = new Map([['gmail.com', ['k1']]]);

  assert.equal(domainHeldByAnother(active, 'bela@gmail.com', 'k2'), false);
});

test('the pause between two emails spreads the day over the sending hours', () => {
  assert.equal(minGapMs(10, 12), 43.2 * 60_000);  // 10 a day over 12 hours: 72 minutes apart, 60 % of it
  assert.equal(minGapMs(35, 12), Math.round((12 * 3_600_000 / 35) * 0.6));
});

test('the pause is never under 2 minutes and never over an hour', () => {
  assert.equal(minGapMs(2000, 12), 2 * 60_000);
  assert.equal(minGapMs(1, 12), 60 * 60_000);
  assert.equal(minGapMs(0, 12), 60 * 60_000);
});

test('a sender that sent nothing yet may send at once', () => {
  assert.deepEqual(gapState('', 600_000, NOW), { open: true, inMs: 0 });
});

test('a sender waits out its pause', () => {
  const fourMinutesAgo = new Date(NOW.getTime() - 4 * 60_000).toISOString();

  assert.deepEqual(gapState(fourMinutesAgo, 10 * 60_000, NOW), { open: false, inMs: 6 * 60_000 });
  assert.deepEqual(gapState(fourMinutesAgo, 3 * 60_000, NOW), { open: true, inMs: 0 });
});
