// What one round of the IMAP watcher fetches from a sender mailbox, and what it
// remembers afterwards. A mailbox is a pile of mail, not an event source: no
// message may be handled twice and none may be missed, and both come down to
// tracking UIDs. Pure functions; the IMAP calls are in lib/imapFetch.ts.
//
// The state kept per sender is { uidValidity, lastSeenUid, lastCheckedAt }:
// uidValidity as a string ('' = the mailbox was never read), lastCheckedAt as
// an ISO string.

// One round runs inside a 60 second function; the rest waits for the next round.
export const MAX_PER_RUN = 100;

// → { mode: 'baseline' }            first contact: remember where the mailbox ends, read nothing
//   { mode: 'none' }                nothing arrived since the last round
//   { mode: 'uid', fromUid }        the normal case: everything above lastSeenUid
//   { mode: 'since', since: Date }  UIDVALIDITY changed, the stored UIDs mean nothing
export function planFetch(state, mailbox, now) {
  if (!state.uidValidity) return { mode: 'baseline' };
  if (state.uidValidity !== mailbox.uidValidity) {
    // Not the whole mailbox again: that would take days and mark everything
    // twice. Only what arrived since the day of the last good round. The caller
    // must skip the messages it already stored by Message-ID, because their
    // UIDs are new.
    const last = Date.parse(state.lastCheckedAt);
    return { mode: 'since', since: new Date(Number.isFinite(last) ? last : now.getTime()) };
  }
  if (mailbox.uidNext - 1 <= state.lastSeenUid) return { mode: 'none' };
  return { mode: 'uid', fromUid: state.lastSeenUid + 1 };
}

// The UIDs of this round out of what the search returned, oldest first.
// In uid mode the server answers `N:*` with the newest message even when its
// UID is below N, so everything not above lastSeenUid is dropped here.
export function selectUids(plan, uids, lastSeenUid) {
  const fresh = (uids || []).filter((u) => plan.mode !== 'uid' || u > lastSeenUid).sort((a, b) => a - b);
  return { take: fresh.slice(0, MAX_PER_RUN), more: fresh.length > MAX_PER_RUN };
}

// The state to store after a round. `doneUids` are the messages that were really
// read: when the round ran out of time, the rest stays above lastSeenUid and
// comes back next time.
export function nextState(state, mailbox, plan, doneUids, now) {
  const base = { uidValidity: mailbox.uidValidity, lastCheckedAt: now.toISOString() };
  if (plan.mode === 'baseline') return { ...base, lastSeenUid: mailbox.uidNext - 1 };
  if (plan.mode === 'none') return { ...base, lastSeenUid: state.lastSeenUid };
  const top = doneUids.length ? Math.max(...doneUids) : null;
  if (plan.mode === 'uid') return { ...base, lastSeenUid: top === null ? state.lastSeenUid : top };
  // since mode with nothing found: start again from the end of the mailbox
  return { ...base, lastSeenUid: top === null ? mailbox.uidNext - 1 : top };
}
