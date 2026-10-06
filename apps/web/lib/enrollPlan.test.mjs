import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPREAD_MINUTES, pickEmail, languageOfCountry, eligibleSenders, enrolmentBlock, planEnrollment, addSkipped } from './enrollPlan.mjs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const step = (id, delayDays) => ({ id, delayDays, subject: `S ${id}`, body: `B ${id}`, sameThread: false, enabled: true });
const sequence = (over = {}) => ({ sequenceId: 'seq1', name: 'No website', language: 'hu', senderIds: [], steps: [step('a', 0), step('b', 3)], ...over });
const sender = (senderId, language, over = {}) => ({ senderId, language, active: true, hasPassword: true, dailyLimit: 20, firstSendAt: '', warmup: { enabled: false, tiers: [] }, ...over });
const lead = (key, email, over = {}) => ({ project: 'pizza Budapest', key, name: `Lead ${key}`, email, emails: [], seqStatus: '', country: 'Hungary', lat: 47.4979, lng: 19.0402, address: 'Budapest, Hungary', ...over });
const ctx = (over = {}) => ({ sequence: sequence(), senders: [sender('tamas', 'hu'), sender('tom', 'en')], isSuppressed: () => false, busyDomains: new Map(), now: NOW, random: () => 0.5, ...over });

test('pickEmail gives the lead email, or else an address the website lookup found', () => {
  assert.equal(pickEmail({ email: ' Anna@Roma.hu ', emails: ['info@roma.hu'] }), 'anna@roma.hu');
  assert.equal(pickEmail({ email: '', emails: ['Found@Roma.hu', 'second@roma.hu'] }), 'found@roma.hu');
  assert.equal(pickEmail({ email: 'not an address', emails: ['also bad'] }), '');
  assert.equal(pickEmail({}), '');
});

test('pickEmail takes the best-ranked address, not the first', () => {
  assert.equal(pickEmail({ website: 'roma.hu', email: 'info@roma.hu', emails: ['noreply@roma.hu', 'anna@roma.hu'] }), 'anna@roma.hu');
});

test('a lead in Hungary is written in Hungarian, in any other known country in English', () => {
  assert.equal(languageOfCountry('Hungary'), 'hu');
  assert.equal(languageOfCountry('USA'), 'en');
  assert.equal(languageOfCountry('Other'), '');
  assert.equal(languageOfCountry(undefined), '');
});

test('only senders that are on, have a password and speak the language may serve a sequence', () => {
  const senders = [sender('a', 'hu'), sender('b', 'hu', { active: false }), sender('c', 'hu', { hasPassword: false }), sender('d', 'en')];

  assert.deepEqual(eligibleSenders(sequence(), senders).map((s) => s.senderId), ['a']);
});

test('a sequence that names its senders gets only those', () => {
  const senders = [sender('a', 'hu'), sender('b', 'hu')];

  assert.deepEqual(eligibleSenders(sequence({ senderIds: ['b'] }), senders).map((s) => s.senderId), ['b']);
});

test('a sequence that is not complete, or has no sender, takes no leads', () => {
  assert.match(enrolmentBlock(sequence({ steps: [] }), [sender('a', 'hu')]), /not complete/);
  assert.match(enrolmentBlock(sequence(), [sender('tom', 'en')]), /No sender account/);
  assert.equal(enrolmentBlock(sequence(), [sender('a', 'hu')]), '');
});

test('a lead that passes gets the first step, a sender, the address and an active state', () => {
  const { take } = planEnrollment([lead('k1', 'info@roma.hu')], ctx());

  assert.equal(take.length, 1);
  assert.deepEqual(take[0].seq, {
    sequenceId: 'seq1', stepId: 'a', nextStepAt: '2026-10-20T11:00:00.000Z', senderId: 'tamas', to: 'info@roma.hu',
    language: 'hu', tz: 'Europe/Budapest', offer: 'social', offerScore: 0, offerReasons: ['határeset'], offerManual: false,
    threadSubject: '', lastMessageId: '', sentStepIds: [], status: 'active', lastSentAt: '', claimedAt: '', errorCount: 0,
  });
});

test('the lead\'s time zone is found at enrolment from its coordinates', () => {
  const leads = [lead('k1', 'a@a.com', { lat: 34.0522, lng: -118.2437, address: 'Los Angeles, CA, USA', country: 'USA' }), lead('k2', 'b@b.hu', { lat: null, lng: null })];

  const { take } = planEnrollment(leads, ctx({ ignoreLanguage: true }));

  assert.deepEqual(take.map((t) => t.seq.tz), ['America/Los_Angeles', 'Europe/Budapest']);
});

