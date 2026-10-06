// May anything be sent today at all? Pure: every input is a parameter, nothing
// is read from the database here, so the rule can be tested and cannot be
// talked around.
//
// The warm-up (lib/warmup.mjs) says HOW MUCH a sender may send. This says
// WHETHER sending may happen: the day's preconditions. A warm-up goes wrong on
// the day something was skipped (nobody read the replies, no seed test ran, the
// bounce rate stands at 3 %) and 200 emails go out anyway. One such day sets a
// sender's reputation back for months, and a burnt sender cannot be cleaned:
// a new one has to be added and warmed up from the start.
//
// This is a gate, not a dashboard. The send round calls it first and refuses to
// send while it is shut; showing its answer is the by-product.

// Every threshold in one place. Rates are fractions (0.05 = 5 %); the Postmaster
// spam rate is the percentage Google shows (0.3 = 0.3 %).
export const GATE = {
  bounceBlock: 0.05,          // final bounces over the last 7 days
  bounceWarn: 0.02,
  blockBlock: 0.01,           // refusals of US (5.7.1, reputation) over the last 7 days
  blockWarn: 0.003,
  spamBlock: 0.3,             // Postmaster Tools spam rate, in percent
  spamWarn: 0.1,
  postmasterMaxAgeDays: 14,   // older than this, the figure is no longer a reading
  seedMaxAgeDays: 14,
  seedWarnAgeDays: 7,
  repliesWarnHours: 24,
  runnerDeadMinutes: 10,
  inboxDeadMinutes: 30,       // no mailbox read for this long: replies, stop requests and bounces go unseen
};

const DAY = 86_400_000;
const pct = (rate) => `${(rate * 100).toFixed(1).replace(/\.0$/, '')} %`;
const ageDays = (date, now) => {
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? `${date}T00:00:00.000Z` : String(date || ''));
  return Number.isFinite(at) ? Math.max(0, Math.floor((now.getTime() - at) / DAY)) : null;
};

