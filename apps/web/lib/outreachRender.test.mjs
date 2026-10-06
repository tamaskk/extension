import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIABLES, VARIABLE_FIELDS, isKnownVariable, parseAddress, renderContext, render, variablesIn, usedVariables, missingCounts } from './outreachRender.mjs';

const lead = (over = {}) => ({ name: 'Pizzeria Roma', category: 'Pizza restaurant', rating: 4.6, reviewCount: 212, website: '', websiteStatus: 'NO_WEBSITE', address: '123 Main St, Houston, TX 77002, USA', aiPitch: 'A one-page site with the menu.', opportunityScore: 87, ...over });

test('render fills in the values', () => {
  const r = render('Hi {{name}}, {{reviewCount}} reviews at {{ rating }} stars.', renderContext(lead()));

  assert.deepEqual(r, { out: 'Hi Pizzeria Roma, 212 reviews at 4.6 stars.', missing: [] });
});

test('a variable without a value is reported and left out of the text', () => {
  const r = render('Your site {{website}} is slow.', renderContext(lead()));

  assert.deepEqual(r, { out: 'Your site  is slow.', missing: ['website'] });
});

test('a mistyped variable is reported like a missing one', () => {
  const r = render('Quick idea for {{nmae}}', renderContext(lead()));

  assert.equal(r.out, 'Quick idea for ');
  assert.deepEqual(r.missing, ['nmae']);
});

test('each missing variable is reported once', () => {
  assert.deepEqual(render('{{website}} {{website}} {{aiSummary}}', renderContext(lead())).missing, ['website', 'aiSummary']);
});

test('with mark the gap stays visible, for a preview', () => {
  assert.equal(render('Your site {{website}} is slow.', renderContext(lead()), true).out, 'Your site [website] is slow.');
});

test('a number 0 is a value, an empty or blank string is not', () => {
  assert.deepEqual(render('{{reviewCount}}', renderContext(lead({ reviewCount: 0 }))), { out: '0', missing: [] });
  assert.deepEqual(render('{{name}}', renderContext(lead({ name: '   ' }))).missing, ['name']);
});

test('a text without variables comes back as it is', () => {
  assert.deepEqual(render('Plain text, { single } braces.', {}), { out: 'Plain text, { single } braces.', missing: [] });
  assert.deepEqual(render('', {}), { out: '', missing: [] });
});

test('every variable is a real lead field or a part of the address', () => {
  for (const name of Object.keys(VARIABLES)) assert.ok(VARIABLE_FIELDS.includes(name) || name === 'street' || name === 'city', name);
  assert.equal(isKnownVariable('firstName'), false);
  assert.equal(isKnownVariable('constructor'), false);
});

test('an American address has the street first and the city second', () => {
  assert.deepEqual(parseAddress('123 Main St, Houston, TX 77002, USA'), { street: '123 Main St', city: 'Houston' });
});

test('a Hungarian address has the city first and the street second', () => {
  assert.deepEqual(parseAddress('Budapest, Váci út 1, 1132 Hungary'), { street: 'Váci út 1', city: 'Budapest' });
});

test('a postcode in front of the city is dropped', () => {
  assert.deepEqual(parseAddress('1132 Budapest, Váci út 1'), { street: 'Váci út 1', city: 'Budapest' });
});

test('a street without a number is still a street', () => {
  assert.deepEqual(parseAddress('Kossuth tér, Debrecen, 4024 Hungary'), { street: 'Kossuth tér', city: 'Debrecen' });
});

test('an address with only a city has no street', () => {
  assert.deepEqual(parseAddress('Houston, TX, USA'), { street: '', city: 'Houston' });
});

test('an empty address gives nothing, so a text that needs it is not sent', () => {
  assert.deepEqual(parseAddress(''), { street: '', city: '' });
  assert.deepEqual(render('In {{city}}', renderContext(lead({ address: '' }))).missing, ['city']);
});

test('the context holds street and city next to the lead fields', () => {
  const ctx = renderContext(lead());

  assert.equal(ctx.street, '123 Main St');
  assert.equal(ctx.city, 'Houston');
  assert.equal(ctx.websiteStatus, 'NO_WEBSITE');
});

test('variablesIn also sees what is not a valid variable name', () => {
  assert.deepEqual(variablesIn('{{name}} {{ first name }} {{name}} {{city!}}'), ['name', 'first name', 'city!']);
});

test('usedVariables lists every variable with the steps that use it', () => {
  const seq = { steps: [
    { id: 'a', subject: 'Quick idea for {{name}}', body: '{{name}} in {{city}}' },
    { id: 'b', subject: '', body: 'Still there, {{nmae}}?', enabled: false },
  ] };

  assert.deepEqual(usedVariables(seq), [
    { name: 'name', known: true, stepIds: ['a'] },
    { name: 'city', known: true, stepIds: ['a'] },
    { name: 'nmae', known: false, stepIds: ['b'] },
  ]);
});

test('missingCounts counts the leads without a value, per variable', () => {
  const seq = { steps: [{ id: 'a', subject: '{{name}}', body: '{{website}} {{city}} {{nmae}}' }] };
  const leads = [lead(), lead({ website: 'roma.hu' }), lead({ name: '', address: '' })];

  const counts = missingCounts(seq, leads);

  assert.deepEqual(counts.map((c) => [c.name, c.missing, c.of]), [['name', 1, 3], ['website', 2, 3], ['city', 1, 3], ['nmae', 3, 3]]);
});

test('a long run of blanks after open braces does not stall the scan', () => {
  const started = Date.now();

  assert.deepEqual(variablesIn('{{' + ' '.repeat(20_000) + 'x'), []);
  assert.deepEqual(render('{{' + '\n'.repeat(20_000), {}).missing, []);
  assert.ok(Date.now() - started < 500);
});
