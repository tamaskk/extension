import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHeaders, normalizeEmail, classifyMessage, pickParts, decodePart, textSnippet, parseDeliveryStatus, mailAuth,
} from './inboxClassify.mjs';

test('parseHeaders joins folded lines and lower-cases the names', () => {
  const raw = 'Content-Type: multipart/report;\r\n report-type=delivery-status\r\nAuto-Submitted: auto-replied\r\n\r\n';

  const h = parseHeaders(raw);

  assert.equal(h['content-type'], 'multipart/report; report-type=delivery-status');
  assert.equal(h['auto-submitted'], 'auto-replied');
});

test('normalizeEmail takes the address out of a display form', () => {
  assert.equal(normalizeEmail('Kovács Anna <Anna@Example.HU>'), 'anna@example.hu');
  assert.equal(normalizeEmail('rfc822; bob@example.com'), 'bob@example.com');
  assert.equal(normalizeEmail('no address here'), '');
});

test('mail from mailer-daemon or postmaster is a bounce', () => {
  assert.equal(classifyMessage({ fromAddress: 'MAILER-DAEMON@googlemail.com', subject: 'Delivery Status Notification (Failure)', headers: {} }), 'bounce');
  assert.equal(classifyMessage({ fromAddress: 'postmaster@outlook.com', subject: 'Undeliverable', headers: {} }), 'bounce');
});

test('a delivery-status report is a bounce whoever sent it', () => {
  const headers = { 'content-type': 'multipart/report; report-type=delivery-status; boundary="x"' };

  assert.equal(classifyMessage({ fromAddress: 'bounces@mx.example.com', subject: 'Returned mail', headers }), 'bounce');
});

test('a bounce stays a bounce even when it carries auto-reply markers', () => {
  const headers = { 'auto-submitted': 'auto-replied' };

  assert.equal(classifyMessage({ fromAddress: 'mailer-daemon@example.com', subject: 'Automatic reply', headers }), 'bounce');
});

test('auto-reply headers mark the message as automatic, not as a reply', () => {
  for (const headers of [{ 'auto-submitted': 'auto-replied' }, { 'auto-submitted': 'auto-generated' }, { 'x-autoreply': 'yes' }, { precedence: 'auto_reply' }]) {
    assert.equal(classifyMessage({ fromAddress: 'anna@example.hu', subject: 'Re: your website', headers }), 'auto');
  }
});

test('Auto-Submitted: no is an ordinary message', () => {
  assert.equal(classifyMessage({ fromAddress: 'anna@example.hu', subject: 'Re: your website', headers: { 'auto-submitted': 'no' } }), 'human');
});

test('an out-of-office subject is automatic in English and Hungarian', () => {
  for (const subject of ['Automatic reply: your website', 'Out of office', 'Out of the Office until Monday', 'Automatikus válasz: weboldal', 'Házon kívül']) {
    assert.equal(classifyMessage({ fromAddress: 'anna@example.hu', subject, headers: {} }), 'auto');
  }
});

test('everything else is a human reply', () => {
  assert.equal(classifyMessage({ fromAddress: 'anna@example.hu', subject: 'Re: your website', headers: {} }), 'human');
  assert.equal(classifyMessage({ fromAddress: 'anna@example.hu', subject: 'Re: I was out of office, sorry', headers: {} }), 'human');
});

test('pickParts prefers plain text over HTML and skips attachments', () => {
  const structure = { type: 'multipart/mixed', childNodes: [
    { part: '1', type: 'multipart/alternative', childNodes: [
      { part: '1.1', type: 'text/plain', encoding: 'quoted-printable', parameters: { charset: 'iso-8859-2' } },
      { part: '1.2', type: 'text/html', encoding: 'base64' },
    ] },
    { part: '2', type: 'text/plain', disposition: 'attachment' },
  ] };

  const parts = pickParts(structure);

  assert.deepEqual(parts.text, { part: '1.1', type: 'text/plain', encoding: 'quoted-printable', charset: 'iso-8859-2' });
  assert.equal(parts.status, null);
});

test('pickParts finds the delivery report of a bounce', () => {
  const structure = { type: 'multipart/report', childNodes: [
    { part: '1', type: 'text/plain', encoding: '7bit' },
    { part: '2', type: 'message/delivery-status' },
    { part: '3', type: 'message/rfc822', childNodes: [{ part: '3.1', type: 'text/html' }] },
  ] };

  const parts = pickParts(structure);

  assert.equal(parts.text.part, '1');
  assert.equal(parts.status, '2');
});

test('a message that is not multipart is read as part 1', () => {
  assert.equal(pickParts({ type: 'text/html', encoding: 'base64' }).text.part, '1');
  assert.equal(pickParts(undefined).text, null);
});

