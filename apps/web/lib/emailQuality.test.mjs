import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailQuality, bestEmail } from './emailQuality.mjs';

const SALON = { website: 'https://www.fodraszat.com/kapcsolat' };

test('noreply and its kind are never written to', () => {
  for (const e of ['noreply@valami.com', 'no-reply@valami.com', 'postmaster@valami.com', 'abuse@valami.com', 'webmaster@valami.com', 'privacy@valami.com']) {
    assert.equal(emailQuality(e, {}).ok, false, e);
  }
});

test('a person at the business\'s own domain is the best address', () => {
  assert.deepEqual(emailQuality('john@fodraszat.com', SALON), { ok: true, reason: 'a person at the business\'s own domain', rank: 1 });
});

test('info@ at the own domain is usable, and ranks below a person', () => {
  const info = emailQuality('info@fodraszat.com', SALON);

  assert.equal(info.ok, true);
  assert.ok(info.rank > emailQuality('john@fodraszat.com', SALON).rank);
});

test('an address at another company\'s domain is the agency, and is not written to', () => {
  const q = emailQuality('hello@webugynokseg.hu', SALON);

  assert.equal(q.ok, false);
  assert.match(q.reason, /agency/);
});

test('what is not an address is refused', () => {
  for (const e of ['nemletezik@@', '', 'no-at-sign', 'two@@at.hu', 'space in@x.hu', 'a@b', 'a..b@x.hu', null, undefined]) {
    assert.equal(emailQuality(e, {}).ok, false, String(e));
  }
});

test('placeholders and file names the collector took for addresses are refused', () => {
  for (const e of ['test@fodraszat.com', 'name@example.com', 'you@domain.com', 'logo@2x.png', 'abc123@sentry.io', 'user@wixpress.com']) {
    assert.equal(emailQuality(e, SALON).ok, false, e);
  }
});

test('a gmail address is usable, as the last choice', () => {
  assert.deepEqual(emailQuality('fodraszat.budapest@gmail.com', SALON), { ok: true, reason: 'an address at a mailbox provider', rank: 5 });
});

test('a subdomain of the website\'s domain counts as the same business', () => {
  assert.equal(emailQuality('anna@mail.fodraszat.com', SALON).rank, 1);
  assert.equal(emailQuality('anna@fodraszat.com', { website: 'shop.fodraszat.com' }).rank, 1);
});

test('without a website to compare with, a company domain is accepted at a lower rank', () => {
  assert.equal(emailQuality('anna@fodraszat.com', {}).rank, 3);
  assert.equal(emailQuality('info@fodraszat.com', { website: '' }).rank, 4);
});

test('a Facebook page is not a website to compare with', () => {
  assert.equal(emailQuality('anna@fodraszat.com', { website: 'https://facebook.com/fodraszat' }).rank, 3);
});

test('the address is compared without case and spaces', () => {
  assert.equal(emailQuality('  John@Fodraszat.COM ', SALON).rank, 1);
});

test('bestEmail takes the best-ranked address of the lead, one only', () => {
  const lead = { ...SALON, email: 'info@fodraszat.com', emails: ['noreply@fodraszat.com', 'kata@fodraszat.com', 'kata@gmail.com'] };

  assert.deepEqual(bestEmail(lead), { email: 'kata@fodraszat.com', rank: 1, reason: 'a person at the business\'s own domain' });
});

test('bestEmail keeps the lead\'s own email when nothing ranks better', () => {
  const lead = { ...SALON, email: 'info@fodraszat.com', emails: ['info@fodraszat.com', 'kapcsolat@fodraszat.com'] };

  assert.equal(bestEmail(lead).email, 'info@fodraszat.com');
});

test('a lead with only unusable addresses has none, and says why', () => {
  const none = bestEmail({ ...SALON, email: 'hello@webugynokseg.hu', emails: ['noreply@fodraszat.com'] });

  assert.equal(none.email, '');
  assert.match(none.reason, /agency/);
  assert.deepEqual(bestEmail({}), { email: '', rank: 99, reason: 'no address' });
});
