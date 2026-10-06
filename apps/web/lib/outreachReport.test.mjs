import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, MIN_SAMPLE, levelOf, summarize, buildReport, cleanPostmaster, postmasterAge } from './outreachReport.mjs';

const g = (over = {}) => ({ sequenceId: 's1', stepId: 'a', senderId: 'tom', offer: 'ai', outcome: 'sent', bounceKind: '', n: 1, ...over });
const NAMES = {
  sequences: [{ sequenceId: 's1', name: 'No website', steps: [{ id: 'a' }, { id: 'a2', variantOf: 'a' }, { id: 'b' }, { id: 'c' }] }],
  senders: [{ senderId: 'tom', label: 'Tom, English' }, { senderId: 'tamas', label: 'Tamás, Hungarian' }],
};
const NOW = new Date('2026-10-20T10:00:00.000Z');

test('50 rows of a known mix come back exactly', () => {
  // 50 accepted: 40 nothing came back, 2 dead addresses, 1 full mailbox, 1 blocked, 4 replies, 1 stop request, 1 unknown
  const groups = [g({ n: 40 }), g({ outcome: 'bounced', bounceKind: 'hard', n: 2 }), g({ bounceKind: 'soft', n: 1 }), g({ outcome: 'blocked', bounceKind: 'block', n: 1 }), g({ outcome: 'replied', n: 4 }), g({ outcome: 'stopped', n: 1 }), g({ outcome: 'unknown', n: 1 })];

  const { total } = buildReport(groups, NAMES);

  assert.equal(total.sent, 50);
  assert.deepEqual([total.bounced, total.soft, total.blocked, total.replied, total.stopped, total.unknown], [2, 1, 1, 4, 1, 1]);
  assert.equal(total.assumedDelivered, 46);
  assert.deepEqual(total.rates, { bounce: 0.04, block: 0.02, reply: 0.08, stop: 0.02 });
});

test('a bounce rate of 3 % is over the threshold and marked bad', () => {
  const s = summarize({ sent: 100, bounced: 3, soft: 0, blocked: 0, replied: 0, stopped: 0, unknown: 0 });

  assert.equal(THRESHOLDS.bounce, 0.02);
  assert.equal(s.levels.bounce, 'bad');
  assert.equal(s.levels.block, 'ok');
});

test('the levels: ok below three quarters of the threshold, warn from there, bad at it', () => {
  assert.equal(levelOf(0.01, 0.02), 'ok');
  assert.equal(levelOf(0.015, 0.02), 'warn');
  assert.equal(levelOf(0.02, 0.02), 'bad');
  assert.equal(levelOf(null, 0.02), '');
});

test('a block rate over 1 % is bad on its own, whatever the bounces do', () => {
  assert.equal(summarize({ sent: 200, bounced: 0, soft: 0, blocked: 3, replied: 0, stopped: 0, unknown: 0 }).levels.block, 'bad');
});

test('3 bounces out of 20 are 3 bounces, not a rate', () => {
  const s = summarize({ sent: 20, bounced: 3, soft: 0, blocked: 0, replied: 2, stopped: 0, unknown: 0 });

  assert.equal(MIN_SAMPLE, 30);
  assert.equal(s.enough, false);
  assert.deepEqual(s.rates, { bounce: null, block: null, reply: null, stop: null });
  assert.equal(s.levels.bounce, '');
  assert.equal(s.bounced, 3);
});

test('at 30 emails the rates appear', () => {
  assert.equal(summarize({ sent: 30, bounced: 0, soft: 0, blocked: 0, replied: 3, stopped: 0, unknown: 0 }).rates.reply, 0.1);
});

test('a soft bounce that later became final is counted once, as a bounce', () => {
  const { total } = buildReport([g({ outcome: 'bounced', bounceKind: 'soft', n: 1 }), g({ n: 9 })], NAMES);

  assert.equal(total.bounced, 1);
  assert.equal(total.soft, 0);
  assert.equal(total.assumedDelivered, 9);
});

test('the steps come in the order of their sequence, a variant after its step', () => {
  const groups = [g({ stepId: 'c', n: 5 }), g({ stepId: 'a2', n: 20 }), g({ stepId: 'a', n: 30 }), g({ stepId: 'b', n: 12 })];

  const { byStep } = buildReport(groups, NAMES);

  assert.deepEqual(byStep.map((s) => [s.label, s.sent]), [['Step 1, original wording', 30], ['Step 1, variant 1', 20], ['Step 2', 12], ['Step 3', 5]]);
  assert.deepEqual(byStep.map((s) => s.variant), [false, true, false, false]);
});

