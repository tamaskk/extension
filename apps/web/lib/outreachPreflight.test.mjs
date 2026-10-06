import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from './outreachPreflight.mjs';

const FOOTER = 'Tom Kalman\nReply STOP and I will not write again.';
const mail = (over = {}) => ({ subject: 'Quick idea for Pizzeria Roma', text: `Hi,\n\nI had an idea.\n\n${FOOTER}`, missing: [], to: 'anna@pizzeria-roma.hu', footer: FOOTER, ...over });

test('a complete email passes', () => {
  assert.deepEqual(preflight(mail()), { ok: true, blocks: [], warnings: [] });
});

test('a variable without a value blocks the email and is named', () => {
  const r = preflight(mail({ missing: ['website', 'nmae', 'website'] }));

  assert.equal(r.ok, false);
  assert.deepEqual(r.blocks, ['No value for {{website}}, {{nmae}}.']);
});

test('an empty subject blocks the email', () => {
  assert.deepEqual(preflight(mail({ subject: '   ' })).blocks, ['The subject is empty.']);
});

test('a text that is only the footer counts as empty', () => {
  assert.deepEqual(preflight(mail({ text: `\n\n${FOOTER}` })).blocks, ['The text is empty.']);
});

test('a missing footer blocks the email', () => {
  assert.deepEqual(preflight(mail({ footer: '' })).blocks, ['There is no footer.']);
  assert.deepEqual(preflight(mail({ text: 'Hi,\n\nI had an idea.' })).blocks, ['The footer is not at the end of the text.']);
});

test('an address that is not an address blocks the email', () => {
  for (const to of ['', 'no-at-sign', 'two@@at.hu', 'space in@x.hu', 'nodot@host']) {
    assert.ok(preflight(mail({ to })).blocks.includes('The address is not a valid email address.'), to);
  }
});

test('braces left in the text block the email', () => {
  const r = preflight(mail({ text: `Hi {{first name}},\n\n${FOOTER}` }));

  assert.deepEqual(r.blocks, ['Double braces are left in the text: a variable name is mistyped.']);
});

test('a line break in the subject blocks the email', () => {
  assert.ok(preflight(mail({ subject: 'Hello\nBcc: x@y.z' })).blocks.includes('The subject has a line break in it.'));
});

test('several problems are all listed', () => {
  assert.equal(preflight({ subject: '', text: '', to: '', footer: '', missing: ['name'] }).blocks.length, 5);
});

test('a shared mailbox is a warning, not a block', () => {
  for (const to of ['info@roma.hu', 'Contact@roma.hu', 'office@roma.hu']) {
    const r = preflight(mail({ to }));

    assert.equal(r.ok, true);
    assert.equal(r.warnings.length, 1, to);
  }
});

test('a language difference is a warning', () => {
  const r = preflight(mail({ sequenceLanguage: 'en', leadLanguage: 'hu' }));

  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, ['The sequence is in en, the lead looks like hu.']);
});

test('a domain that bounced before is a warning', () => {
  const r = preflight(mail({ bouncedDomains: new Set(['pizzeria-roma.hu']) }));

  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, ['An earlier email to pizzeria-roma.hu bounced.']);
});

test('a category that is not English in an English text is a warning, when the text uses it', () => {
  const base = { sequenceLanguage: 'en', leadLanguage: 'en', category: 'Pizzéria' };

  assert.equal(preflight(mail({ ...base, usesCategory: true })).warnings.length, 1);
  assert.equal(preflight(mail({ ...base, usesCategory: false })).warnings.length, 0);
  assert.equal(preflight(mail({ ...base, usesCategory: true, category: 'Pizza restaurant' })).warnings.length, 0);
});