test('the first emails are spread over two hours, not due at one moment', () => {
  let n = 0;
  const random = () => (n++ % 50) / 50;
  const leads = Array.from({ length: 50 }, (_, i) => lead(`k${i}`, `info@firm${i}.hu`));

  const times = planEnrollment(leads, ctx({ random })).take.map((t) => Date.parse(t.seq.nextStepAt) - NOW.getTime());

  assert.equal(times.length, 50);
  assert.ok(Math.min(...times) >= 0);
  assert.ok(Math.max(...times) < SPREAD_MINUTES * 60_000);
  assert.ok(new Set(times).size > 40);
});

test('a lead without an address, or with one that must not be written to, is left out', () => {
  const { take, skipped } = planEnrollment([lead('k1', ''), lead('k2', 'nope'), lead('k3', 'noreply@roma.hu')], ctx());

  assert.equal(take.length, 0);
  assert.equal(skipped.noEmail, 1);
  assert.equal(skipped.badEmail, 2);
});

test('a lead whose domain takes no mail is left out', () => {
  const hasMx = (domain) => domain !== 'dead.hu';

  const { take, skipped } = planEnrollment([lead('k1', 'anna@dead.hu'), lead('k2', 'bela@alive.hu')], ctx({ hasMx }));

  assert.deepEqual(take.map((t) => t.key), ['k2']);
  assert.equal(skipped.noMx, 1);
});

test('a lead without a known time zone is left out', () => {
  const nowhere = lead('k1', 'a@a.hu', { lat: null, lng: null, address: '', country: 'Other' });

  const { take, skipped } = planEnrollment([nowhere], ctx({ ignoreLanguage: true }));

  assert.equal(take.length, 0);
  assert.equal(skipped.noTimezone, 1);
});

test('the second-round offer is decided at enrolment, with its reasons', () => {
  const clinic = lead('k1', 'info@klinika.hu', { category: 'Fogászati klinika', reviewCount: 400, rating: 3.1, phone: '+36 1 234 5678' });

  const { take } = planEnrollment([clinic], ctx());

  assert.equal(take[0].seq.offer, 'ai');
  assert.equal(take[0].seq.offerManual, false);
  assert.ok(take[0].seq.offerReasons.includes('időpontos kategória'));
});

test('a lead already in a sequence is left out, so a second try does nothing', () => {
  const { take, skipped } = planEnrollment([lead('k1', 'info@roma.hu', { seqStatus: 'active' })], ctx());

  assert.equal(take.length, 0);
  assert.equal(skipped.active, 1);
});

test('a lead on hold, or waiting for its follow-ups, is left out like a running one', () => {
  assert.equal(planEnrollment([lead('k1', 'info@roma.hu', { seqStatus: 'hold' })], ctx()).skipped.active, 1);
  assert.equal(planEnrollment([lead('k2', 'info@roma.hu', { seqStatus: 'waiting' })], ctx()).skipped.active, 1);
});

test('an address, or a company, that was written to before does not get an opening email again', () => {
  const wasMailed = (email, domain) => email === 'anna@gmail.com' || domain === 'roma.hu';
  const leads = [lead('k1', 'anna@gmail.com'), lead('k2', 'gyor@roma.hu'), lead('k3', 'bela@gmail.com'), lead('k4', 'info@uj.hu')];

  const { take, skipped } = planEnrollment(leads, ctx({ wasMailed }));

  assert.deepEqual(take.map((t) => t.key), ['k3', 'k4']);
  assert.equal(skipped.alreadyMailed, 2);
});

test('a lead who replied earlier is left out; a stopped or finished one may go in again', () => {
  const leads = [lead('k1', 'a@a.hu', { seqStatus: 'replied' }), lead('k2', 'b@b.hu', { seqStatus: 'stopped' }), lead('k3', 'c@c.hu', { seqStatus: 'finished' })];

  const { take, skipped } = planEnrollment(leads, ctx());

  assert.deepEqual(take.map((t) => t.key), ['k2', 'k3']);
  assert.equal(skipped.replied, 1);
});

