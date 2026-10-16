import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyFor, countryCode, isItType, sourceOf } from './melodiaPlan.mjs';

const HU_IT = { type: 'it companies', country: 'Hungary' };
const lead = (over = {}) => ({ name: 'Acme Kft', website: 'https://acme.hu/', websiteStatus: 'HAS_WEBSITE', category: 'Software company', email: 'info@acme.hu', emails: ['info@acme.hu', 'peter@acme.hu', 'noreply@acme.hu'], emailCheckedAt: '2026-10-16T10:00:00.000Z', ...over });

test('an IT company with its own website goes to Melodia, in its shape', () => {
  assert.deepEqual(companyFor(lead(), HU_IT), {
    company: 'Acme Kft', website: 'https://acme.hu/', country: 'HU', source: 'gridleads_it-companies_hu', industry: 'Software company',
    email: 'peter@acme.hu', otherEmails: ['info@acme.hu'],
  });
});

test('only the leads of an IT search go', () => {
  assert.equal(companyFor(lead(), { type: 'restaurants', country: 'Hungary' }), null);
  for (const t of ['software companies', 'IT companies', 'app developers', 'it consultants', 'it services']) assert.ok(isItType(t), t);
  assert.equal(isItType('computer repair'), false);
});

test('without a website of its own, or before its email lookup, a lead does not go', () => {
  assert.equal(companyFor(lead({ website: '', websiteStatus: 'NO_WEBSITE' }), HU_IT), null);
  assert.equal(companyFor(lead({ website: 'https://www.facebook.com/acme', websiteStatus: 'FACEBOOK_ONLY' }), HU_IT), null);
  assert.equal(companyFor(lead({ website: 'https://lomyu.me/acme-123-us' }), HU_IT), null);
  assert.equal(companyFor(lead({ emailCheckedAt: '' }), HU_IT), null);
});

test('a lead without a usable address still goes, without one', () => {
  const c = companyFor(lead({ email: '', emails: [] }), HU_IT);
  assert.equal(c.email, undefined);
  assert.equal(c.otherEmails, undefined);
});

test('the country is a two-letter code, INT when it is not known', () => {
  assert.equal(countryCode('USA'), 'US');
  assert.equal(countryCode('UK'), 'GB');
  assert.equal(countryCode('Other'), 'INT');
  assert.equal(sourceOf('software companies', 'US'), 'gridleads_software-companies_us');
  assert.equal(companyFor(lead(), { type: 'app developers', country: 'Other' }).source, 'gridleads_app-developers_int');
});
