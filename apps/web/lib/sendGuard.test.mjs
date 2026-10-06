import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_MS, MAX_ERRORS, BLOCKING_OUTCOMES, staleBefore, claimFilter, claimUpdate, claimHeld, afterSendError, resolveUnknown, sendFailureKind } from './sendGuard.mjs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();

// What MongoDB would answer for the claim filter, for one lead document.
function matches(filter, lead) {
  const seq = lead.seq || {};
  if (lead.project !== filter.project || lead.dedupKey !== filter.dedupKey) return false;
  if (seq.status !== filter['seq.status'] || seq.stepId !== filter['seq.stepId']) return false;
  if ((seq.sentStepIds || []).some((id) => filter['seq.sentStepIds'].$nin.includes(id))) return false;
  const claimed = seq.claimedAt;
  const free = claimed === undefined || claimed === null || claimed === '';
  return free || claimed < filter.$or[1]['seq.claimedAt'].$lt;
}
const lead = (seq = {}) => ({ project: 'p', dedupKey: 'k', seq: { status: 'active', stepId: 'b', sentStepIds: ['a'], claimedAt: '', ...seq } });
const filter = (over = {}) => claimFilter({ project: 'p', dedupKey: 'k', stepId: 'b', wordingIds: ['b', 'b2'], ...over }, NOW);

test('a claim is stale after 10 minutes', () => {
  assert.equal(STALE_MS, 10 * 60_000);
  assert.equal(staleBefore(NOW), '2026-10-20T09:50:00.000Z');
});

test('a free, active lead waiting for the step can be claimed', () => {
  assert.equal(matches(filter(), lead()), true);
});

test('a lead that has no claimedAt field at all can be claimed', () => {
  const l = lead();
  delete l.seq.claimedAt;

  assert.equal(matches(filter(), l), true);
});

test('a lead claimed 2 minutes ago is left alone', () => {
  assert.equal(matches(filter(), lead({ claimedAt: minutesAgo(2) })), false);
});

test('a lead claimed 20 minutes ago can be taken again: its round died', () => {
  assert.equal(matches(filter(), lead({ claimedAt: minutesAgo(20) })), true);
});

test('the claim written by one round keeps the next round out', () => {
  const l = lead();
  const first = matches(filter(), l);
  l.seq.claimedAt = claimUpdate(NOW).$set['seq.claimedAt'];

  assert.equal(first, true);
  assert.equal(matches(filter(), l), false);
});

test('a step that is in sentStepIds is never claimed again', () => {
  assert.equal(matches(filter(), lead({ sentStepIds: ['a', 'b'] })), false);
});

test('a lead who got a variant of the step is not sent the step itself', () => {
  assert.equal(matches(filter(), lead({ sentStepIds: ['a', 'b2'] })), false);
});

test('a lead that moved on, or is not active, is not claimed', () => {
  assert.equal(matches(filter(), lead({ stepId: 'c' })), false);
  for (const status of ['stopped', 'replied', 'finished', 'failed', 'hold']) assert.equal(matches(filter(), lead({ status })), false, status);
});

test('claimHeld tells a live claim from a stale or an empty one', () => {
  assert.equal(claimHeld(minutesAgo(2), NOW), true);
  assert.equal(claimHeld(minutesAgo(20), NOW), false);
  assert.equal(claimHeld('', NOW), false);
});

test('a failed send leaves the lead due, and the third in a row takes it out', () => {
  assert.equal(MAX_ERRORS, 3);
  assert.deepEqual(afterSendError(0), { errorCount: 1, status: 'active' });
  assert.deepEqual(afterSendError(1), { errorCount: 2, status: 'active' });
  assert.deepEqual(afterSendError(2), { errorCount: 3, status: 'failed' });
  assert.deepEqual(afterSendError(undefined), { errorCount: 1, status: 'active' });
});

test('every outcome but a refused send keeps the step from going out again', () => {
  for (const o of ['sending', 'unknown', 'sent', 'bounced', 'replied']) assert.ok(BLOCKING_OUTCOMES.includes(o), o);
  assert.equal(BLOCKING_OUTCOMES.includes('failed'), false);
});

test('the operator decides what an unknown send was', () => {
  assert.deepEqual(resolveUnknown('sent'), { outcome: 'sent', lead: 'advance' });
  assert.deepEqual(resolveUnknown('resend'), { outcome: 'failed', lead: 'retry' });
  assert.equal(resolveUnknown('whatever'), null);
});

test('a failed login or a rejected recipient means nothing went out', () => {
  for (const code of ['EAUTH', 'EENVELOPE', 'EDNS', 'ETLS']) assert.equal(sendFailureKind({ code }), 'refused', code);
  assert.equal(sendFailureKind({ code: 'EMESSAGE', responseCode: 550 }), 'refused');
});

test('a connection that broke during the send is of unknown fate', () => {
  for (const err of [{ code: 'ETIMEDOUT' }, { code: 'ESOCKET' }, new Error('socket hang up'), null, { code: 'EMESSAGE' }]) {
    assert.equal(sendFailureKind(err), 'unknown');
  }
});

test('a connection that closed unexpectedly is unknown: the server may have taken the email already', () => {
  // nodemailer raises ECONNECTION for a drop at connect time and for a drop while waiting for the reply to DATA alike
  assert.equal(sendFailureKind({ code: 'ECONNECTION', command: 'CONN' }), 'unknown');
});
