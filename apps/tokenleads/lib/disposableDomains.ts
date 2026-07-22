// Common disposable-email domains — signup-bonus farming guard. Not exhaustive
// (full lists run 3000+); covers the services that show up in practice. Extend
// freely; matching is on the exact domain part, lowercased.
const LIST = [
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'sharklasers.com', '10minutemail.com', '10minutemail.net', 'temp-mail.org',
  'tempmail.com', 'tempmail.dev', 'tempmailo.com', 'throwawaymail.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'getnada.com', 'nada.email',
  'maildrop.cc', 'dispostable.com', 'mintemail.com', 'trashmail.com',
  'trashmail.de', 'mailnesia.com', 'mytemp.email', 'mohmal.com', 'tmpmail.org',
  'tmpmail.net', 'emailondeck.com', 'fakeinbox.com', 'spamgourmet.com',
  'mailcatch.com', 'inboxkitten.com', 'harakirimail.com', 'tempinbox.com',
  '33mail.com', 'burnermail.io', 'mail-temp.com', 'moakt.com', 'tempr.email',
  'discard.email', 'spambox.us', 'mailsac.com', 'inboxbear.com', 'mail7.io',
  'ethereal.email', 'crazymailing.com', 'tempail.com', 'cuvox.de', 'dayrep.com',
  'einrot.com', 'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com',
  'superrito.com', 'teleworm.us', 'armyspy.com',
];
const SET = new Set(LIST);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return !!domain && SET.has(domain);
}
