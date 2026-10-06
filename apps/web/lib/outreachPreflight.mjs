// The last look at an email before it leaves. Pure.
//
// A sent email cannot be called back, so every reason not to send is checked
// here, on the finished text, right before the send. `blocks` stop the email;
// `warnings` are shown and logged but let it go.

const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Mailboxes a whole office reads: nobody in particular gets the email.
const ROLE_LOCALS = new Set(['info', 'contact', 'office', 'hello', 'admin', 'sales', 'support', 'mail', 'iroda', 'titkarsag']);

// → { ok, blocks, warnings }, each a list of sentences. `ok` is false when
// anything is in `blocks`.
//   subject, text   as they would be sent: variables filled in, footer attached
//   missing         variable names rendering could not fill, subject and body together
//   to              the recipient address
//   footer          the footer that must be at the end of `text`
// For the warnings, all optional:
//   sequenceLanguage, leadLanguage   'en' | 'hu' | ''
//   bouncedDomains                   has(domain) → an email to that domain bounced before
//   category, usesCategory           the lead's category, and whether the text uses {{category}}
export function preflight(mail) {
  const m = mail || {};
  const blocks = [], warnings = [];
  const subject = String(m.subject || '').trim();
  const text = String(m.text || '').trim();
  const footer = String(m.footer || '').trim();
  const to = String(m.to || '').trim().toLowerCase();

  const missing = [...new Set(m.missing || [])];
  if (missing.length) blocks.push(`No value for ${missing.map((v) => `{{${v}}}`).join(', ')}.`);
  if (!subject) blocks.push('The subject is empty.');
  // what is left of the text without its footer
  const body = footer && text.endsWith(footer) ? text.slice(0, text.length - footer.length).trim() : text;
  if (!body) blocks.push('The text is empty.');
  // a name the renderer does not take for a variable ("{{first name}}") would go out as typed
  if (/\{\{|\}\}/.test(subject) || /\{\{|\}\}/.test(body)) blocks.push('Double braces are left in the text: a variable name is mistyped.');
  // a subject is one header line
  if (/[\r\n]/.test(String(m.subject || '').trim())) blocks.push('The subject has a line break in it.');
  if (!VALID_EMAIL.test(to)) blocks.push('The address is not a valid email address.');
  if (!footer) blocks.push('There is no footer.');
  else if (!text.endsWith(footer)) blocks.push('The footer is not at the end of the text.');

  if (VALID_EMAIL.test(to)) {
    const [local, domain] = [to.slice(0, to.lastIndexOf('@')), to.slice(to.lastIndexOf('@') + 1)];
    if (ROLE_LOCALS.has(local)) warnings.push(`${local}@ is a shared mailbox, not a person.`);
    if (m.bouncedDomains && m.bouncedDomains.has(domain)) warnings.push(`An earlier email to ${domain} bounced.`);
  }
  if (m.sequenceLanguage && m.leadLanguage && m.sequenceLanguage !== m.leadLanguage) warnings.push(`The sequence is in ${m.sequenceLanguage}, the lead looks like ${m.leadLanguage}.`);
  // The category comes from Maps in the language Maps was shown in, so a
  // Hungarian category can land in an English email.
  if (m.usesCategory && m.sequenceLanguage === 'en' && /[^\x00-\x7f]/.test(String(m.category || ''))) warnings.push(`The category "${m.category}" does not look English.`);

  return { ok: blocks.length === 0, blocks, warnings };
}
