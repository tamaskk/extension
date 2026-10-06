import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage } from './outreachMessage.mjs';

const SENDER = { fromName: 'Tom Kalman', fromEmail: 'tom@itsblitzdeep.com' };
const base = (over = {}) => ({ sender: SENDER, to: 'anna@pizzeria-roma.hu', subject: 'Quick idea for Pizzeria Roma', text: 'Hi,\n\nfooter', ...over });

test('the first email goes out under its own subject, as plain text', () => {
  const m = buildMessage(base());

  assert.deepEqual(m, { from: { name: 'Tom Kalman', address: 'tom@itsblitzdeep.com' }, to: 'anna@pizzeria-roma.hu', subject: 'Quick idea for Pizzeria Roma', text: 'Hi,\n\nfooter' });
});

test('there is never an html part', () => {
  for (const m of [buildMessage(base()), buildMessage(base({ sameThread: true, threadSubject: 'First', lastMessageId: '<a@b>' }))]) {
    assert.equal('html' in m, false);
    assert.equal('attachments' in m, false);
  }
});

test('a step in the same thread replies to the last email under the first subject', () => {
  const m = buildMessage(base({ subject: 'ignored', sameThread: true, threadSubject: 'Quick idea for Pizzeria Roma', lastMessageId: '<abc@mail.gmail.com>' }));

  assert.equal(m.subject, 'Re: Quick idea for Pizzeria Roma');
  assert.equal(m.inReplyTo, '<abc@mail.gmail.com>');
  assert.equal(m.references, '<abc@mail.gmail.com>');
});

test('without a Message-ID the step still goes out, under the Re: subject', () => {
  const m = buildMessage(base({ sameThread: true, threadSubject: 'Quick idea', lastMessageId: '' }));

  assert.equal(m.subject, 'Re: Quick idea');
  assert.equal('inReplyTo' in m, false);
});

test('Re: is not doubled', () => {
  assert.equal(buildMessage(base({ sameThread: true, threadSubject: 'RE: Quick idea' })).subject, 'RE: Quick idea');
});

test('a same-thread step with no thread yet goes out as an email of its own', () => {
  const m = buildMessage(base({ sameThread: true, threadSubject: '', lastMessageId: '<abc@x>' }));

  assert.equal(m.subject, 'Quick idea for Pizzeria Roma');
  assert.equal('inReplyTo' in m, false);
});
