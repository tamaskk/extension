import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, domainOf, isCommonProvider, domainRowKey, lookupKeys } from './suppressionRules.mjs';

test('normalizeDomain reads a domain however it was typed', () => {
  for (const typed of ['Example.com', ' @example.com ', 'https://www.example.com/contact', 'info@EXAMPLE.com', 'www.example.com']) {
    assert.equal(normalizeDomain(typed), 'example.com', typed);
  }
});

test('normalizeDomain gives nothing for what is not a domain', () => {
  for (const typed of ['', 'localhost', 'not a domain', null, undefined]) assert.equal(normalizeDomain(typed), '', String(typed));
});

test('domainOf takes the domain of an address, lower-cased', () => {
  assert.equal(domainOf('Anna <Anna@Pizzeria-Roma.HU>'), 'pizzeria-roma.hu');
  assert.equal(domainOf('no address'), '');
});

test('mailbox providers are not company domains', () => {
  for (const d of ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'GMAIL.COM', 'freemail.hu']) {
    assert.equal(isCommonProvider(d), true, d);
  }
  assert.equal(isCommonProvider('pizzeria-roma.hu'), false);
});

test('a domain-wide row is keyed by @domain', () => {
  assert.equal(domainRowKey('Example.com'), '@example.com');
  assert.equal(domainRowKey('nonsense'), '');
});

test('an address on a company domain is checked by address and by domain', () => {
  const keys = lookupKeys('Anna@Pizzeria-Roma.hu');

  assert.deepEqual(keys, { email: 'anna@pizzeria-roma.hu', domain: 'pizzeria-roma.hu' });
});

test('an address at a mailbox provider is checked by address only', () => {
  const keys = lookupKeys('someone@gmail.com');

  assert.deepEqual(keys, { email: 'someone@gmail.com', domain: '' });
});

test('a mailbox provider passed as the domain is still not checked', () => {
  assert.equal(lookupKeys('someone@gmail.com', 'gmail.com').domain, '');
});

test('an unusable address has no key', () => {
  assert.deepEqual(lookupKeys('not an address'), { email: '', domain: '' });
});
