import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newStepId, enabledSteps, stepById, nextEnabledStep, absoluteDayOf, validateSequence,
  cleanStep, cleanSequence, planAdvance, planContinue, statusForStop,
} from './outreachSequence.mjs';

const step = (id, delayDays, over = {}) => ({ id, delayDays, subject: `Subject ${id}`, body: `Text ${id}`, sameThread: false, enabled: true, ...over });
const sequence = (steps, over = {}) => ({ sequenceId: 's1', name: 'No website, English', language: 'en', steps, ...over });
// four steps: day 0, 3, 7 and 14
const four = (over = {}) => sequence([step('a', 0), step('b', 3, over.b), step('c', 4, over.c), step('d', 7, over.d)]);

test('newStepId gives a short id and not the same one twice', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newStepId()));

  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-z]{6}$/);
});

test('enabledSteps leaves out switched-off steps and variants, in order', () => {
  const seq = sequence([step('a', 0), step('a2', 0, { variantOf: 'a' }), step('b', 3, { enabled: false }), step('c', 4)]);

  const ids = enabledSteps(seq).map((s) => s.id);

  assert.deepEqual(ids, ['a', 'c']);
});

test('stepById finds any step, and gives null for an unknown or empty id', () => {
  const seq = sequence([step('a', 0), step('b', 3, { enabled: false }), step('a2', 0, { variantOf: 'a' })]);

  assert.equal(stepById(seq, 'b').id, 'b');
  assert.equal(stepById(seq, 'a2').variantOf, 'a');
  assert.equal(stepById(seq, 'zz'), null);
  assert.equal(stepById(seq, ''), null);
});

test('a lead that got nothing yet starts with the first enabled step, at once', () => {
  const seq = four();

  const next = nextEnabledStep(seq, '');

  assert.equal(next.step.id, 'a');
  assert.equal(next.delayDays, 0);
});

test('the next step comes after its own wait', () => {
  const seq = four();

  const next = nextEnabledStep(seq, 'a');

  assert.equal(next.step.id, 'b');
  assert.equal(next.delayDays, 3);
});

test('a switched-off step is skipped and its wait is added to the next one', () => {
  const seq = four({ b: { enabled: false } });

  const next = nextEnabledStep(seq, 'a');

  assert.equal(next.step.id, 'c');
  assert.equal(next.delayDays, 7);
});

test('two switched-off steps in a row add up as well', () => {
  const seq = four({ b: { enabled: false }, c: { enabled: false } });

  const next = nextEnabledStep(seq, 'a');

  assert.equal(next.step.id, 'd');
  assert.equal(next.delayDays, 14);
});

test('nothing follows the last step', () => {
  assert.equal(nextEnabledStep(four(), 'd'), null);
  assert.equal(nextEnabledStep(four({ d: { enabled: false } }), 'c'), null);
});

test('a lead whose last step was deleted gets nothing more', () => {
  assert.equal(nextEnabledStep(four(), 'deleted'), null);
});

test('a step inserted in the middle changes no existing id and no lead loses its place', () => {
  const seq = four();
  const before = seq.steps.map((s) => s.id);

  seq.steps.splice(2, 0, step('new', 2));

  assert.deepEqual(seq.steps.filter((s) => s.id !== 'new').map((s) => s.id), before);
  assert.equal(nextEnabledStep(seq, 'b').step.id, 'new');
  assert.equal(nextEnabledStep(seq, 'c').step.id, 'd');
  assert.deepEqual(validateSequence(seq), []);
});

test('a variant never comes up as the next step', () => {
  const seq = sequence([step('a', 0), step('a2', 0, { variantOf: 'a', weight: 1 }), step('b', 3)]);

  assert.equal(nextEnabledStep(seq, 'a').step.id, 'b');
});

test('absoluteDayOf counts the waits from the first step, switched-off ones included', () => {
  const seq = four({ b: { enabled: false } });

  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => absoluteDayOf(seq, id)), [0, 3, 7, 14]);
  assert.equal(absoluteDayOf(seq, 'zz'), null);
});

test('a variant falls on the day of its step', () => {
  const seq = sequence([step('a', 0), step('b', 3), step('b2', 0, { variantOf: 'b' })]);

  assert.equal(absoluteDayOf(seq, 'b2'), 3);
});

test('a sound sequence has no errors', () => {
  assert.deepEqual(validateSequence(four()), []);
});

test('a sequence needs a name, a known language and steps', () => {
  const errors = validateSequence({ name: ' ', language: 'de' });

  assert.equal(errors.length, 3);
});

test('a sequence with every step switched off may not run', () => {
  const seq = sequence([step('a', 0, { enabled: false }), step('b', 3, { enabled: false })]);

  assert.deepEqual(validateSequence(seq), ['At least one step must be switched on.']);
});

