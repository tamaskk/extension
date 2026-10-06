import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, tokensOf, queryWords, MAX_TOKENS } from './searchTokens.mjs';

test('normalize lower-cases and strips accents', () => {
  assert.equal(normalize('Bécs ÁRVÍZTŰRŐ Café'), 'becs arvizturo cafe');
  assert.equal(normalize(null), '');
});

test('name, category and address are split into words', () => {
  const t = tokensOf({ name: "Joe's Pizza & Grill", category: 'Pizza restaurant', address: '12 Main St, Austin, TX 78701' });
  for (const w of ['joe', 'pizza', 'grill', 'restaurant', '12', 'main', 'st', 'austin', 'tx', '78701']) assert.ok(t.includes(w), w);
  assert.equal(t.filter((x) => x === 'pizza').length, 1, 'no repeats');
  assert.ok(!t.includes('s'), 'single characters are dropped');
});

test('a phone number is searchable by its groups and as one run of digits', () => {
  const t = tokensOf({ phone: '+1 (205) 555-0199' });
  for (const w of ['205', '555', '0199', '12055550199']) assert.ok(t.includes(w), w);
});

test('an email is searchable whole, by its parts and by its domain', () => {
  const t = tokensOf({ email: 'Info@Pizza-Hut.com' });
  for (const w of ['info@pizza-hut.com', 'info', 'pizza', 'hut', 'com', 'pizza-hut.com']) assert.ok(t.includes(w), w);
});

test('empty and missing fields give no tokens', () => {
  assert.deepEqual(tokensOf({}), []);
  assert.deepEqual(tokensOf({ name: '', category: null, address: undefined, phone: '', email: '' }), []);
});

test('the token list is capped, and the name comes first', () => {
  const t = tokensOf({ name: 'Zeta Works', address: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') });
  assert.equal(t.length, MAX_TOKENS);
  assert.ok(t.includes('zeta') && t.includes('works'));
});

test('queryWords normalises like the tokens and drops one-letter words', () => {
  assert.deepEqual(queryWords('  Pizz  HUT a '), ['pizz', 'hut']);
  assert.deepEqual(queryWords('Bécs'), ['becs']);
  assert.deepEqual(queryWords('205-555'), ['205', '555']);
  assert.deepEqual(queryWords('info@pizza-hut.com'), ['info@pizza-hut.com']);
  assert.deepEqual(queryWords('x'), []);
  assert.deepEqual(queryWords(''), []);
});

test('every query word is a prefix of some token of a lead it should find', () => {
  const t = tokensOf({ name: 'Pizza Hut', category: 'Pizza restaurant', address: 'Bécsi út 12, Budapest', phone: '+36 1 234 5678', email: 'hello@pizzahut.hu' });
  const finds = (q) => queryWords(q).length > 0 && queryWords(q).every((w) => t.some((x) => x.startsWith(w)));
  for (const q of ['pizz', 'hut pizza', 'becsi', 'BUDA', '234 5678', 'hello@pizzahut', 'pizzahut.hu', '3612345678']) assert.ok(finds(q), q);
  for (const q of ['zza', 'burger', 'ut pest']) assert.ok(!finds(q), q);
});