// `input` holds, all of it handed in by the caller:
//   now                 Date
//   ready               { secretKey, footer }: the two things without which no email can be built
//   senders             [{ label, capToday, capTomorrow, sentToday, tierToday, tierTomorrow, steppedBack, idleDays }], the switched-on ones
//   rates               { bounce, block } over the last 7 days, each null while too few emails went out to say
//   postmaster          { spamRate, date } as read by hand from Google Postmaster Tools
//   seed                { date, inbox, of }: the last seed test, by hand
//   authConfirmedAt     the day the operator confirmed SPF, DKIM and DMARC all pass; '' = never
//   repliesReviewedAt   ISO of the last time the operator read the replies; '' = never
//   unseenReplies       replies nobody has looked at
//   lastTickAt          ISO of the send loop's last round
//   inboxReadAt         ISO of the last time any sender mailbox was read with success; '' = never
//   failingInboxes      labels of the senders whose mailbox could not be read at the last try
// → { allowed, blockers, warnings, capToday }: sentences, every one that
// applies, not only the first. `capToday` is what the senders may send today in all.
export function campaignGate(input) {
  const i = input || {};
  const now = i.now || new Date();
  const blockers = [], warnings = [];
  const senders = Array.isArray(i.senders) ? i.senders : [];
  const capToday = senders.reduce((n, s) => n + (Number(s.capToday) || 0), 0);

  const ready = i.ready || {};
  if (ready.secretKey === false) blockers.push('OUTREACH_SECRET_KEY is not set on the server, so no sender password can be opened.');
  if (ready.footer === false) blockers.push('The footer has no postal address yet, in either language (FOOTER_IDENTITY in lib/outreachFooter.mjs). No email is sent without it.');
  if (!senders.length) blockers.push('No sender account is switched on with a stored password.');
  else if (capToday <= 0) blockers.push('The warm-up gives every sender a limit of 0 today.');

  if (!i.authConfirmedAt) blockers.push('SPF, DKIM and DMARC have not been confirmed as passing. Send a test email to Gmail, check "Show original", then confirm it here.');

  const rates = i.rates || {};
  if (typeof rates.bounce === 'number') {
    if (rates.bounce > GATE.bounceBlock) blockers.push(`The bounce rate of the last 7 days is ${pct(rates.bounce)}, over ${pct(GATE.bounceBlock)}. Clean the list before anything else goes out.`);
    else if (rates.bounce > GATE.bounceWarn) warnings.push(`The bounce rate of the last 7 days is ${pct(rates.bounce)}, over ${pct(GATE.bounceWarn)}.`);
  }
  if (typeof rates.block === 'number') {
    if (rates.block > GATE.blockBlock) blockers.push(`${pct(rates.block)} of the last 7 days' emails were blocked by the receiving servers, over ${pct(GATE.blockBlock)}. This is the sender's reputation, not the list: send less, do not clean.`);
    else if (rates.block > GATE.blockWarn) warnings.push(`${pct(rates.block)} of the last 7 days' emails were blocked by the receiving servers, over ${pct(GATE.blockWarn)}.`);
  }

  const pm = i.postmaster || {};
  const pmAge = ageDays(pm.date, now);
  if (pmAge === null || typeof pm.spamRate !== 'number') blockers.push('The Postmaster Tools spam rate was never entered. It is the only outside sign of what Gmail thinks of the sender.');
  else if (pmAge > GATE.postmasterMaxAgeDays) blockers.push(`The Postmaster Tools spam rate was entered ${pmAge} days ago; after ${GATE.postmasterMaxAgeDays} days it is too old. Read it again.`);
  else if (pm.spamRate > GATE.spamBlock) blockers.push(`The Postmaster Tools spam rate is ${pm.spamRate} %, over ${GATE.spamBlock} %.`);
  else if (pm.spamRate > GATE.spamWarn) warnings.push(`The Postmaster Tools spam rate is ${pm.spamRate} %, over ${GATE.spamWarn} %.`);

  const seedAge = ageDays((i.seed || {}).date, now);
  if (seedAge === null) blockers.push('No seed test result has been entered. Without one, no answer could mean a bad text or an email nobody saw.');
  else if (seedAge > GATE.seedMaxAgeDays) blockers.push(`The last seed test was ${seedAge} days ago; after ${GATE.seedMaxAgeDays} days it says nothing about today. Run one.`);
  else if (seedAge > GATE.seedWarnAgeDays) warnings.push(`The last seed test was ${seedAge} days ago.`);

  const tick = Date.parse(i.lastTickAt || '');
  const silent = Number.isFinite(tick) ? (now.getTime() - tick) / 60_000 : null;
  if (silent === null) blockers.push('The send loop has never run. Open the runner tab.');
  else if (silent > GATE.runnerDeadMinutes) blockers.push(`The send loop has not run for ${Math.round(silent)} minutes. The numbers here are that old; nothing is decided on them.`);

  // Sending while nobody reads the mailboxes means sending past stop requests
  // and bounces: the one thing the whole system exists not to do.
  if (i.inboxReadAt !== undefined) {
    const read = Date.parse(i.inboxReadAt || '');
    const unread = Number.isFinite(read) ? (now.getTime() - read) / 60_000 : null;
    if (unread === null) blockers.push('No sender mailbox has been read yet, so replies, stop requests and bounces would go unseen. The runner tab reads them; check that IMAP is enabled in the account.');
    else if (unread > GATE.inboxDeadMinutes) blockers.push(`No sender mailbox has been read for ${Math.round(unread)} minutes. Replies, stop requests and bounces are not being seen.`);
  }
  for (const label of Array.isArray(i.failingInboxes) ? i.failingInboxes : []) warnings.push(`The mailbox of ${label} could not be read at the last try. Test its connection on the Senders tab.`);

  const reviewed = Date.parse(i.repliesReviewedAt || '');
  const unread = Number(i.unseenReplies) || 0;
  if (!Number.isFinite(reviewed)) { if (unread > 0) warnings.push(`${unread} ${unread === 1 ? 'reply has' : 'replies have'} never been read.`); }
  else if ((now.getTime() - reviewed) / 3_600_000 > GATE.repliesWarnHours) warnings.push(`Nobody has read the replies for ${Math.floor((now.getTime() - reviewed) / 3_600_000)} hours${unread ? `; ${unread} ${unread === 1 ? 'is' : 'are'} waiting` : ''}.`);

  for (const s of senders) {
    if (s.steppedBack) warnings.push(`${s.label} is one warm-up tier lower today, because it sent nothing for ${s.idleDays} days.`);
    if (typeof s.capTomorrow === 'number' && s.tierTomorrow !== undefined && s.tierTomorrow !== s.tierToday && !s.steppedBack) warnings.push(`${s.label} moves to its next warm-up tier tomorrow: ${s.capTomorrow} a day instead of ${s.capToday}.`);
  }

  return { allowed: blockers.length === 0, blockers, warnings, capToday };
}