test('the first step must have a wait of 0 days', () => {
  const errors = validateSequence(sequence([step('a', 2), step('b', 3)]));

  assert.deepEqual(errors, ['The first step must have a wait of 0 days.']);
});

test('a wait must be a whole number, 0 or more', () => {
  for (const bad of [-1, 1.5, '3', null, undefined, NaN]) {
    const errors = validateSequence(sequence([step('a', 0), step('b', bad)]));

    assert.equal(errors.length, 1, String(bad));
    assert.match(errors[0], /whole number of days/);
  }
});

test('only the first step may have a wait of 0 days', () => {
  const errors = validateSequence(sequence([step('a', 0), step('b', 0)]));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /only the first step/);
});

test('an enabled step with an empty subject is an error', () => {
  const errors = validateSequence(sequence([step('a', 0), step('b', 3, { subject: '  ' })]));

  assert.deepEqual(errors, ['Step 2 has no subject.']);
});

test('an enabled step with an empty text is an error', () => {
  const errors = validateSequence(sequence([step('a', 0, { body: '' }), step('b', 3)]));

  assert.deepEqual(errors, ['Step 1 ("Subject a") has no text.']);
});

test('a switched-off step may be unfinished', () => {
  const seq = sequence([step('a', 0), step('b', 3, { enabled: false, subject: '', body: '' })]);

  assert.deepEqual(validateSequence(seq), []);
});

test('a step that continues the thread needs no subject of its own', () => {
  const seq = sequence([step('a', 0), step('b', 3, { sameThread: true, subject: '' })]);

  assert.deepEqual(validateSequence(seq), []);
});

test('the opening step cannot continue a thread', () => {
  const errors = validateSequence(sequence([step('a', 0, { sameThread: true }), step('b', 3)]));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /opens the conversation/);
});

test('two steps with the same id are an error', () => {
  const errors = validateSequence(sequence([step('a', 0), step('a', 3)]));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /same id/);
});

test('a step without an id is an error', () => {
  const errors = validateSequence(sequence([step('a', 0), step('', 3)]));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /has no id/);
});

test('a variant must point at an existing step and have a weight above 0', () => {
  const seq = sequence([step('a', 0), step('x', 0, { variantOf: 'gone' }), step('y', 0, { variantOf: 'a', weight: 0 })]);

  const errors = validateSequence(seq);

  assert.equal(errors.length, 2);
  assert.match(errors[0], /does not exist/);
  assert.match(errors[1], /weight/);
});

const NOW = new Date('2026-10-06T08:00:00.000Z');

test('a step keeps its id when it is edited, and a new step gets one', () => {
  const edited = cleanStep({ id: 'abc123', delayDays: '3', subject: 'New subject', body: 'New text' });
  const fresh = cleanStep({ delayDays: 3, subject: 'S', body: 'B' });

  assert.equal(edited.id, 'abc123');
  assert.match(fresh.id, /^[0-9a-z]{6}$/);
});

test('cleanStep keeps only the known fields, with the right types', () => {
  const step = cleanStep({ id: 'a', delayDays: '3', subject: 'S', body: 'B', sameThread: 'yes', junk: 1, $set: {} });

  assert.deepEqual(step, { id: 'a', delayDays: 3, subject: 'S', body: 'B', sameThread: false, enabled: true });
});

test('a line break cannot get into a subject', () => {
  const step = cleanStep({ subject: 'Hello\r\nBcc: someone@example.com', body: 'B' });

  assert.equal(step.subject, 'Hello  Bcc: someone@example.com');
});

test('the text keeps its line breaks', () => {
  assert.equal(cleanStep({ body: 'Hi,\r\n\r\nTom' }).body, 'Hi,\n\nTom');
});

test('a wait that is not a number is stored as empty, so validation catches it', () => {
  for (const bad of ['', 'soon', null, undefined, true]) {
    const seq = sequence([step('a', 0), cleanStep({ id: 'b', delayDays: bad, subject: 'S', body: 'B' })]);

    assert.equal(seq.steps[1].delayDays, null, String(bad));
    assert.equal(validateSequence(seq).length, 1, String(bad));
  }
});

test('a variant keeps what it is a variant of and its weight', () => {
  const v = cleanStep({ id: 'a2', variantOf: 'a', weight: '2', subject: 'S', body: 'B' });

  assert.equal(v.variantOf, 'a');
  assert.equal(v.weight, 2);
});

test('a new sequence gets every field and starts switched off', () => {
  const value = cleanSequence({ name: '  No website  ', steps: [{ delayDays: 0, subject: 'S', body: 'B' }] }, true);

  assert.equal(value.name, 'No website');
  assert.equal(value.language, 'en');
  assert.deepEqual(value.senderIds, []);
  assert.equal(value.enabled, false);
  assert.equal(value.autoFollowUp, false);
  assert.equal(value.stopOnReply, true);
  assert.equal(value.stopOnBounce, true);
  assert.equal(value.steps.length, 1);
});

