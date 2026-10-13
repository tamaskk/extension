import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgetDay, widgetQueues } from './widgetQueues.mjs';
import { dayStart } from './warmup.mjs';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const plan = (over = {}) => ({
  senders: [{ senderId: 'a', label: 'tamas@example.com', capToday: 20 }, { senderId: 'b', label: 'tom@example.com', capToday: 10 }],
  queue: [], gate: { allowed: true }, heartbeat: { stale: false }, ...over,
});
const due = (senderId, fate, expectedAt = '') => ({ senderId, fate, expectedAt });
const make = (over = {}) => widgetQueues({ date: '2026-10-21', now: NOW, sends: [], labels: new Map([['a', 'Tamas'], ['b', 'Tom']]), plan: plan(), ...over });

test('every queue adds up: total = done + failed + pending + inProgress', () => {
  const r = make({
    sends: [{ senderId: 'a', outcome: 'sent', n: 5, last: '2026-10-21T09:00:00.000Z' }, { senderId: 'a', outcome: 'bounced', n: 1, last: '2026-10-21T08:00:00.000Z' }, { senderId: 'a', outcome: 'failed', n: 2, last: '2026-10-21T07:00:00.000Z' }, { senderId: 'a', outcome: 'sending', n: 1, last: '2026-10-21T11:59:00.000Z' }, { senderId: 'b', outcome: 'sent', n: 3, last: '2026-10-21T10:00:00.000Z' }],
    plan: plan({ queue: [due('a', 'today', '2026-10-21T12:05:00.000Z'), due('a', 'hours', '2026-10-21T14:00:00.000Z'), due('a', 'next'), due('b', 'closed')] }),
  });
  for (const q of r.queues) assert.equal(q.total, q.done + q.failed + q.pending + q.inProgress);
  const a = r.queues.find((q) => q.id === 'smtp:a');
  assert.deepEqual([a.done, a.failed, a.pending, a.inProgress, a.total], [6, 2, 2, 1, 11]);
  assert.deepEqual(a.quota, { used: 7, limit: 20 });
  assert.equal(a.nextRunAt, '2026-10-21T12:05:00.000Z');
  assert.equal(a.lastActivityAt, '2026-10-21T11:59:00.000Z');
  assert.deepEqual(r.totals, { total: 14, done: 9, failed: 2, pending: 2, inProgress: 1 });
});

test('a sender that finished in the morning is still there in the afternoon, as done', () => {
  const r = make({ sends: [{ senderId: 'b', outcome: 'sent', n: 10, last: '2026-10-21T08:30:00.000Z' }] });
  assert.equal(r.queues.length, 1);
  assert.equal(r.queues[0].status, 'done');
  assert.equal(r.queues[0].completedAt, '2026-10-21T08:30:00.000Z');
  assert.equal(r.queues[0].nextRunAt, null);
});

test('a sender with nothing today is not listed, even when leads wait for another day', () => {
  const r = make({ plan: plan({ queue: [due('a', 'closed'), due('a', 'next'), due('b', 'off'), due('b', 'limit')] }) });
  assert.deepEqual(r.queues, []);
  assert.deepEqual(r.totals, { total: 0, done: 0, failed: 0, pending: 0, inProgress: 0 });
});

test('the status says why a sender with leads left is or is not sending', () => {
  const going = [due('a', 'today', '2026-10-21T12:05:00.000Z')];
  assert.equal(make({ plan: plan({ queue: going }) }).queues[0].status, 'running');
  assert.equal(make({ plan: plan({ queue: going, gate: { allowed: false } }) }).queues[0].status, 'error');
  assert.equal(make({ plan: plan({ queue: going, heartbeat: { stale: true } }) }).queues[0].status, 'paused');
  assert.equal(make({ plan: plan({ queue: [due('a', 'hours', '2026-10-21T14:00:00.000Z')] }) }).queues[0].status, 'paused');
  // an email on its way wins over a blocked gate: it is going out
  assert.equal(make({ sends: [{ senderId: 'a', outcome: 'sending', n: 1, last: '' }], plan: plan({ gate: { allowed: false } }) }).queues[0].status, 'running');
});

test('queues are ordered error, running, paused, idle, done', () => {
  const r = make({
    sends: [{ senderId: 'b', outcome: 'sent', n: 1, last: '2026-10-21T08:00:00.000Z' }],
    plan: plan({ queue: [due('a', 'today', '2026-10-21T12:05:00.000Z')] }),
  });
  assert.deepEqual(r.queues.map((q) => q.status), ['running', 'done']);
});

test('a past day is told from its emails alone: no plan, no limit', () => {
  const r = widgetQueues({ date: '2026-10-20', now: NOW, sends: [{ senderId: 'a', outcome: 'sent', n: 4, last: '2026-10-20T10:00:00.000Z' }, { senderId: 'a', outcome: 'failed', n: 1, last: '2026-10-20T09:00:00.000Z' }], labels: new Map([['a', 'Tamas']]), plan: null });
  assert.deepEqual(r.queues.map((q) => [q.name, q.status, q.total, q.done, q.failed, q.quota]), [['Tamas', 'done', 5, 4, 1, null]]);
});

test('widgetDay takes a real calendar day only', () => {
  assert.equal(widgetDay('2026-10-21'), '2026-10-21');
  assert.equal(widgetDay('2026-13-01'), '');
  assert.equal(widgetDay('today'), '');
});

test('the day asked for is a Budapest day, also when the clocks change', () => {
  const start = (day) => dayStart(new Date(day + 'T12:00:00.000Z')).toISOString();
  // 2026-10-25 has 25 hours: it starts at 22:00 UTC and the next day at 23:00 UTC
  assert.equal(start('2026-10-25'), '2026-10-24T22:00:00.000Z');
  assert.equal(start('2026-10-26'), '2026-10-25T23:00:00.000Z');
  // 2026-03-29 has 23 hours
  assert.equal(start('2026-03-29'), '2026-03-28T23:00:00.000Z');
  assert.equal(start('2026-03-30'), '2026-03-29T22:00:00.000Z');
});

test('a sender is named by its label, never by the address the plan falls back to', () => {
  const r = make({ sends: [{ senderId: 'a', outcome: 'sent', n: 1, last: '2026-10-21T08:00:00.000Z' }] });
  assert.equal(r.queues[0].name, 'Tamas');
});
