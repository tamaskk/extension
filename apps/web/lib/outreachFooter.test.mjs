import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footerFor, withFooter } from './outreachFooter.mjs';
import { preflight } from './outreachPreflight.mjs';
import { isStopRequest } from './replyRules.mjs';

const ME = {
  en: { name: 'Tamás Kálmán', address: '1 Example Street, 1051 Budapest, Hungary' },
  hu: { name: 'Kálmán Tamás', address: '1051 Budapest, Példa utca 1.' },
};

test('the English footer has the name, the postal address and the way to stop', () => {
  assert.equal(footerFor('en', ME), '--\nTamás Kálmán · 1 Example Street, 1051 Budapest, Hungary\nIf you would rather not hear from me again, reply STOP and I will remove you from my list.');
});

test('the Hungarian footer has the name and the address in their Hungarian form', () => {
  assert.equal(footerFor('hu', ME), '--\nKálmán Tamás · 1051 Budapest, Példa utca 1.\nHa nem szeretne több megkeresést kapni, válaszoljon a STOP szóval, és törlöm az elérhetőségét a listáról.');
});

test('an unknown language gets the English footer', () => {
  assert.equal(footerFor('de', ME), footerFor('en', ME));
  assert.equal(footerFor(undefined, ME), footerFor('en', ME));
});

test('the footer goes after the text, behind the signature delimiter', () => {
  assert.equal(withFooter('Hi,\n\nAn idea.\n\n', 'en', ME), `Hi,\n\nAn idea.\n\n${footerFor('en', ME)}`);
});

test('without a name or a postal address there is no footer at all', () => {
  assert.equal(footerFor('en', { en: { name: 'Tamás Kálmán', address: '' } }), '');
  assert.equal(footerFor('en', { en: { name: ' ', address: 'Somewhere 1' } }), '');
  assert.equal(withFooter('Hi', 'en', {}), 'Hi');
});

test('a text with its footer passes the preflight, a text without one does not', () => {
  const footer = footerFor('en', ME);

  assert.equal(preflight({ subject: 'S', text: withFooter('Hi,\n\nAn idea.', 'en', ME), to: 'a@b.hu', footer, missing: [] }).ok, true);
  assert.equal(preflight({ subject: 'S', text: 'Hi,\n\nAn idea.', to: 'a@b.hu', footer, missing: [] }).ok, false);
  assert.equal(preflight({ subject: 'S', text: 'Hi', to: 'a@b.hu', footer: footerFor('en', {}), missing: [] }).ok, false);
});

test('the word the footer asks for is a word the reply rules understand, in both languages', () => {
  assert.match(footerFor('en', ME), /STOP/);
  assert.match(footerFor('hu', ME), /STOP/);
  assert.equal(isStopRequest('STOP'), true);
});

test('one language can be filled in while the other is still empty', () => {
  const onlyEnglish = { en: ME.en, hu: { name: 'Kálmán Tamás', address: '' } };

  assert.notEqual(footerFor('en', onlyEnglish), '');
  assert.equal(footerFor('hu', onlyEnglish), '');
});

test('a company name is a line of its own under the name, and is left out when empty', () => {
  const withCompany = { en: { ...ME.en, company: 'Blitzdeep' } };

  const lines = footerFor('en', withCompany).split('\n');

  assert.equal(lines[2], 'Blitzdeep');
  assert.equal(lines.length, 4);
  assert.equal(footerFor('en', ME).split('\n').length, 3);
});
