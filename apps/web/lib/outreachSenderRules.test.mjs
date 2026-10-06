import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENDER_DEFAULTS, cleanSender, connectionFailure, connectionMessage, mailEndpointAllowed } from './outreachSenderRules.mjs';
import { DEFAULT_TIERS } from './warmup.mjs';

const full = (over = {}) => ({ label: 'Tom EN', fromName: 'Tom Kalman', fromEmail: 'Tom@ItsBlitzDeep.com', language: 'en', ...over });

test('a new account gets the Gmail hosts and ports and logs in with its own address', () => {
  const { value, errors } = cleanSender(full(), true);

  assert.deepEqual(errors, []);
  assert.equal(value.fromEmail, 'tom@itsblitzdeep.com');
  assert.equal(value.authUser, 'tom@itsblitzdeep.com');
  assert.deepEqual([value.smtpHost, value.smtpPort, value.imapHost, value.imapPort], [SENDER_DEFAULTS.smtpHost, 587, SENDER_DEFAULTS.imapHost, 993]);
  assert.equal(value.dailyLimit, 100);
  assert.deepEqual(value.warmup, { enabled: true, tiers: DEFAULT_TIERS });
});

test('a new account without the required fields lists every problem', () => {
  const { errors } = cleanSender({ language: 'de', fromEmail: 'nope' }, true);

  assert.equal(errors.length, 5);
});

test('a new account sends Monday to Friday from 7 to 19 unless told otherwise', () => {
  const { value } = cleanSender(full(), true);

  assert.deepEqual([value.sendDays, value.windowFrom, value.windowTo], [[1, 2, 3, 4, 5], 7, 19]);
});

test('the send window must have a day and end after it starts', () => {
  assert.equal(cleanSender({ sendDays: [] }, false).errors.length, 1);
  assert.equal(cleanSender({ sendDays: [0, 8] }, false).errors.length, 1);
  assert.equal(cleanSender({ windowFrom: 19, windowTo: 9 }, false).errors.length, 1);
  assert.equal(cleanSender({ windowFrom: 9.5, windowTo: 19 }, false).errors.length, 1);
  assert.deepEqual(cleanSender({ sendDays: [6, 1, 1], windowFrom: '9', windowTo: '17' }, false).value, { sendDays: [1, 6], windowFrom: 9, windowTo: 17 });
});

test('an edit touches only the fields that were sent', () => {
  const { value, errors } = cleanSender({ notes: ' warm-up restarted ', active: true }, false);

  assert.deepEqual(errors, []);
  assert.deepEqual(value, { notes: 'warm-up restarted', active: true });
});

test('active is true only for a real true', () => {
  assert.equal(cleanSender({ active: 'yes' }, false).value.active, false);
  assert.equal(cleanSender({ active: 1 }, false).value.active, false);
});

test('a bad host or port is an error', () => {
  const { errors } = cleanSender({ smtpHost: 'not a host', smtpPort: 70000, imapPort: 'abc' }, false);

  assert.equal(errors.length, 3);
});

test('an account cannot be pointed at another mail server', () => {
  for (const host of ['mx.attacker.tld', '127.0.0.1', '169.254.169.254', 'smtp.gmail.com.attacker.tld', 'localhost.localdomain']) {
    assert.equal(cleanSender({ smtpHost: host }, false).errors.length, 1, host);
    assert.equal(cleanSender({ imapHost: host }, false).errors.length, 1, host);
  }
});

test('only the Gmail ports are allowed', () => {
  assert.deepEqual(cleanSender({ smtpPort: 465, imapPort: 993 }, false).errors, []);
  assert.equal(cleanSender({ smtpPort: 25 }, false).errors.length, 1);
  assert.equal(cleanSender({ imapPort: 143 }, false).errors.length, 1);
});

test('mailEndpointAllowed checks a stored host and port before a connection', () => {
  assert.equal(mailEndpointAllowed('smtp', 'smtp.gmail.com', 587), true);
  assert.equal(mailEndpointAllowed('smtp', 'SMTP.Gmail.com', '465'), true);
  assert.equal(mailEndpointAllowed('imap', 'imap.gmail.com', 993), true);
  assert.equal(mailEndpointAllowed('smtp', 'mx.attacker.tld', 587), false);
  assert.equal(mailEndpointAllowed('imap', 'smtp.gmail.com', 993), false);
  assert.equal(mailEndpointAllowed('smtp', undefined, undefined), false);
  assert.equal(mailEndpointAllowed('pop', 'smtp.gmail.com', 587), false);
});

test('control characters are dropped from text fields', () => {
  const { value } = cleanSender({ fromName: 'Tom\r\nBcc: x@y.z', label: 'EN\u0000' }, false);

  assert.equal(value.fromName, 'TomBcc: x@y.z');
  assert.equal(value.label, 'EN');
});

test('the daily ceiling is a whole number in range, and 100 when left empty', () => {
  assert.equal(cleanSender({ dailyLimit: '' }, false).value.dailyLimit, 100);
  assert.equal(cleanSender({ dailyLimit: '25' }, false).value.dailyLimit, 25);
  assert.equal(cleanSender({ dailyLimit: 0 }, false).value.dailyLimit, 0);
  for (const bad of [-1, 2.5, 5000, 'many']) assert.equal(cleanSender({ dailyLimit: bad }, false).errors.length, 1, String(bad));
});

test('warm-up tiers are stored sorted by start day', () => {
  const tiers = [{ fromDay: 14, dailyLimit: 30 }, { fromDay: 0, dailyLimit: 10 }];

  const { value, errors } = cleanSender({ warmup: { enabled: false, tiers } }, false);

  assert.deepEqual(errors, []);
  assert.deepEqual(value.warmup, { enabled: false, tiers: [{ fromDay: 0, dailyLimit: 10 }, { fromDay: 14, dailyLimit: 30 }] });
});

test('unsound warm-up tiers are refused', () => {
  const { errors } = cleanSender({ warmup: { enabled: true, tiers: [{ fromDay: 3, dailyLimit: 10 }] } }, false);

  assert.deepEqual(errors, ['The first tier must start on day 0.']);
});

test('the password is never part of the cleaned fields', () => {
  const { value } = cleanSender(full({ password: 'abcd efgh ijkl mnop', authSecret: 'v1:x:y:z' }), true);

  assert.equal('password' in value, false);
  assert.equal('authSecret' in value, false);
});

test('a refused login is told apart from an unreachable server', () => {
  assert.equal(connectionFailure({ code: 'EAUTH' }), 'auth');
  assert.equal(connectionFailure({ authenticationFailed: true }), 'auth');
  assert.equal(connectionFailure({ code: 'ETIMEDOUT' }), 'unreachable');
  assert.equal(connectionFailure({ code: 'ENOTFOUND' }), 'unreachable');
  assert.equal(connectionFailure(new Error('535-5.7.8 Username and Password not accepted for tom@itsblitzdeep.com')), 'failed');
  assert.equal(connectionFailure(null), 'failed');
});

test('the message of a failed test is our own sentence', () => {
  const provider = '535-5.7.8 Username and Password not accepted for tom@itsblitzdeep.com';

  const message = connectionMessage('SMTP', connectionFailure({ code: 'EAUTH', response: provider, message: provider }));

  assert.equal(message, 'SMTP: the server refused the login name or the app password.');
  assert.equal(connectionMessage('IMAP', 'ok'), 'IMAP works.');
});