test('a suppressed address is left out', () => {
  const isSuppressed = (email) => email === 'stop@roma.hu';

  const { take, skipped } = planEnrollment([lead('k1', 'stop@roma.hu'), lead('k2', 'ok@other.hu')], ctx({ isSuppressed }));

  assert.deepEqual(take.map((t) => t.key), ['k2']);
  assert.equal(skipped.suppressed, 1);
});

test('an address at a suppressed company domain is left out', () => {
  const isSuppressed = (_email, domain) => domain === 'roma.hu';

  assert.equal(planEnrollment([lead('k1', 'anyone@roma.hu')], ctx({ isSuppressed })).skipped.suppressed, 1);
});

test('a lead in another language is left out and counted, unless that is overridden', () => {
  const leads = [lead('k1', 'a@a.hu'), lead('k2', 'b@b.com', { country: 'USA' }), lead('k3', 'c@c.com', { country: 'Other' })];

  const strict = planEnrollment(leads, ctx());
  const loose = planEnrollment(leads, ctx({ ignoreLanguage: true }));

  assert.deepEqual(strict.take.map((t) => t.key), ['k1']);
  assert.equal(strict.skipped.language, 1);
  assert.equal(strict.skipped.languageUnknown, 1);
  assert.deepEqual(strict.byLanguage, { hu: 1, en: 1, unknown: 1 });
  assert.equal(loose.take.length, 3);
});

test('two leads at one company domain: only the first goes in', () => {
  const { take, skipped } = planEnrollment([lead('k1', 'budapest@roma.hu'), lead('k2', 'gyor@roma.hu')], ctx());

  assert.deepEqual(take.map((t) => t.key), ['k1']);
  assert.equal(skipped.domain, 1);
});

test('a lead is left out when its company domain already has a running sequence', () => {
  const busyDomains = new Map([['roma.hu', ['k0']]]);

  assert.equal(planEnrollment([lead('k1', 'info@roma.hu')], ctx({ busyDomains })).skipped.domain, 1);
});

test('two leads with gmail.com addresses both go in', () => {
  const { take } = planEnrollment([lead('k1', 'anna@gmail.com'), lead('k2', 'bela@gmail.com')], ctx());

  assert.equal(take.length, 2);
});

test('the run stops taking leads when its room is used up', () => {
  const leads = Array.from({ length: 5 }, (_, i) => lead(`k${i}`, `info@firm${i}.hu`));

  const { take, skipped } = planEnrollment(leads, ctx({ room: 2 }));

  assert.equal(take.length, 2);
  assert.equal(skipped.overLimit, 3);
});

test('a lead that did not fit does not hold its company domain', () => {
  const leads = [lead('k1', 'a@one.hu'), lead('k2', 'b@two.hu'), lead('k3', 'c@two.hu')];

  const { skipped } = planEnrollment(leads, ctx({ room: 1 }));

  assert.equal(skipped.overLimit, 2);
  assert.equal(skipped.domain, 0);
});

test('with no sender for the language nobody is enrolled', () => {
  const { take, skipped } = planEnrollment([lead('k1', 'a@a.hu')], ctx({ senders: [sender('tom', 'en')] }));

  assert.equal(take.length, 0);
  assert.equal(skipped.noSender, 1);
});

test('the leads are shared between the senders by their limits', () => {
  const senders = [sender('small', 'hu', { dailyLimit: 10 }), sender('big', 'hu', { dailyLimit: 35 })];
  const leads = Array.from({ length: 400 }, (_, i) => lead(`k${i}`, `info@firm${i}.hu`));

  const { bySender } = planEnrollment(leads, ctx({ senders }));

  assert.equal(bySender.small + bySender.big, 400);
  assert.ok(bySender.big > bySender.small * 2);
});

test('every lead is either taken or counted under one reason', () => {
  const leads = [lead('k1', ''), lead('k2', 'a@a.hu', { seqStatus: 'active' }), lead('k3', 'b@b.hu'), lead('k4', 'c@b.hu'), lead('k5', 'd@d.com', { country: 'USA' })];

  const { take, skipped } = planEnrollment(leads, ctx());

  assert.equal(take.length + Object.values(skipped).reduce((a, b) => a + b, 0), leads.length);
});

test('addSkipped sums the counts of two chunks', () => {
  const a = planEnrollment([lead('k1', '')], ctx()).skipped;
  const b = planEnrollment([lead('k2', ''), lead('k3', 'x@x.hu', { seqStatus: 'active' })], ctx()).skipped;

  const total = addSkipped(a, b);

  assert.equal(total.noEmail, 2);
  assert.equal(total.active, 1);
});
