import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PER_RUN, planFetch, selectUids, nextState } from './inboxPlan.mjs';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const state = (over = {}) => ({ uidValidity: '7', lastSeenUid: 40, lastCheckedAt: '2026-10-05T09:30:00.000Z', ...over });

test('the first round only remembers where the mailbox ends', () => {
  const mailbox = { uidValidity: '7', uidNext: 513 };

  const plan = planFetch(state({ uidValidity: '', lastSeenUid: 0, lastCheckedAt: '' }), mailbox, NOW);

  assert.deepEqual(plan, { mode: 'baseline' });
  assert.deepEqual(nextState(state({ uidValidity: '' }), mailbox, plan, [], NOW), { uidValidity: '7', lastSeenUid: 512, lastCheckedAt: NOW.toISOString() });
});

test('a round asks only for the messages above lastSeenUid', () => {
  assert.deepEqual(planFetch(state(), { uidValidity: '7', uidNext: 45 }, NOW), { mode: 'uid', fromUid: 41 });
});

test('nothing new means nothing is fetched', () => {
  assert.deepEqual(planFetch(state(), { uidValidity: '7', uidNext: 41 }, NOW), { mode: 'none' });
});

test('a changed UIDVALIDITY switches to the day of the last round, not to the whole mailbox', () => {
  const plan = planFetch(state(), { uidValidity: '8', uidNext: 900 }, NOW);

  assert.equal(plan.mode, 'since');
  assert.equal(plan.since.toISOString(), '2026-10-05T09:30:00.000Z');
});

test('a changed UIDVALIDITY with no usable date starts from now', () => {
  const plan = planFetch(state({ lastCheckedAt: 'garbage' }), { uidValidity: '8', uidNext: 900 }, NOW);

  assert.equal(plan.since.toISOString(), NOW.toISOString());
});

test('selectUids drops the already seen message the server returns for N:*', () => {
  const picked = selectUids({ mode: 'uid', fromUid: 41 }, [40], 40);

  assert.deepEqual(picked, { take: [], more: false });
});

test('selectUids takes the oldest messages first, up to the limit', () => {
  const uids = Array.from({ length: MAX_PER_RUN + 20 }, (_, i) => 1000 - i);

  const picked = selectUids({ mode: 'uid', fromUid: 41 }, uids, 40);

  assert.equal(picked.take.length, MAX_PER_RUN);
  assert.equal(picked.take[0], 1000 - (MAX_PER_RUN + 19));
  assert.equal(picked.more, true);
});

test('selectUids keeps every message in since mode, whatever lastSeenUid was', () => {
  assert.deepEqual(selectUids({ mode: 'since', since: NOW }, [3, 1, 2], 40).take, [1, 2, 3]);
});

test('lastSeenUid moves to the last message that was really read', () => {
  const mailbox = { uidValidity: '7', uidNext: 60 };

  const next = nextState(state(), mailbox, { mode: 'uid', fromUid: 41 }, [41, 42, 43], NOW);

  assert.equal(next.lastSeenUid, 43);
});

test('a round that read nothing leaves lastSeenUid where it was', () => {
  const mailbox = { uidValidity: '7', uidNext: 60 };

  assert.equal(nextState(state(), mailbox, { mode: 'uid', fromUid: 41 }, [], NOW).lastSeenUid, 40);
  assert.equal(nextState(state(), mailbox, { mode: 'none' }, [], NOW).lastSeenUid, 40);
});

test('after a UIDVALIDITY change the new value and a new lastSeenUid are stored', () => {
  const mailbox = { uidValidity: '8', uidNext: 900 };
  const plan = { mode: 'since', since: NOW };

  assert.deepEqual(nextState(state(), mailbox, plan, [880, 890], NOW), { uidValidity: '8', lastSeenUid: 890, lastCheckedAt: NOW.toISOString() });
  assert.equal(nextState(state(), mailbox, plan, [], NOW).lastSeenUid, 899);
});

test('running the same state twice fetches nothing the second time', () => {
  const mailbox = { uidValidity: '7', uidNext: 44 };
  const first = nextState(state(), mailbox, planFetch(state(), mailbox, NOW), [41, 42, 43], NOW);

  assert.deepEqual(planFetch(first, mailbox, NOW), { mode: 'none' });
});
