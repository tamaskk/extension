// The rules that keep one email from going out twice. Pure: the filters and
// decisions are built here and tested; lib/outreachState.ts and
// lib/outreachSends.ts run them against the database.
//
// SMTP has no idempotency key. The dispatcher is an HTTP route a browser tab
// calls around the clock, so the same round can start twice (two tabs, a retry
// after a timeout) or die between sending and writing down that it sent. A
// missed email is a nuisance; a doubled one does harm. Everything here leans
// towards not sending.
//
// The order around one email: claim the lead → write a `sending` row → send →
// turn the row into `sent`, move the lead on. After every step the state can
// be read, and none of them leaves a doubt a machine may settle by sending again.

// A claim, or a `sending` row, older than this belongs to a round that died.
export const STALE_MS = 10 * 60_000;
// A lead whose sends failed this many times in a row leaves the queue.
export const MAX_ERRORS = 3;

export function staleBefore(now) {
  return new Date(now.getTime() - STALE_MS).toISOString();
}

// The filter of the claim: one atomic update that only one round can win.
// It matches only while the lead is still active, still waiting for this step,
// not claimed (or claimed so long ago that the claimer is dead), and has none
// of the step's wordings in its history. The last part is the second line of
// defence: whatever else went wrong, a step that is in `sentStepIds` does not
// go out again. `wordingIds` are the step's own id and those of its variants.
export function claimFilter({ project, dedupKey, stepId, wordingIds }, now) {
  return {
    project, dedupKey,
    'seq.status': 'active',
    'seq.stepId': stepId,
    'seq.sentStepIds': { $nin: [...new Set([stepId, ...(wordingIds || [])])] },
    // null also matches a lead that has no claimedAt at all
    $or: [{ 'seq.claimedAt': { $in: ['', null] } }, { 'seq.claimedAt': { $lt: staleBefore(now) } }],
  };
}

export function claimUpdate(now) {
  return { $set: { 'seq.claimedAt': now.toISOString() } };
}

// Is this claim still held? For tests and for the screen; the database decides
// with the filter above.
export function claimHeld(claimedAt, now) {
  return !!claimedAt && claimedAt >= staleBefore(now);
}

// What a failed send does to the lead: it stays due and is tried again, until
// the third failure in a row takes it out of the queue as 'failed', so the
// loop does not spin on it for ever.
export function afterSendError(errorCount) {
  const n = (Number(errorCount) || 0) + 1;
  return { errorCount: n, status: n >= MAX_ERRORS ? 'failed' : 'active' };
}

// The outcomes of a send row that mean "this email went out, or may have":
// while such a row exists for a lead and a step, that step is not sent again.
// Only 'failed' (the mail server refused it, nothing left) frees the step.
export const BLOCKING_OUTCOMES = ['sending', 'unknown', 'sent', 'delivered', 'bounced', 'blocked', 'complained', 'replied', 'stopped'];

// The operator's two answers to "this email may have gone out, we do not know".
//   'sent'    treat it as sent: the lead moves on to the next step
//   'resend'  treat it as not sent: the step becomes due again
export function resolveUnknown(decision) {
  if (decision === 'sent') return { outcome: 'sent', lead: 'advance' };
  if (decision === 'resend') return { outcome: 'failed', lead: 'retry' };
  return null;
}

// What an error from the mail library means for the email.
//   'refused'  the server did not take it: nothing went out, it may be tried again
//   'unknown'  the connection broke somewhere during the hand-over: it may have gone out
// Only what is known to happen before the server accepts the message counts as
// refused: a failed login, a name that does not resolve, a failed TLS upgrade,
// a rejected sender or recipient. Everything else is unknown, and an unknown
// send is never repeated by a machine.
// ECONNECTION is NOT in the list, on purpose: the mail library raises it for
// every connection that closes while an answer is still awaited, and that
// includes the answer to the message body. The server may have taken the email
// and the line dropped before its "250" arrived. Calling that "refused" would
// send the same email again, up to three times.
export function sendFailureKind(err) {
  const e = err && typeof err === 'object' ? err : {};
  if (['EAUTH', 'EDNS', 'EENVELOPE', 'ETLS'].includes(e.code)) return 'refused';
  // a permanent or temporary answer of the server to the message itself
  if (e.code === 'EMESSAGE' && Number(e.responseCode) >= 400) return 'refused';
  return 'unknown';
}