test('a step that loses more shows it in its own numbers', () => {
  const groups = [g({ stepId: 'a', n: 96 }), g({ stepId: 'a', outcome: 'replied', n: 4 }), g({ stepId: 'b', n: 90 }), g({ stepId: 'b', outcome: 'bounced', n: 10 })];

  const { byStep } = buildReport(groups, NAMES);

  assert.equal(byStep[0].rates.reply, 0.04);
  assert.equal(byStep[1].rates.bounce, 0.1);
  assert.equal(byStep[1].levels.bounce, 'bad');
});

test('sends of a deleted step, of a deleted sequence and by hand are still counted and named', () => {
  const groups = [g({ stepId: 'gone', n: 2 }), g({ sequenceId: 'old', stepId: 'x', n: 3 }), g({ sequenceId: '', stepId: '', senderId: '', offer: '', n: 4 })];

  const { byStep, bySender, total } = buildReport(groups, NAMES);

  assert.equal(total.sent, 9);
  assert.deepEqual(byStep.map((s) => [s.sequence, s.label]), [['No website', 'A step that no longer exists'], ['A sequence that no longer exists', 'A step that no longer exists'], ['Sent by hand', 'Draft from the lead panel']]);
  assert.equal(bySender.find((s) => s.id === '').label, 'Sent by hand');
});

test('the senders are listed with their labels, the busiest first', () => {
  const { bySender } = buildReport([g({ senderId: 'tamas', n: 5 }), g({ senderId: 'tom', n: 40 }), g({ senderId: 'tom', outcome: 'bounced', n: 2 })], NAMES);

  assert.deepEqual(bySender.map((s) => [s.label, s.sent]), [['Tom, English', 42], ['Tamás, Hungarian', 5]]);
  assert.equal(bySender[0].levels.bounce, 'bad');
});

test('the two offers are compared by their reply rates, without the emails sent by hand', () => {
  const groups = [g({ offer: 'ai', n: 45 }), g({ offer: 'ai', outcome: 'replied', n: 5 }), g({ offer: 'social', n: 49 }), g({ offer: 'social', outcome: 'replied', n: 1 }), g({ sequenceId: '', offer: '', n: 10 })];

  const { byOffer } = buildReport(groups, NAMES);

  assert.deepEqual(byOffer.map((o) => [o.label, o.sent, o.rates.reply]), [['AI automation', 50, 0.1], ['Social media', 50, 0.02]]);
});

test('nothing sent gives an empty report, not an error', () => {
  const r = buildReport([], NAMES);

  assert.equal(r.total.sent, 0);
  assert.equal(r.total.rates.bounce, null);
  assert.deepEqual([r.bySender, r.byStep, r.byOffer], [[], [], []]);
  assert.equal(buildReport(undefined, undefined).total.sent, 0);
});

test('a Postmaster figure is a percentage and a day', () => {
  assert.deepEqual(cleanPostmaster({ spamRate: '0,1 %', date: '2026-10-19' }, NOW), { value: { spamRate: 0.1, date: '2026-10-19' } });
  assert.deepEqual(cleanPostmaster({ spamRate: 0, date: '2026-10-20' }, NOW), { value: { spamRate: 0, date: '2026-10-20' } });
});

test('a Postmaster figure that makes no sense is refused', () => {
  for (const bad of [{ spamRate: 'low', date: '2026-10-19' }, { spamRate: -1, date: '2026-10-19' }, { spamRate: 101, date: '2026-10-19' }, { spamRate: 0.1, date: 'yesterday' }, { spamRate: 0.1, date: '2026-13-40' }, { spamRate: 0.1, date: '2026-10-21' }, { spamRate: '', date: '2026-10-19' }, null]) {
    assert.ok(cleanPostmaster(bad, NOW).error, JSON.stringify(bad));
  }
});

test('a Postmaster figure is stale after 14 days, and when it was never entered', () => {
  assert.deepEqual(postmasterAge('2026-10-06', NOW), { days: 14, stale: false });
  assert.deepEqual(postmasterAge('2026-10-05', NOW), { days: 15, stale: true });
  assert.deepEqual(postmasterAge('', NOW), { days: null, stale: true });
});
