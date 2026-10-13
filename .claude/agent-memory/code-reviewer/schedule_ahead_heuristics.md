---
name: schedule-ahead-heuristics
description: Review heuristics for apps/web lib/schedule.ts + schedulePlan.mjs (writes seq on Lead for future days)
metadata:
  type: project
---

- Per-day capacity is Budapest-day based (warmup.mjs); the send window is the lead's own clock. Check any due-time scatter (SPREAD_MINUTES) against the window end: a scatter can push a due time outside the lead's window, so the send slips to the next day and breaks the per-day count.
- Bulk lead writes in enroll.ts and schedule.ts guard only `seq.status: {$ne:'active'}`, while screening also blocks hold/waiting/replied: race window can overwrite those.
- Lead matching by dedupKey alone is unsafe (same key under two projects): key by project+dedupKey everywhere, including React `key` props and write-back reads.
- Client-sent plan items (senderId, at) are trusted by apply except language/sender eligibility and per-day free count; dedupe items in the route (free-mail leads have no company domain, so the domain rule does not dedupe).
- Plan ignores future follow-up emails of the leads it places (only first steps are filled to cap).
