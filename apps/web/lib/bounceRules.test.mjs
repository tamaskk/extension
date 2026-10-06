import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOFT_LIMIT, classifyBounce, fallbackRecipient, bounceAction, bounceRates } from './bounceRules.mjs';
import { parseDeliveryStatus } from './inboxClassify.mjs';

test('5.1.1 is a hard bounce: the address does not exist', () => {
  assert.equal(classifyBounce({ status: '5.1.1', diagnostic: 'smtp; 550-5.1.1 The email account that you tried to reach does not exist.' }), 'hard');
});

test('a domain that does not exist is a hard bounce too', () => {
  assert.equal(classifyBounce({ status: '5.1.2', diagnostic: 'DNS Error: Domain name not found' }), 'hard');
});

test('4.2.2, a full mailbox, is a soft bounce', () => {
  assert.equal(classifyBounce({ status: '4.2.2', diagnostic: 'smtp; 452-4.2.2 The email account that you tried to reach is over quota.' }), 'soft');
});

test('5.7.1 is a block, not a dead address', () => {
  assert.equal(classifyBounce({ status: '5.7.1', diagnostic: 'smtp; 550 5.7.1 Message rejected' }), 'block');
});

test('the words of a refusal make a block whatever the code says', () => {
  for (const diagnostic of [
    'smtp; 550 5.7.26 This mail has been blocked',
    'smtp; 554 Message rejected due to content restrictions',
    'smtp; 550 Service unavailable; Client host listed in blacklist',
    'smtp; 421 4.7.0 Our system has detected an unusual rate of unsolicited mail: low reputation of the sending domain',
    'smtp; 550 High probability of spam',
  ]) assert.equal(classifyBounce({ status: '5.1.1', diagnostic }), 'block', diagnostic);
});

test('without an enhanced code the SMTP reply code decides', () => {
  assert.equal(classifyBounce({ status: '', diagnostic: 'smtp; 550 No such user here' }), 'hard');
  assert.equal(classifyBounce({ status: '', diagnostic: 'smtp; 451 Temporary local problem' }), 'soft');
});

test('a report that says nothing usable is unknown', () => {
  assert.equal(classifyBounce({ status: '', diagnostic: '' }), 'unknown');
  assert.equal(classifyBounce(), 'unknown');
  assert.equal(classifyBounce({ status: '2.0.0' }), 'unknown');
});

test('the diagnostic is read out of the delivery report with the recipient and the status', () => {
  const report = 'Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; Nobody@Example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.\r\n 550 5.1.1 Please try double-checking\r\n';

  const dsn = parseDeliveryStatus(report);

  assert.equal(dsn.recipient, 'nobody@example.com');
  assert.equal(dsn.status, '5.1.1');
  assert.match(dsn.diagnostic, /does not exist\. 550 5\.1\.1 Please try/);
  assert.equal(classifyBounce(dsn), 'hard');
});

test('an unreadable bounce still gives up the address in its text', () => {
  const text = 'Hello tom@itsblitzdeep.com,\nyour message to info@pizzeria-roma.hu could not be delivered. Contact postmaster@pizzeria-roma.hu.';

  assert.equal(fallbackRecipient(text, ['tom@itsblitzdeep.com']), 'info@pizzeria-roma.hu');
});

test('a bounce with only our own address in it gives nothing', () => {
  assert.equal(fallbackRecipient('From: MAILER-DAEMON@googlemail.com To: Tom@ItsBlitzDeep.com', ['tom@itsblitzdeep.com']), '');
  assert.equal(fallbackRecipient('', []), '');
});

test('a hard bounce suppresses the address and stops the sequence', () => {
  assert.deepEqual(bounceAction('hard', 0), { kind: 'hard', suppress: true, stop: true, outcome: 'bounced', softBounces: 0 });
});

test('a block never suppresses and never stops, and is counted apart', () => {
  assert.deepEqual(bounceAction('block', 0), { kind: 'block', suppress: false, stop: false, outcome: 'blocked', softBounces: 0 });
});

test('a soft bounce is counted, and only the third one is final', () => {
  assert.equal(SOFT_LIMIT, 3);
  assert.deepEqual(bounceAction('soft', 0), { kind: 'soft', suppress: false, stop: false, outcome: '', softBounces: 1 });
  assert.deepEqual(bounceAction('soft', 1), { kind: 'soft', suppress: false, stop: false, outcome: '', softBounces: 2 });
  assert.deepEqual(bounceAction('soft', 2), { kind: 'hard', suppress: true, stop: true, outcome: 'bounced', softBounces: 3 });
});

test('an unknown bounce changes nothing by itself', () => {
  assert.deepEqual(bounceAction('unknown', 1), { kind: 'unknown', suppress: false, stop: false, outcome: '', softBounces: 1 });
});

test('the rates are shares of what was sent, and unknown while nothing was', () => {
  assert.deepEqual(bounceRates({ sent: 200, bounced: 6, blocked: 1 }), { bounced: 0.03, blocked: 0.005 });
  assert.deepEqual(bounceRates({ sent: 0, bounced: 0, blocked: 0 }), { bounced: null, blocked: null });
});
