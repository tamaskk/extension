import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP_WORDS, stripQuoted, isStopRequest, subjectMatches, pushedBack, AUTO_REPLY_DELAY_MS } from './replyRules.mjs';

const OURS = 'Hi,\n\nI had an idea for your website.\n\n--\nTom Kalman · 1 Example Street, Budapest\nReply STOP and I will remove you from my list.';
const quoted = (reply) => `${reply}\n\nOn Tue, 20 Oct 2026 at 14:00, Tom Kalman <tom@itsblitzdeep.com> wrote:\n${OURS.split('\n').map((l) => '> ' + l).join('\n')}`;

test('the quoted original is cut off a Gmail reply', () => {
  assert.equal(stripQuoted(quoted('Thanks, not interested.')), 'Thanks, not interested.');
});

test('"On … wrote:" folded over two lines is still found', () => {
  const text = 'Sounds good, call me.\n\nOn Tue, 20 Oct 2026 at 14:00, Tom Kalman\n<tom@itsblitzdeep.com> wrote:\n> Hi,';

  assert.equal(stripQuoted(text), 'Sounds good, call me.');
});

test('an Outlook reply is cut at its header block or at Original Message', () => {
  assert.equal(stripQuoted('Please call tomorrow.\n\nFrom: Tom Kalman <tom@itsblitzdeep.com>\nSent: Tuesday\nSubject: Quick idea\n\nReply STOP and…'), 'Please call tomorrow.');
  assert.equal(stripQuoted('No thanks.\n\n-----Original Message-----\nReply STOP'), 'No thanks.');
});

test('a Hungarian reply is cut at "ezt írta:"', () => {
  const text = 'Köszönöm, érdekel.\n\n2026. okt. 20., K 14:00 Tom Kalman <tom@itsblitzdeep.com> ezt írta:\n> Válaszolj STOP-pal';

  assert.equal(stripQuoted(text), 'Köszönöm, érdekel.');
});

test('the signature under the delimiter is cut too', () => {
  assert.equal(stripQuoted('Call me.\n-- \nAnna\nPizzeria Roma'), 'Call me.');
});

test('a reply with nothing quoted comes back whole', () => {
  assert.equal(stripQuoted('  Just this.  '), 'Just this.');
  assert.equal(stripQuoted(''), '');
});

test('a reply that is only a stop word is a stop request, in both languages', () => {
  for (const reply of ['STOP', 'stop', 'Stop.', ' Unsubscribe ', 'REMOVE ME', 'remove', 'Leállít', 'LEIRATKOZÁS', 'Ne írj', 'Törölj!']) {
    assert.equal(isStopRequest(reply), true, reply);
  }
});

test('stop words are understood without their accents', () => {
  for (const reply of ['leallit', 'leiratkozas', 'ne irj', 'torolj', 'NE IRJ']) assert.equal(isStopRequest(reply), true, reply);
});

test('a short reply that starts with a stop word is a stop request', () => {
  for (const reply of ['Stop please', 'STOP emailing me', 'Remove me please', 'Ne írj többet']) assert.equal(isStopRequest(reply), true, reply);
});

test('a real answer over our quoted email is NOT a stop request', () => {
  // the most important case: our own footer, with its "Reply STOP", hangs under every reply
  assert.equal(isStopRequest(quoted('Thanks, this sounds interesting. Can you call me tomorrow?')), false);
  assert.equal(isStopRequest(quoted('Köszönöm, nem érdekel.')), false);
});

test('STOP above the quoted email is a stop request', () => {
  assert.equal(isStopRequest(quoted('STOP')), true);
});

test('a longer sentence that only begins with such a word is a reply, not a request', () => {
  assert.equal(isStopRequest('Stop by our office any time this week'), false);
  assert.equal(isStopRequest('Remove the old logo from the mockup and we can talk'), false);
});

test('a stop word in the middle of a sentence is not a request', () => {
  assert.equal(isStopRequest('We never stop improving, tell me more'), false);
  assert.equal(isStopRequest(''), false);
});

test('every stop word is stored the way it is compared: lower case, no accents', () => {
  for (const w of STOP_WORDS) assert.equal(w, w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
});

test('a reply from another address matches by the subject of the thread', () => {
  assert.equal(subjectMatches('Re: Quick idea for Pizzeria Roma', 'Quick idea for Pizzeria Roma'), true);
  assert.equal(subjectMatches('RE: RE: quick idea for pizzeria roma!', 'Quick idea for Pizzeria Roma'), true);
  assert.equal(subjectMatches('Válasz: Ötlet a Pizzeria Roma weboldalához', 'Ötlet a Pizzeria Roma weboldalához'), true);
});

test('another subject, or one too short to tell apart, does not match', () => {
  assert.equal(subjectMatches('Re: Invoice 2026-114', 'Quick idea for Pizzeria Roma'), false);
  assert.equal(subjectMatches('Re: Hi', 'Hi'), false);
  assert.equal(subjectMatches('Re: anything', ''), false);
});

test('a due date is pushed back, never pulled forward', () => {
  const now = new Date('2026-10-20T10:00:00.000Z');

  assert.equal(pushedBack('2026-10-21T10:00:00.000Z', now, AUTO_REPLY_DELAY_MS), '2026-10-23T10:00:00.000Z');
  assert.equal(pushedBack('2026-10-30T10:00:00.000Z', now, AUTO_REPLY_DELAY_MS), '2026-10-30T10:00:00.000Z');
  assert.equal(pushedBack('', now, AUTO_REPLY_DELAY_MS), '2026-10-23T10:00:00.000Z');
});
