// The message handed to nodemailer for one step of a sequence. Pure: it builds
// the object, it does not send it.
//
// Plain text only. No `html` part, so there is no tracking pixel and no
// rewritten link, and the email looks like what it is: a note one person wrote.

// → { from, to, subject, text } plus inReplyTo and references when the step
// continues a thread.
//   sender        { fromName, fromEmail }
//   subject, text the rendered subject, and the rendered text with its footer
//   sameThread    the step continues the conversation of the first email
//   threadSubject the subject the first email went out with
//   lastMessageId the Message-ID of the last email sent to this lead
// Threading is best effort and never a reason not to send: Gmail may replace
// the Message-ID on the way out, and then the reference points at nothing. The
// email still goes, under "Re: <the first subject>", which most mail clients
// thread on by themselves.
export function buildMessage({ sender, to, subject, text, sameThread, threadSubject, lastMessageId }) {
  const threaded = !!sameThread && !!String(threadSubject || '').trim();
  const first = String(threadSubject || '').trim();
  const message = {
    // an object, not a "Name <address>" string: the library quotes the name itself
    from: { name: String((sender && sender.fromName) || ''), address: String((sender && sender.fromEmail) || '') },
    to: String(to || ''),
    subject: threaded ? (/^re:/i.test(first) ? first : `Re: ${first}`) : String(subject || ''),
    text: String(text || ''),
  };
  const ref = String(lastMessageId || '').trim();
  if (threaded && ref) {
    message.inReplyTo = ref;
    message.references = ref;
  }
  return message;
}