test('an edit holds only the fields that were sent', () => {
  assert.deepEqual(cleanSequence({ enabled: true }, false), { enabled: true });
  assert.deepEqual(cleanSequence({ senderIds: ['a', 'a', '', 'b'] }, false), { senderIds: ['a', 'b'] });
});

test('enabled is true only for a real true', () => {
  assert.equal(cleanSequence({ enabled: 'true' }, false).enabled, false);
});

// a sequence whose follow-ups go out by themselves
const auto = (over) => ({ ...four(over), autoFollowUp: true });

test('after the opening email the lead waits for the operator, with nothing due', () => {
  const plan = planAdvance(four(), 'a', NOW);

  assert.deepEqual(plan, { sentStepId: 'a', stepId: 'b', nextStepAt: '', status: 'waiting', delayDays: 3 });
});

test('a variant of the opening email leaves the lead waiting just the same', () => {
  const seq = sequence([step('a', 0), step('a2', 0, { variantOf: 'a' }), step('b', 3)]);

  assert.equal(planAdvance(seq, 'a2', NOW).status, 'waiting');
});

test('when the opening step is switched off, the first step that is on is the opening email', () => {
  const plan = planAdvance(four({ b: { enabled: true } }), 'b', NOW);
  const first = planAdvance({ ...four(), steps: four().steps.map((s) => (s.id === 'a' ? { ...s, enabled: false } : s)) }, 'b', NOW);

  assert.equal(plan.status, 'active');
  assert.equal(first.status, 'waiting');
});

test('once the follow-ups are started, the later steps follow by their waits', () => {
  const plan = planAdvance(four(), 'b', NOW);

  assert.deepEqual(plan, { sentStepId: 'b', stepId: 'c', nextStepAt: '2026-10-10T08:00:00.000Z', status: 'active', delayDays: 4 });
});

test('a sequence with a single step is finished after it, not waiting', () => {
  assert.equal(planAdvance(sequence([step('a', 0)]), 'a', NOW).status, 'finished');
});

test('starting the follow-ups makes the lead active on the step it waited for, at a scattered time', () => {
  const plan = planContinue(four(), 'b', NOW, () => 0.5);

  assert.deepEqual(plan, { stepId: 'b', nextStepAt: '2026-10-06T09:00:00.000Z', status: 'active' });
});

test('starting the follow-ups skips a step that was switched off meanwhile', () => {
  assert.equal(planContinue(four({ b: { enabled: false } }), 'b', NOW, () => 0).stepId, 'c');
});

test('there is nothing to start when the step is gone or nothing is left', () => {
  assert.equal(planContinue(four(), 'deleted', NOW), null);
  assert.equal(planContinue(four({ d: { enabled: false } }), 'd', NOW), null);
});

test('with automatic follow-ups the lead waits for the second step, by its wait', () => {
  const plan = planAdvance(auto(), 'a', NOW);

  assert.deepEqual(plan, { sentStepId: 'a', stepId: 'b', nextStepAt: '2026-10-09T08:00:00.000Z', status: 'active', delayDays: 3 });
});

test('after the last step the sequence is finished', () => {
  const plan = planAdvance(four(), 'd', NOW);

  assert.equal(plan.status, 'finished');
  assert.equal(plan.stepId, '');
  assert.equal(plan.nextStepAt, '');
});

test('a switched-off step in between adds its wait to the due date', () => {
  const plan = planAdvance(auto({ b: { enabled: false } }), 'a', NOW);

  assert.equal(plan.stepId, 'c');
  assert.equal(plan.nextStepAt, '2026-10-13T08:00:00.000Z');
});

test('when a variant went out, the lead moves on from the step it is a variant of', () => {
  const seq = sequence([step('a', 0), step('a2', 0, { variantOf: 'a' }), step('b', 3)]);

  const plan = planAdvance({ ...seq, autoFollowUp: true }, 'a2', NOW);

  assert.equal(plan.sentStepId, 'a2');
  assert.equal(plan.stepId, 'b');
});

test('a step that is no longer in the sequence ends the sequence for the lead', () => {
  assert.equal(planAdvance(four(), 'deleted', NOW).status, 'finished');
});

test('a reply and a bounce keep their own status, every other stop is stopped', () => {
  assert.equal(statusForStop('replied'), 'replied');
  assert.equal(statusForStop('bounced'), 'bounced');
  for (const reason of ['unsubscribed', 'manual', 'sequence_deleted', 'suppressed', '', undefined]) assert.equal(statusForStop(reason), 'stopped');
});