test('decodePart reads quoted-printable in the given charset', () => {
  const buf = Buffer.from('K=F6sz=F6n=F6m, =E9rdekel=\r\n az aj=E1nlat', 'latin1');

  assert.equal(decodePart(buf, 'quoted-printable', 'iso-8859-2'), 'Köszönöm, érdekel az ajánlat');
});

test('decodePart reads base64 that was cut inside a group', () => {
  const whole = Buffer.from('Köszönöm, érdekel', 'utf8').toString('base64');

  const text = decodePart(Buffer.from(whole.slice(0, whole.length - 3), 'latin1'), 'base64', 'utf-8');

  assert.ok('Köszönöm, érdekel'.startsWith(text));
  assert.ok(text.length >= 12);
});

test('decodePart falls back to UTF-8 on an unknown charset', () => {
  assert.equal(decodePart(Buffer.from('hello', 'latin1'), '7bit', 'x-not-a-charset'), 'hello');
});

test('textSnippet strips HTML and cuts to the limit', () => {
  const html = '<style>p{color:red}</style><p>Hello&nbsp;there</p><p>A &amp; B</p>';

  assert.equal(textSnippet(html, 'text/html'), 'Hello there A & B');
  assert.equal(textSnippet('abcdef', 'text/plain', 3), 'abc');
});

test('parseDeliveryStatus reads who the bounce is about and why', () => {
  const report = 'Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; Nobody@Example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.\r\n';

  assert.deepEqual(parseDeliveryStatus(report), { recipient: 'nobody@example.com', status: '5.1.1', action: 'failed', diagnostic: 'smtp; 550-5.1.1 The email account that you tried to reach does not exist.' });
});

test('parseDeliveryStatus gives empty fields for a report it cannot read', () => {
  assert.deepEqual(parseDeliveryStatus('nothing useful'), { recipient: '', status: '', action: '', diagnostic: '' });
});

const gmailSays = (rest) => ({ 'authentication-results': `mx.google.com; ${rest}` });

test('a real Google delivery report is recognised as one', () => {
  const headers = gmailSays('dkim=pass header.i=@googlemail.com header.s=20230601 header.b=abc; spf=pass (google.com: best guess record for domain of postmaster@mail-sor-f69.google.com) smtp.mailfrom=postmaster@mail-sor-f69.google.com; dmarc=pass (p=QUARANTINE) header.from=googlemail.com');

  assert.deepEqual(mailAuth(headers, 'MAILER-DAEMON@googlemail.com'), { authenticated: true, googleBounce: true });
});

test('a mail that only claims to be from mailer-daemon is not a Google bounce', () => {
  const forged = gmailSays('spf=pass (google.com: domain of x@evil.tld designates 1.2.3.4) smtp.mailfrom=x@evil.tld; dmarc=fail header.from=googlemail.com');

  assert.deepEqual(mailAuth(forged, 'mailer-daemon@googlemail.com'), { authenticated: false, googleBounce: false });
  assert.deepEqual(mailAuth(gmailSays('spf=pass smtp.mailfrom=bounce@evil.tld'), 'mailer-daemon@evil.tld'), { authenticated: true, googleBounce: false });
});

test('a reply is authenticated when SPF, DKIM or DMARC passes for the From domain', () => {
  assert.equal(mailAuth(gmailSays('spf=pass (google.com: domain of anna@roma.hu designates 5.6.7.8 as permitted sender) smtp.mailfrom=anna@roma.hu'), 'anna@roma.hu').authenticated, true);
  assert.equal(mailAuth(gmailSays('dkim=pass header.i=@mail.roma.hu header.s=s1'), 'Anna <anna@roma.hu>').authenticated, true);
  assert.equal(mailAuth(gmailSays('dkim=fail; spf=softfail smtp.mailfrom=anna@roma.hu; dmarc=pass (p=NONE) header.from=roma.hu'), 'anna@roma.hu').authenticated, true);
});

test('a pass for another domain does not vouch for the From address', () => {
  assert.equal(mailAuth(gmailSays('spf=pass smtp.mailfrom=someone@evil.tld; dkim=pass header.i=@evil.tld'), 'anna@roma.hu').authenticated, false);
  assert.equal(mailAuth(gmailSays('spf=none smtp.mailfrom=anna@roma.hu; dkim=neutral'), 'anna@roma.hu').authenticated, false);
});

test('a verdict that is not Gmail\'s own, or is missing, proves nothing', () => {
  assert.equal(mailAuth({ 'authentication-results': 'mail.evil.tld; spf=pass smtp.mailfrom=anna@roma.hu' }, 'anna@roma.hu').authenticated, false);
  assert.equal(mailAuth({}, 'anna@roma.hu').authenticated, false);
  assert.equal(mailAuth(gmailSays('spf=pass smtp.mailfrom=anna@roma.hu'), '').authenticated, false);
});

test('normalizeEmail stays fast on a long text without an address', () => {
  const started = Date.now();

  assert.equal(normalizeEmail('x'.repeat(200_000)), '');
  assert.ok(Date.now() - started < 200);
});
