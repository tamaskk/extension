---
name: review-heuristics
description: Recurring defect patterns in the GridLeads outreach code (dispatcher, inbox watcher, enrolment)
metadata:
  type: feedback
---

- Idempotency guards that are written BEFORE the effects they protect (e.g. handleBounce updates the send row conditional on bounceKind empty, then suppresses): a crash in between loses the effect forever. Check guard order in every "handled once" path.
- "First writer wins" guards on a send row (bounceKind empty) drop a later, more severe event for the same send (soft/delay DSN then hard bounce).
- Round-robin pickers (`sort lastCheckedAt: 1`, findOne) starve all others when a failing item returns early without stamping its timestamp (checkInbox: not-allowed endpoint, IMAP connect error, throwing message).
- Counters read before taking a lock (sentTodayBySender before the round lock) are stale once the lock is won.
- Per-lead skip on a template-wide preflight block (typo variable, empty subject) silently burns every lead's step; template-wide blocks should hold, not skip.
- git HEAD of apps/web is old and the working tree holds lots of unrelated uncommitted work: a diff-based "behaviour preserved" check of app/api/leads/route.ts is not possible against HEAD.
