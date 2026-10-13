// Why a lead is left out of a sequence, in words: the reasons of
// lib/enrollPlan.mjs (SKIP_REASONS), in the order the checks run. Shown by the
// enrolment modal and by the schedule preview.
export const REASONS: [string, string][] = [
  ['noEmail', 'no email address'],
  ['badEmail', 'an address that must not be written to (noreply, a placeholder, the website agency)'],
  ['noMx', 'the address\'s domain takes no mail'],
  ['active', 'already in a sequence'],
  ['replied', 'replied to an earlier sequence'],
  ['suppressed', 'on the suppression list'],
  ['alreadyMailed', 'this address, or this company, was written to before'],
  ['language', 'another language than the sequence'],
  ['languageUnknown', 'language not known (country of the project not recognised)'],
  ['noTimezone', 'time zone not known (no coordinates and no country in the address)'],
  ['domain', 'another lead of the same company is in a sequence'],
  ['noSender', 'no sender account available'],
  ['overLimit', 'over the limit of this run'],
];
