// The footer of every outreach email: who is writing, from what postal address,
// and how to make it stop. Pure.
//
// It is attached here, automatically, and is not part of a sequence's wording
// or of a generated draft: that way it cannot be forgotten, and it changes in
// one place. lib/outreachPreflight.mjs refuses an email that does not end with it.
//
// CAN-SPAM asks every commercial email for a real sender, a real physical
// postal address and a working way to opt out. The missing address is the part
// that is fined most often, and spam filters look for it too.

// THE ONE PLACE TO FILL IN. The operator's full name and a real postal address,
// once per language: a Hungarian name is written family name first, and a
// Hungarian address in its own order. It appears in every email and ends up in
// spam databases, so a virtual office address may be preferable to a home
// address; changing it is this one constant.
// While the name or the address of a language is empty, that language has no
// footer, and no sequence email in that language can leave.
// `company` is optional: when set, it is a line of its own under the name.
export const FOOTER_IDENTITY = {
  en: { name: 'Tamás Krisztián Kálmán', address: 'Hungary 1108 Budapest Agyagfejto utca 20', company: 'Blitzdeep' },
  hu: { name: 'Kálmán Tamás Krisztián', address: 'Magyarország 1108 Budapest Agyagfejtő utca 20', company: 'Blitzdeep' },
};

// The line that says how to stop the emails, per language. A reply with one of
// the stop words of lib/replyRules.mjs takes effect at once.
const OPT_OUT = {
  en: 'If you would rather not hear from me again, reply STOP and I will remove you from my list.',
  // formal address, like the Hungarian texts of lib/sequenceTemplates.mjs
  hu: 'Ha nem szeretne több megkeresést kapni, válaszoljon a STOP szóval, és törlöm az elérhetőségét a listáról.',
};

// The footer in a language, without the blank line in front of it. '' while
// that language's identity above is not filled in. "--" on its own line is the
// standard signature delimiter: mail programs can fold what follows it. A
// language other than Hungarian gets the English footer.
export function footerFor(lang, identity = FOOTER_IDENTITY) {
  const key = lang === 'hu' ? 'hu' : 'en';
  const who = (identity && identity[key]) || {};
  const name = String(who.name || '').trim();
  const address = String(who.address || '').trim();
  if (!name || !address) return '';
  const company = String(who.company || '').trim();
  return `--\n${name} · ${address}\n${company ? company + '\n' : ''}${OPT_OUT[key]}`;
}

// The text with the footer after it. The language is the lead's
// (`seq.language`), not the sender's.
export function withFooter(body, lang, identity = FOOTER_IDENTITY) {
  const footer = footerFor(lang, identity);
  const text = String(body || '').trimEnd();
  return footer ? `${text}\n\n${footer}` : text;
}
