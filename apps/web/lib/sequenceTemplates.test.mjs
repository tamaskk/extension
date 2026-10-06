import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_TEMPLATES } from './sequenceTemplates.mjs';
import { cleanSequence, validateSequence, planAdvance } from './outreachSequence.mjs';
import { usedVariables, render, renderContext } from './outreachRender.mjs';

// what the editor would save from a template
const saved = (t) => cleanSequence({ name: t.name, language: t.language, steps: t.steps }, true);

test('every template passes the checks of a sequence as it is', () => {
  for (const t of SEQUENCE_TEMPLATES) assert.deepEqual(validateSequence(saved(t)), [], t.key);
});

test('there is one template in English and one in Hungarian, four emails each', () => {
  assert.deepEqual(SEQUENCE_TEMPLATES.map((t) => [t.language, t.steps.length]), [['en', 4], ['hu', 4]]);
});

test('the templates use only the business name, so no lead is left out for a missing value', () => {
  for (const t of SEQUENCE_TEMPLATES) {
    assert.deepEqual(usedVariables(saved(t)).map((v) => [v.name, v.known]), [['name', true]], t.key);
  }
});

test('the opening email names all three services, and the follow-ups are in its thread', () => {
  const [en, hu] = SEQUENCE_TEMPLATES;

  for (const word of ['Websites', 'AI automation', 'Social media']) assert.ok(en.steps[0].body.includes(word), word);
  for (const word of ['Weboldal', 'AI automatizálás', 'Közösségi média']) assert.ok(hu.steps[0].body.includes(word), word);
  for (const t of SEQUENCE_TEMPLATES) {
    assert.equal(t.steps[0].sameThread, false);
    assert.deepEqual(t.steps.slice(1).map((s) => s.sameThread), [true, true, true]);
  }
});

test('a template renders for a lead without a gap, and holds no footer of its own', () => {
  for (const t of SEQUENCE_TEMPLATES) {
    for (const s of t.steps) {
      const r = render(`${s.subject}\n${s.body}`, renderContext({ name: 'Pizzeria Roma' }));

      assert.deepEqual(r.missing, [], t.key);
      assert.equal(/STOP|\n--\n/.test(s.body), false, t.key);
    }
  }
});

test('a sequence made from a template sends the opening email and then waits', () => {
  const seq = saved(SEQUENCE_TEMPLATES[0]);

  assert.equal(seq.autoFollowUp, false);
  assert.equal(planAdvance(seq, seq.steps[0].id, new Date('2026-10-06T08:00:00.000Z')).status, 'waiting');
});
