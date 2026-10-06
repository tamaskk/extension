import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sequenceImpact } from './sequenceImpact.mjs';

const step = (id, delayDays, over = {}) => ({ id, delayDays, subject: `Subject ${id}`, body: `Text ${id}`, sameThread: false, enabled: true, ...over });
const sequence = (steps, over = {}) => ({ sequenceId: 's1', name: 'Test', language: 'en', enabled: true, steps, ...over });
const four = () => sequence([step('a', 0), step('b', 3), step('c', 4), step('d', 7)]);
// n leads waiting for `stepId`, having got everything before it
const waitingFor = (stepId, n) => {
  const order = ['a', 'b', 'c', 'd'];
  return Array.from({ length: n }, () => ({ stepId, sentStepIds: order.slice(0, order.indexOf(stepId)) }));
};
const edit = (fn) => { const s = four(); fn(s); return s; };
const only = (impact, kind) => impact.items.filter((i) => i.kind === kind);

test('nothing changed means nothing to report', () => {
  assert.deepEqual(sequenceImpact(four(), four(), waitingFor('b', 20)), { activeLeads: 20, items: [] });
});

test('new wording on the second step reaches all 20 leads who got only the first', () => {
  const impact = sequenceImpact(four(), edit((s) => { s.steps[1].body = 'Better text'; }), waitingFor('b', 20));

  const [item] = only(impact, 'text');
  assert.equal(impact.items.length, 1);
  assert.equal(item.willGet, 20);
  assert.equal(item.alreadyGot, 0);
});

test('new wording does not go again to leads who already got that step', () => {
  const leads = [...waitingFor('b', 12), ...waitingFor('d', 8)];

  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps[2].subject = 'New subject'; }), leads), 'text');

  assert.equal(item.willGet, 12);
  assert.equal(item.alreadyGot, 8);
  assert.match(item.text, /Step 3 has new wording: 12 active leads will get the new one; 8 already got the old one/);
});

test('a step inserted in the middle goes to the leads before it and not to the ones past it', () => {
  const leads = [...waitingFor('b', 5), ...waitingFor('c', 7), ...waitingFor('d', 3)];
  const proposed = edit((s) => { s.steps.splice(2, 0, step('new', 2)); });

  const [item] = only(sequenceImpact(four(), proposed, leads), 'new');

  assert.equal(item.willGet, 5);
  assert.equal(item.pastIt, 10);
  assert.match(item.text, /^Step 3 is new/);
});

test('a new step that is switched off goes to nobody', () => {
  const proposed = edit((s) => { s.steps.splice(2, 0, step('new', 2, { enabled: false })); });

  assert.equal(only(sequenceImpact(four(), proposed, waitingFor('b', 5)), 'new')[0].willGet, 0);
});

test('switching a step off counts the leads who will skip it and the ones waiting for it', () => {
  const leads = [...waitingFor('b', 4), ...waitingFor('d', 6), ...waitingFor('a', 2)];

  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps[3].enabled = false; }), leads), 'off');

  assert.equal(item.skip, 12);
  assert.equal(item.waiting, 6);
  assert.match(item.text, /waits added together/);
});

test('leads who already got a step are not counted when it is switched off', () => {
  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps[1].enabled = false; }), [...waitingFor('b', 3), ...waitingFor('c', 9)]), 'off');

  assert.equal(item.skip, 3);
});

test('switching a step back on counts the leads who will now get it', () => {
  const current = edit((s) => { s.steps[2].enabled = false; });

  const [item] = only(sequenceImpact(current, four(), [...waitingFor('b', 4), ...waitingFor('d', 5)]), 'on');

  assert.equal(item.willGet, 4);
});

test('a changed wait applies to leads before the step and leaves a set date alone', () => {
  const leads = [...waitingFor('a', 2), ...waitingFor('b', 6), ...waitingFor('c', 9), ...waitingFor('d', 1)];

  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps[2].delayDays = 10; }), leads), 'delay');

  assert.equal(item.later, 8);
  assert.equal(item.fixed, 9);
  assert.match(item.text, /9 leads are already scheduled for it and keep their date/);
});

test('a deleted step ends the sequence for the leads waiting for it', () => {
  const leads = [...waitingFor('b', 3), ...waitingFor('c', 4), ...waitingFor('d', 5)];

  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps.splice(2, 1); }), leads), 'removed');

  assert.equal(item.stranded, 4);
  assert.equal(item.hadIt, 5);
  assert.match(item.text, /^Step 3 is deleted/);
  assert.match(item.text, /Switching the step off instead/);
});

test('moving a step reports that the order changed', () => {
  const proposed = edit((s) => { [s.steps[1], s.steps[2]] = [s.steps[2], s.steps[1]]; });

  assert.equal(only(sequenceImpact(four(), proposed, waitingFor('b', 5)), 'order').length, 1);
});

test('inserting or deleting a step alone is not an order change', () => {
  const inserted = edit((s) => { s.steps.splice(1, 0, step('new', 1)); });
  const deleted = edit((s) => { s.steps.splice(1, 1); });

  assert.equal(only(sequenceImpact(four(), inserted, []), 'order').length, 0);
  assert.equal(only(sequenceImpact(four(), deleted, []), 'order').length, 0);
});

test('switching the whole sequence off or on is reported with the lead count', () => {
  const off = sequenceImpact(four(), sequence(four().steps, { enabled: false }), waitingFor('b', 7));
  const on = sequenceImpact(sequence(four().steps, { enabled: false }), four(), waitingFor('b', 7));

  assert.match(only(off, 'sequence-off')[0].text, /7 active leads stay where they are/);
  assert.match(only(on, 'sequence-on')[0].text, /sending starts for 7 active leads/);
});

test('a lead who got a variant counts as having got the step', () => {
  const current = sequence([step('a', 0), step('b', 3), step('b2', 0, { variantOf: 'b' }), step('c', 4)]);
  const proposed = sequence([step('a', 0), step('b', 3, { body: 'Changed' }), step('b2', 0, { variantOf: 'b' }), step('c', 4)]);
  const leads = [{ stepId: 'c', sentStepIds: ['a', 'b2'] }, { stepId: 'b', sentStepIds: ['a'] }];

  const [item] = only(sequenceImpact(current, proposed, leads), 'text');

  assert.equal(item.alreadyGot, 1);
  assert.equal(item.willGet, 1);
});

test('a new wording variant is reported with the leads who can still get that step', () => {
  const proposed = edit((s) => { s.steps.push(step('c2', 0, { variantOf: 'c' })); });

  const [item] = only(sequenceImpact(four(), proposed, [...waitingFor('b', 4), ...waitingFor('d', 2)]), 'variant');

  assert.equal(item.reach, 4);
});

test('one lead is written in the singular', () => {
  const [item] = only(sequenceImpact(four(), edit((s) => { s.steps[1].body = 'x'; }), waitingFor('b', 1)), 'text');

  assert.match(item.text, /1 active lead will get the new one/);
});
