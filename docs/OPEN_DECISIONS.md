# Open decisions: outreach

Choices the agent made, or assumed, while building tasks 1 to 6 of the outreach plan, that the operator has not confirmed. Each one names what is in effect now and what the other option is. Answer by number ("D4 b, D7 yes"); a decision that is confirmed moves to T-035 in docs/TASKS.md and leaves this file. Manual steps are in docs/OPERATOR_TODO.md, not here.

Written on 2026-10-06.

## Approval package (task 1)

- **D1. Points 1 to 9 were taken as approved without an answer.** The operator answered points 10 to 15 only. In effect: the four collection names, the `seq` subdocument, the `gl_seq_due` index, `nodemailer` and `imapflow`, `@types/nodemailer`, the indexes of the new collections approved as a block, the variable name `OUTREACH_SECRET_KEY`, chunked enrolment with a `dryRun` preview. Other option: name the point that should be different.
- **D2. Daily volume "30 to 50" was recorded without saying per what.** In effect: the unsubscribe decision (reply and `mailto:` only, no public link) holds either way, because both readings stay far below Gmail's 5,000 a day per domain. Open: is it 30 to 50 a day in total, or per sender account? The warm-up table and the quotas of later tasks need the answer.
- **D3. Google Postmaster Tools is read in the browser only.** Assumed from "as recommended" on point 15. Other option: an API integration, which needs OAuth and a new environment variable.
- **D4. Resend is not removed yet (T-036).** The operator decided to remove it; in effect it stays until an SMTP sender exists, because removing it now would break the manual single send (F6). Other option: remove it now and live without the manual send until then.

## Runner tab (task 2)

- **D5. The session lasts exactly 90 days.** The operator chose "longer"; 90 was the agent's example. Every dashboard login lasts that long, not only the runner's. Other option: another number of days.
- **D6. The page has no styles of its own.** It reuses `.log-tile`, `.chip`, `.btn` and inline layout values, because the stylesheet could not be read at that moment. Other option: a small `.orun-*` block in `globals.css`, as the design system asks for a new area.
- **D7. Default rhythm 45 seconds, never under 10 seconds, never over 5 minutes; a request is given up after 70 seconds; the log keeps 2,000 rounds in the browser.** Other option: other numbers.
- **D8. The Vercel plan and its function call allowance are unknown.** 45 seconds means about 58,000 calls a month, plus the IMAP loop. Open: which plan is the project on?
- **D9. The "7 days" session text is still in four documents** (docs/ARCHITECTURE.md §06, docs/SECURITY.md §03, apps/web/README.md, apps/extension/README.md). The edit was refused by the permission check. Options: the operator edits them by hand, or allows the agent to.

## Sender accounts and DNS (task 3)

- **D10. Which SPF value.** Proposed: `v=spf1 include:_spf.google.com ~all`. Open: is any mail sent from GoDaddy's own mailbox on `itsblitzdeep.com`? If yes, GoDaddy's include has to stay in the record.
- **D11. DMARC reports go to `tom@itsblitzdeep.com`.** Proposed by the agent. Other option: a separate address or alias, so the reports do not land among the replies the IMAP watcher reads.
- **D12. When to do the DNS changes.** The operator wants to do the manual steps at the end. Recommended: SPF, DMARC and Postmaster Tools now (about 10 minutes), the rest later, because DNS and DMARC reports need days and Postmaster Tools does not measure backwards.

## IMAP watcher (task 4)

- **D13. Mail that Gmail files under Spam is not read.** The watcher reads INBOX only. Other option: a second round over `[Gmail]/Spam`, so a reply that Gmail misjudged is not lost.
- **D14. `GET /api/outreach/porttest` stays in the app.** It is a diagnostic behind the login. Other option: delete it once the sender store has its own connection test.
- **D15. Auto-reply detection goes a little beyond the plan.** In effect: any `Auto-Submitted` value other than `no`, `X-Autoreply`, `X-Autorespond`, `Precedence: auto_reply`, and subjects starting with "Automatic reply", "Auto-reply", "Out of office", "Automatikus válasz" or "Házon kívül". Other option: only the patterns listed in the plan.
- **D16. One round reads at most 100 messages and stops reading bodies after 40 seconds.** The rest comes in the next round. Other option: other limits.

## Lead `seq` fields (task 5)

- **D17. `seq` has no default values.** The plan wrote `default: ''` on every field. In effect: a lead that was never enrolled has no `seq` at all; with defaults, sync would write about ten empty fields on every new lead. Other option: the defaults of the plan.
- **D18. `seq.to` was added.** It is not in the plan's field list. In effect: the address is fixed at enrolment, and replies and bounces are matched on it, as task 4 describes. Other option: remove it and match through `outreachsends` only.
- **D19. Sync and the single-lead add drop an incoming `seq`.** Not in the plan. Without it, importing an old export would restore a past sequence state and steps already sent would go out again. Other option: none recommended.
- **D20. The export still carries `seq`.** A bundle holds the sequence state of each lead, but nothing can write it back (D19). Other option: leave `seq` out of the export as well.
- **D21. Three fields named in the approval package are not in `seq` yet**: the offer, the variant, and the claim time. In effect: each arrives with its own task. Other option: add them now in one go.

## Sequences (task 6)

- **D22. A lead whose last sent step was deleted from the sequence gets no more email.** Its place in the order is unknown then. Other option: continue from the nearest following step, with the risk of a repeat.
- **D23. A step that continues the thread needs no subject.** The plan asked for a subject on every enabled step. In effect: such a step goes out under the thread's subject, so its own would never be used. Other option: require it anyway.
- **D24. Two rules stricter than the plan.** Only the first step may wait 0 days (otherwise one person gets two emails on one day), and the opening step cannot continue a thread. Other option: drop either rule.
- **D25. If the first step is switched off, the first enabled step goes out at once.** Its own wait is not applied at enrolment. Other option: wait the summed days before the first email.
- **D26. Variants have no place in the order.** A step with `variantOf` is another wording of that step; `nextEnabledStep` never returns one, and choosing between variants is left to its own task.

## Suppressions (task 7)

- **D29. The mailbox-provider list is longer than the plan's six.** Added: googlemail.com, live.com, msn.com, me.com, proton.me, protonmail.com, and the Hungarian freemail.hu, citromail.hu, indamail.hu, t-online.hu, t-email.hu, upcmail.hu, vipmail.hu. A domain block on any of these would shut out thousands of unrelated businesses. Other option: only the six of the plan.
- **D30. The list is in `lib/suppressionRules.mjs`, not in `lib/suppression.ts`.** The plan asked for the same file. In effect: one constant in one place, but in the pure module, because the web tests cannot load a `.ts` file. Other option: move it and lose the tests of the domain rules.
- **D31. A domain-wide row is stored with `email` set to `@domain`.** The plan's schema makes `email` required and unique, so a domain row needs a value there. The `domain` field is filled on domain-wide rows only; an address row leaves it empty.
- **D32. Suppressing an address that is already on the list changes nothing.** The first reason, source and date stay. Other option: the stronger reason replaces the weaker (a complaint over a bounce).
- **D33. An address that cannot be read counts as suppressed.** `isSuppressed('')` answers true, so a broken address is never written to. A database error is thrown, not answered.
- **D34. `unsuppress()` exists but no route or button calls it.** Lifting a block by hand becomes possible when the suppression screen is built.

## Sends (task 8)

- **D35. The text of a sent email is kept in the activity log, not in `outreachsends`.** This reverses a line of T-035, which put the body into `outreachsends` and a short row into the log. Task 8's schema has no body field and says the `outreach.sent` event stays as it is, and 30 to 50 emails a day do not bloat the log. In effect: the row says which step went out; the exact wording is in the Changelog event. Other option: add `subject` and `body` to `outreachsends`, so the lead's send list shows the text without a second lookup.
- **D36. An index on `{ to, sentAt }` was added.** The plan's acceptance list asks for an indexed `to`, its schema did not declare one.
- **D37. An email sent by hand from the lead panel writes an `outreachsends` row too**, with empty `sequenceId` and `senderId`. The plan says every send creates a row and the report counts from this collection only. Other option: only sequence sends are recorded.
- **D38. Settled by task 21: the manual send checks the suppression list** and refuses a suppressed address; when the list cannot be read it does not send.

## Sender accounts (task 9)

- **D39. A missing master key fails when a password is saved or used, not when the app starts.** The plan asked for an error at startup. In effect: `seal()` and `open()` throw, nothing is ever stored in the clear, and the save answers with a clear message. Throwing at import would break `next build` and every unrelated route on a machine without the key. Other option: fail at startup anyway.
- **D40. The accounts are a tab of the dashboard ("Senders" in the left navigation).** The plan said "among the settings", and the dashboard has no settings area. Other option: a separate page.
- **D41. There is no delete.** An account is switched off instead; sends and sequences point at its id. Other option: a delete that refuses while anything references the account.
- **D42. Fields beyond the plan's list**: `senderId` (the id the leads point at), `uidValidity` and `lastCheckedAt` (the IMAP watcher needs them beside `lastSeenUid`), `createdAt` and `updatedAt`. `fromEmail` is unique.
- **D43. Tasks 9 and 10 named the same two things differently; task 10's names are in the code.** `firstSendAt` (written at the first successful send) replaces `warmupStartedAt` (written when the account is added), and `dailyLimit` (a ceiling the tiers cannot lift, 100 unless set) replaces `dailyCapOverride`. A limit set by hand is now: warm-up off, ceiling at the number wanted. "Restart warm-up" empties `firstSendAt`, so the days count again from the next email. Other option: keep both pairs of fields.
- **D44. A new account starts switched off, and cannot be switched on without a stored password.** A passed connection test is not required. Other option: require a passed test before switching on.
- **D45. The day turns at midnight in `Europe/Budapest`**, for the warm-up days, the daily limit and the "sent today" count. The plan asked for one fixed zone and did not name it. Other option: another zone.
- **D46. The ceiling of an account is 100 a day unless set**, and a tier or a ceiling may be 0 (the account sends nothing) and at most 2000.
- **D47. Account changes are logged as `outreach.sender` in the Changelog**: added, switched on or off, password replaced, warm-up restarted, and the names of the edited fields. Never a value.
- **D48. Spaces are removed from a typed app password.** Google shows it in four groups; it works either way.

## Daily room, assignment, domain lock (task 11)

- **D54. A sender's share of the leads follows its limit of the day (`dailyCapFor`), not the room it has left.** The plan says both in different lines. A lead keeps its sender for the whole sequence, so the assignment is a long-term split, and what is left today changes by the hour. Other option: weight by the remaining room.
- **D55. The assignment uses weighted rendezvous hashing.** The plan asked for a deterministic split from the hash of the `dedupKey`. In effect: the same, and in addition a new sender, or a limit that grows, moves only that sender's share; everyone else keeps their sender. Leads already enrolled keep `seq.senderId` in any case.
- **D56. The caller chooses which senders may serve a lead** (language, the senders a sequence allows). `assignSenders` only drops the ones that are switched off or have a limit of 0.
- **D57. Seed emails count towards "sent today".** They leave from the same mailbox, so the receiving side sees them in the same traffic.
- **D58. Within one enrolment batch the first lead of a company domain wins**, in the order the batch lists them. Other option: prefer the lead with the best score.
- **D59. The mailbox-provider list of the domain lock is the longer list of D29**, because it is the same constant.

## Sequence endpoints (task 12)

- **D60. An unfinished sequence can be saved while it is switched off.** The checks of task 6 refuse a sequence only when it is switched on, or is being switched on. Otherwise a sequence could not be built step by step. Every answer still lists what is wrong (`errors`). Other option: refuse every save that does not pass.
- **D61. The preview returns the texts as they are stored.** Filling in the lead's own details is the templating of the next task; the preview answers `rendered: false` until then.
- **D62. `advanceSequence` refuses to write when the lead is no longer on the step the caller read.** The plan leaves the double advance to task 19's claim. This guard is in already and costs nothing; task 19 still has to keep two rounds from sending the same email.
- **D63. A stopped lead keeps `seq.stepId` and loses `seq.nextStepAt`.** It shows where the lead stood; nothing is due any more.
- **D64. Stop reasons other than a reply or a bounce all end in the status `stopped`**; the reason itself is in the Changelog event, not on the lead. Other option: a `seq.stopReason` field (a new field).
- **D65. Deleting a step that leads are waiting on ends the sequence for those leads** at their next round, by the rule of D22. The edit is not refused and gives no warning. Other option: refuse to delete a step that active leads point at.
- **D66. Sequence changes are logged as `outreach.sequence`** (created, edited, switched on or off, deleted with the number of leads stopped).
- **D67. The sequence routes rely on the middleware for the login**, like every route except the sender ones (D52).
- **D68. The active lead count stops at 50,000**, and shows as unknown while the `gl_seq_due` index does not exist yet.

## Sequence editor (task 13)

- **D69. Settled by task 17: the variables are the plan's list**, in `lib/outreachRender.mjs`: `name`, `category`, `rating`, `reviewCount`, `website`, `websiteStatus`, `address`, `street`, `city`, `aiSummary`, `aiPainPoints`, `aiPitch`, `opportunityScore`, `topPitch`. `phone` and `email` of the provisional list are gone.
- **D70. The preview still has no footer.** The footer helper exists (`lib/outreachFooter.mjs`) but no sender has a footer text yet. A variable without a value for the lead shows as `[name]` in the preview and is flagged.
- **D71. "Missing for N leads" is counted among the leads active in the sequence**, up to 5,000. The plan says "in the target group", and a sequence has no target group until enrolment defines one. For a sequence nobody is in yet the count says so. Other option: count over the enrolment filter once it exists.
- **D72. The preview lead is a lead of the sequence, or, while the sequence is empty, one of the best-scored leads with an email.** "Another lead" moves to the next one. Other option: pick from the enrolment filter.
- **D73. A new sequence is saved without the check dialog**, since nobody is in it. Every later save goes through the dialog.
- **D74. Whichever step is first always waits 0 days and opens the thread.** When a move or a delete puts another step on top, the editor sets those two values, and the check reports the changed wait.
- **D75. Wording variants have their controls since task 15**: "+ Variant" on a saved step, a share and an on/off switch per wording. The preview still shows only the step's own wording, not its variants.
- **D76. A sequence that is on and incomplete cannot be saved from the editor**; the Save button is disabled and the reasons are listed. Switch it off to save work in progress.
- **D77. Deleting a step asks for confirmation and the check names the leads it strands**, but it is not refused (see D65).

## Enrolment (task 14)

- **D78. A lead's language comes from the country of its project**: Hungary is Hungarian, every other recognised country is English. Leads have no language field. A lead whose project country is not recognised ("Other") counts as unknown and is left out unless "also take leads in another or an unknown language" is ticked. Open: is that the rule the plan wants, or should a lead carry a language of its own?
- **D79. Settled by task 26: the verification step is the address ranking and the MX question** (`lib/emailQuality.mjs`, `lib/mxCheck.ts`), run at enrolment.
- **D80. Only leads with a non-empty `email` are candidates**, as before, but since task 26 the address written to is the best-ranked one among `email` and `emails[]`, not simply `email`.
- **D81. A lead who replied to an earlier sequence is not enrolled again.** The plan only excludes leads with an active sequence. Stopped, finished and bounced leads can be enrolled again (a hard bounce is expected to be on the suppression list).
- **D82. Enrolling a lead again replaces its `seq`**, including the list of steps it got in the earlier sequence. The emails themselves stay in `outreachsends` and the Changelog.
- **D83. `seq.language` is the sequence's language**, also for a lead enrolled with the language check overridden.
- **D84. One run takes at most 10,000 leads; the default is 500.** A preview reads at most 20,000 candidates or 40 seconds and says when it stopped early.
- **D85. A request without `dryRun: false` is a preview.** A malformed call can never write.
- **D86. A sequence must pass its checks and have a switched-on sender of its language before it takes leads.** It does not have to be switched on itself: leads can be enrolled first and the sequence switched on after.
- **D87. Taking leads out works on any sequence when none is chosen**, and ends in the status `stopped` with one Changelog event per chunk of 500.
- **D88. The lead table's filter code moved to `lib/leadMatch.ts`.** `GET /api/leads` now calls it. The behaviour is meant to be identical; it was not checked in a browser.

## Wording variants (task 15)

- **D89. The choice uses the lead's `dedupKey` only, as the plan says.** A lead therefore falls at the same point of the scale at every step: with the same shares on two steps, the same leads get the first wording of both. Other option: mix the step id into the hash, so the groups of different steps are independent.
- **D90. The step itself has a share too**, 50 unless set, shown in the editor once the step has a variant. Shares can be any number above 0 up to 1000; they are proportions, not percentages.
- **D91. A variant can only be added to a saved step**, because it points at the step's id, which the server gives on the first save.
- **D92. A variant follows its step in thread or not**, and has no wait of its own.
- **D93. "Sent so far" per wording is counted over all time**, from every `outreachsends` row of the sequence, each time the list loads. Fine while the collection is small; the report task should bound it.

## Send window (task 16)

- **D94. NEEDS YOUR OK: `seq.tz` is a new field on the lead.** The task says to store the zone and that storing it needs approval. It sits inside the approved `seq` subdocument and is written only at enrolment, so no lead outside a sequence is touched. Other option: a field of its own outside `seq`, filled for every lead by a backfill.
- **D95. NEEDS YOUR OK: `sendDays`, `windowFrom` and `windowTo` are new fields on the sender account.** The task's functions read them from the sender, but task 9's field list did not have them. They are in the sender form.
- **D96. The window is 7:00 to 19:00, Monday to Friday, unless set.** Task 2 said 9 to 19; this task says 7 to 19, and its own test (Chicago at 7:00 must be sendable) only passes with 7. The hour the window ends is not a sending hour: 18:59 is in, 19:00 is out.
- **D97. The zone lookup is an approximation without a dependency.** Boxes for Hawaii, Alaska, Hong Kong, Taipei, Portugal, the UK and Greece; one Central European clock for the rest of Europe; in North America border lines that shift with latitude, with Arizona and Saskatchewan apart. Known to be an hour off close to a zone border, in western Spain next to Portugal, and on the Canary Islands. Other option: an exact polygon library, which is a new dependency and a cold-start cost.
- **D98. Reversed by task 25: a lead whose place is not known has no time zone at all.** It is not enrolled and not sent to; there is no `Europe/Budapest` fallback any more. A country that keeps one clock, or the country at the end of the address, still gives a zone without coordinates.
- **D99. The next opening is found in quarter-hour steps**, so it is right for zones that are not on a whole hour too.

## Rendering and preflight (task 17)

- **D100. Settled by task 22, and waiting for you: the footer is one constant in the code.** `FOOTER_IDENTITY` in `apps/web/lib/outreachFooter.mjs` holds your full name and a postal address. It is empty. Until you fill it in, the preflight refuses every sequence email and the gate is shut.
- **D101. `street` and `city` are guessed from the Maps address** by its shape: street first (American) or city first (Hungarian), with or without a postcode in front. When it cannot tell, the value is empty and a text that uses it is not sent to that lead.
- **D102. A rating or review count of 0 is a value.** `{{reviewCount}}` renders "0" for a business without reviews; only an empty field counts as missing, as the plan's code says.
- **D103. Braces left in a rendered text block the email.** `{{first name}}` is not a valid variable name, so the renderer leaves it as typed; the preflight catches it.
- **D104. A skipped step is not written into the lead's history.** The reason is in the Changelog event (`outreach.skip`); `sentStepIds` holds only what went out.
- **D105. Shared mailboxes that only warn**: info, contact, office, hello, admin, sales, support, mail, iroda, titkarsag. The plan named the first three.
- **D106. The "bounced before" and "language differs" warnings are in the preflight but the dispatcher does not feed them yet**: the bounce task and a per-lead language are not there.

## No double sends (task 19)

- **D107. `seq.claimedAt` and `seq.errorCount` are new fields in `seq`, and `failed` and `hold` are new statuses.** The claim time was named in the approval package; the error counter and `failed` come from task 18, and `hold` is how a lead waits for the operator's decision on an email of unknown fate.
- **D108. An `unknown` send parks its lead.** The lead goes to `hold` and leaves the queue until you settle the email on the Sequences tab. "It was sent" moves the lead to its next step; "Send it again" makes the step due at once.
- **D109. A connection that breaks during the hand-over is treated as unknown at once**, not after 10 minutes. Only an error known to come before the server accepts the message (failed login, no connection, a rejected address) counts as refused and is tried again.
- **D110. Refused sends are kept as `failed` rows**, not deleted, and do not count in "sent today" or in the reports.
- **D111. The index `{ outcome, sentAt }` was added to `outreachsends`** for the stale and the unknown rows.
- **D112. Settled by task 30: the one-round-at-a-time lock is in**, on the heartbeat document, beside the per-sender lock of D122.

## Dispatcher (task 18)

- **D113. Settled by task 29: the gate is `lib/campaignGate.mjs`**, asked by the send round on every call.
- **D114. One email per sender per round, three per round in all.** The plan says one to three per round.
- **D115. The pause between two emails of a sender is 60 % of an even spacing of its daily limit over its sending hours**, never under 2 minutes, never over an hour. At 10 a day over 12 hours that is 43 minutes. The plan asks for a pause and gives no length.
- **D116. A lead whose company domain is held by another lead's sequence at send time is taken out** (`stopped`), not left waiting.
- **D117. A lead whose sequence is switched off waits; a lead whose sequence or step was deleted is taken out.**
- **D118. `testMode` and `ignoreWindow` can only be sent in the request body.** There is no button for them; the runner tab never sends them.
- **D119. A round reads at most 8 due leads per sender.** If all 8 are left out for a reason, the sender sends nothing in that round and tries the next ones 45 seconds later.
- **D120. The sent email's text is in the Changelog event, footer included** (see D35).

## From the review of the send round

- **D121. A connection that closes unexpectedly during a send counts as unknown, never as refused.** The review found that the mail library uses one error code for a connection that never opened and for one that dropped while the server's answer to the message was awaited. Treating it as refused would have sent the same email again, up to three times. The price: a plain connection failure now also parks the lead for your decision.
- **D122. `roundAt` is a new field on the sender account**: a 90 second lock, so two overlapping rounds do not both send from the same account.
- **D123. A send the server refused is tried again after 10 minutes**, not on the next round.
- **D124. Leads of a switched-off sequence, and leads another round holds, are not fetched at all**, so they cannot hide the leads behind them.

## Bounces (task 20)

- **D125. `outreachinbox` is keyed by sender, UIDVALIDITY and UID.** The plan says sender and UID; a mailbox whose UIDVALIDITY changed hands out the same UIDs again. The collection name is set by hand, because Mongoose would have called it `outreachinboxes`.
- **D126. New fields**: `bounceKind`, `bounceStatus`, `bounceDiagnostic` on `outreachsends` with the outcome `blocked`; `seq.softBounces` on the lead.
- **D127. A block is recognised by 5.7.1 or by these words in the server's answer**: blocked, blocklist, blacklist, spam, rejected due to, reputation, policy reasons, not authorized, denied. The last three are beyond the plan's list.
- **D128. After a soft bounce the next step waits at least a day.** The plan says "not at once" without a length.
- **D129. After a block the sequence goes on.** The email did not arrive, the lead is not stopped, and the next step may be blocked too; the count is what shows it. Other option: hold the leads of a sender whose block rate is high (that is the gate's job).
- **D130. One bounce per sent email is counted.** A second bounce email for the same send changes nothing.
- **D131. A hard bounce stops the lead even when its sequence has "stop when the email bounces" unticked**, and a reply always stops it. The two switches of a sequence have no effect yet. Open: should they?
- **D132. Settled by tasks 27 and 29: the bounce and block rates are on the Report tab and in the gate.**

## Suppression enforcement, footer, replies (tasks 21 to 23)

- **D133. NEEDS YOUR INPUT: your name and postal address for the footer** (see D100 and docs/OPERATOR_TODO.md section 9).
- **D134. While the footer is empty, a draft sent by hand goes out without one, as it did before.** The sequence send is blocked in that state; the manual send is not, so today's tool keeps working. Once the footer is filled in, every manual send carries it. Other option: block the manual send too until the footer exists.
- **D135. The footer language of a manual send comes from the country of the lead's project** (Hungary: Hungarian, otherwise English).
- **D136. More stop words than the plan's eight**: leiratkozom, ne irjon, toroljon.
- **D137. A reply is a stop request when what the person wrote is a stop word, or starts with one and is at most four words long.** "Stop by our office any time" is a reply, not a request. The plan says "or starts with it" without a limit; without one, a friendly sentence could suppress an interested lead.
- **D138. A stop request suppresses both addresses**: the one the reply came from and the one we wrote to, when they differ. A stop request that matches no lead still suppresses the address it came from.
- **D139. Matching by subject needs exactly one thread with that subject** among the sender's running leads, and a subject of at least 8 characters. Two leads with the same subject are not guessed between; the reply is listed under "Matched no lead".
- **D140. An out-of-office note delays the next step by 3 days.** The plan says "a few days".
- **D141. A reply also marks leads whose sequence had already finished** as replied, so they are not enrolled again (D81).
- **D142. New fields**: `seq.repliedAt`, `seq.autoReplyAt`.
- **D143. A mailbox is read at most every 3 minutes, one mailbox per call, and the runner tab calls every 4 minutes.** With 30 mailboxes each one is read about every two hours. Other option: more calls as the number of accounts grows.
- **D144. The Replies tab has no badge in the navigation.** The warning for replies nobody read in 24 hours is on the Control tab since task 29.

## Offer, enrichment, email quality (tasks 24 to 26)

- **D145. Changed by the operator on 2026-10-06: the opening email names all three services, and emails two to four give the details of each.** So no step is chosen by the offer. `seq.offer` is still decided and stored at enrolment and can be switched by hand, but nothing reads it when a step is sent. Open: keep it (for the order of the follow-ups, or for choosing whom to start them for), or remove it.
- **D146. The reasons are Hungarian phrases, the rest of the dashboard is English.** The task asks for Hungarian because the reasons also go into a prompt; AGENTS.md says UI copy in web is English. Other option: English reasons.
- **D147. The routing weights**: many reviews with a weak average 35 (or 15 for the milder case), an appointment category 30, a phone without online booking 20, complaints about reaching the business 20; a visual category 30, few reviews with a good average 30, no Instagram link on a site that was read 15, a Facebook-only or dead website 10. A side must lead by 10 points for a clear decision. All guesses until the reports say otherwise.
- **D148. "Complaints about reaching the business" are read from `aiPainPoints` and `aiSummary`**, because review texts are not on the lead. A lead that was never enriched gets no points for it.
- **D149. New fields**: `seq.offer`, `seq.offerScore`, `seq.offerReasons`, `seq.offerManual`; `sig` on the lead (`booking`, `ordering`, `instagram`, `ok`, `checkedAt`).
- **D150. The offer can be switched only for a lead that is, or was, in a sequence**, and a lead enrolled again gets a fresh decision by the rule: the hand-made choice lives in `seq`, which a new enrolment replaces.
- **D151. There is no time zone backfill.** The task asks for the zone to be on the lead before sending. It is computed at enrolment, offline and at once, for exactly the leads that are enrolled, and stored in `seq.tz`. Other option: a field outside `seq`, filled for every lead with an email.
- **D152. The website reading covers leads with an email and a real website, best score first**, 18 per call, and is started by hand from the Sequences tab. It is not limited to leads off the suppression list. A site that cannot be read is marked `ok: false` and not tried again.
- **D153. More engines than the task lists** for booking (SimplyBook, Setmore, Vagaro, Mindbody, Resy, Salonic, Bookio) and a list for online ordering (Wolt, Foodora, Uber Eats, DoorDash, Grubhub, ChowNow, Toast, Square Online, Shopify, WooCommerce).
- **D154. A domain counts as "takes no mail" only on a definite DNS answer** (no such domain, or no MX record). A timeout lets the lead through. A domain with no MX but an address record can receive mail in theory; it is left out all the same, as the task says.
- **D155. Addresses refused outright**: noreply and its variants, postmaster, mailer-daemon, abuse, webmaster, hostmaster, privacy, gdpr, dpo, bounce, unsubscribe, newsletter; placeholders such as test@, name@, john.doe@; domains such as example.com, wixpress.com, sentry.io; file names like logo@2x.png.
- **D156. An address at another company's domain is refused only when the lead has a real website to compare with.** Without one, a company domain is accepted at a lower rank. A Facebook or Instagram page does not count as a website here.
- **D157. Ranking prefers a named person over `info@`**, so `seq.to` can differ from the lead's `email` field.
- **D158. The MX answers are remembered in memory per function instance**, not in the database.

## Report, seed list, gate, pre-launch pass (tasks 27 to 30)

- **D159. The hand-entered values live in one document in `caches`**, under the key `outreach:settings`: the Postmaster spam rate, the seed result, the seed addresses, the day SPF/DKIM/DMARC were confirmed, and when the replies were last read. Not a new collection. Other option: a `settings` collection.
- **D160. `offer` is a new field on `outreachsends`**, copied from the lead when the email is sent, so the report can compare the two offers without reading `leads`. Emails sent before this field existed show as "No offer recorded".
- **D161. "SPF, DKIM and DMARC pass" is a confirmation you give by hand**, on the Control tab, stored with its day. Nothing checks the records by itself. Without it the gate is shut. Other option: the server reads the DNS records, which shows that they exist, not that a real email passes.
- **D162. The gate applies to every send round, and `testMode` and `ignoreWindow` work on a local machine only.** A deployed function ignores both flags. The seed test is the one send that does not ask the gate, because the gate needs a seed result and this is how one is made; it goes only to the stored seed addresses, never to a suppressed one, and at most 40 emails an hour, counted in the database.
- **D163. The bounce and block rates block only from 30 emails in the last 7 days.** Below that a share says nothing, so the first days of a campaign are not judged by it. Other option: block on counts in the first days too.
- **D164. After a silence of over 10 minutes the first round is refused and the second sends.** The plan makes a dead loop a blocker; the loop itself is what would end the silence, so the gate looks at the heartbeat from before the round.
- **D165. An idle sender is one tier lower for one day**: the day it sends again after more than three days of nothing. The next day it is back on the tier its calendar days give. Other option: it has to earn the tier back over several days.
- **D166. "Reading the replies" is acknowledged by "Mark all as read" on the Replies tab or by the button on the Control tab**; either sets the same date.
- **D167. The bounce limit shown in the report is 2 %, the gate blocks at 5 % and warns at 2 %**, as the two tasks say. The report marks 2 % red, so red in the report does not mean sending is blocked.
- **D168. The "Open the runner tab" button stands in for "Start sending".** The loop is a browser tab; there is nothing else to start. It is disabled while the gate is shut, with the first reason as its tooltip.
- **D169. The seed test renders the step with the best-scored lead that has an email**, and refuses when the step has a variable that lead has no value for.
- **D170. Settled after the audit: the manual send no longer returns the provider's or the database's own error text.** The provider's words go to the Changelog; the response is a fixed sentence.
- **D171. `OPEN_API` was not changed by the outreach work.** `apps/web/middleware.ts` shows as modified in the working tree from earlier work (it took `/api/sync` and `/api/reviews` OUT of the open set); nothing was added.
- **D172. Not done, because it needs the live database or a real mailbox**: `explain` on the outreach queries, timing a send round and a mailbox round, and the manual tests of every task. They are listed in docs/OPERATOR_TODO.md and under each task in docs/TASKS.md.

## Follow-ups started by hand (operator's change, 2026-10-06)

- **D189. By default a sequence sends only its opening email by itself.** The operator asked for this: with a limit of 35 a day, automatic follow-ups would leave days with one new company reached. A sequence can still be set to go on by itself ("After the first email" in the editor).
- **D190. Once the follow-ups of a lead are started, steps three and four follow by their waits**, without another start. Other option: every step waits for its own start.
- **D191. A started follow-up goes out within two hours** (scattered), not after the step's own wait; the wait of step two is not used when the follow-ups are started by hand.
- **D192. Follow-ups and opening emails share the same daily limit**, oldest due first. Other option: a share of the day reserved for opening emails.
- **D193. One opening email per company, ever.** Enrolment leaves out an address that got a sequence email before, and every address of a company domain that did, in any sequence. Addresses at mailbox providers are judged by the address alone. Other option: allow a company again after some months, or in another sequence.
- **D194. `toDomain` on `outreachsends` got an index** for that check, and `waiting` is a new status of `seq`.
- **D195. Which leads wait is not shown as a count or a filter.** The follow-ups are started for the current filter, the checked leads or a group; the preview says how many of them wait. Counting or listing the waiting leads of a sequence would need a new index on `leads`. Other option: add that index and a "waiting" filter to the lead table.
- **D196. Taking leads out of a sequence also takes out the waiting ones**, and "Mark as replied" works for them.
- **D197. A waiting lead whose sequence was deleted stays as it is**; starting its follow-ups does nothing for it.

## Built-in texts (operator's request, 2026-10-06)

- **D198. The four emails are built into the editor as two templates**, English and Hungarian (`lib/sequenceTemplates.mjs`): Sequences → "+ New sequence" → "Start from a ready text". A template fills a new, switched-off sequence; nothing is saved or sent until you save it and switch it on.
- **D199. The Hungarian texts use the formal address** ("Jó napot kívánok", "Ön"), and the Hungarian footer line was changed to match: "Válaszoljon STOP szóval, és törlöm a listáról." The plan's footer was informal. Other option: informal throughout.
- **D200. The English texts are signed "Tamás", the Hungarian ones "Kálmán Tamás".** The sender account's From name should match.
- **D201. The templates use only `{{name}}`**, so no lead is left out for a missing value. The waits of the follow-ups are 3, 4 and 5 days.

## From the two final reviews

- **D173. NEEDS YOUR DECISION: the middleware matcher and the `next` version** (see docs/OPERATOR_TODO.md section 12). Both are the login gate of the whole app, not of outreach alone, so they were reported and not changed.
- **D174. A bounce counts only when it is proven to come from Google's mail system.** A bounce sent straight by another mail server, after Gmail handed the email over, is stored and shown on the Replies tab ("Nothing was changed: the sender of this bounce could not be verified") and has no effect. Without this rule anyone could suppress a lead, or shut the campaign, with one forged mail. The price: such a late bounce has to be acted on by hand, by suppressing the address on the Replies tab.
- **D175. A stop request from an address that matches no lead suppresses it only when the mail is proven to come from that address.** A stop request from the address we wrote to is always honoured, proven or not: missing a real one costs more than honouring a forged one.
- **D176. A reply matched by its subject alone ends the sequence but never suppresses the lead's own address**, also when it says STOP. Only the address it came from is suppressed, and only when proven.
- **D177. The suppression list has a screen** (Replies tab, "Suppression list"): search, add an address or a company domain, and lift a suppression. Lifting is possible there and nowhere else.
- **D178. The gate is also shut when no sender mailbox was read for 30 minutes**, or ever. Sending while nobody reads the mailboxes means sending past stop requests and bounces. The runner tab reads a mailbox every 4 minutes, so this only bites when IMAP is off or the logins fail.
- **D179. New fields from the reviews**: `inboxTriedAt` and `roundAt` on the sender account; `bounceRecipient`, `bounceDiagnostic`, `attempts`, `authenticated`, `trustedBounce`, `ignored` on `outreachinbox`.
- **D180. A final bounce replaces a temporary one on the same email**; nothing replaces a final one. Suppressing and stopping are done every time a final bounce is handled, also on a second try.
- **D181. A step whose text is at fault is not skipped.** A mistyped variable, braces left in the text or a missing footer would be the same for every lead, so those leads keep the step and are looked at again six hours later; the runner tab says what to fix. Only a value one lead lacks moves that lead on (this refines D104).
- **D182. A message that cannot be handled is tried five times, then left**: it stays in `outreachinbox` without `handledAt`, and in the mailbox.
- **D183. Manual sends are limited to 40 an hour**, in memory per function instance.
- **D184. Sync and the single-lead add drop `seq`, `sig`, any dotted key and any key starting with `$`.** There is still no whitelist of lead fields (docs/SECURITY.md §07).
- **D185. The website fetch allows web ports only and checks the address when the connection is made**, not before it.
- **D186. Not changed, needs measuring**: the enrolment's candidate query on a selective filter (the review could not time it), and a domain with an address record but no MX record is still left out (D154).
- **D187. After a change to the models, a running local dev server silently drops the new fields.** It happened with the first sender account: the warm-up tiers and the send window were not stored. Restart the server, then save again. Production is not affected. The Senders tab now shows a red mark when the warm-up is on with no tiers stored.
- **D188. Clicking a sender's name opens a "today" panel on its card**: today's and tomorrow's limit, the tier it is on, and what is left for the operator. It shows the gate's answer for the whole system, not for that account alone.

## From the security audit of the sender accounts

- **D49. An account may point only at Gmail's servers.** Task 9 lists the hosts and ports as fields, and they are still stored and shown, but only `smtp.gmail.com` (465 or 587) and `imap.gmail.com` (993) are accepted. The audit showed why: with a free host, anyone logged in could change the host to a server of their own and have the stored app password sent there by the connection test. Other option: allow other providers later, with a rule that changing the host needs the password typed again.
- **D50. `next` 16.2.9 has a published advisory for a middleware bypass (GHSA-6gpp-xcg3-4w24, fixed after 16.3.5).** Whether this app meets its conditions was not confirmed. The middleware is the only login gate of every route except the four sender routes, which now check the session themselves. Recommended: update `next`; it is the operator's call because it is a dependency change. `npm audit` lists 8 advisories in all (D27).
- **D51. The sealed password is not tied to its account in the cipher.** Someone who can write to the database could copy one account's sealed value onto another. With D49 it still only travels to Google. Other option: a `v2` format that binds the sender id and login name into the encryption.
- **D52. Only the sender routes check the session inside the route.** Other option: the same check in every route that writes.
- **D53. The connection test is limited to 3 a minute per account**, in memory per function instance, like the login limit.

## Not about outreach

- **D210. Approved on 2026-10-06: the outreach loop can be driven by cron-job.org** through `POST /api/outreach/cron`, guarded by the new env variable `CRON_SECRET`. The runner tab still works; the round lock keeps the two from sending side by side.
- **D208. The Campaign tab's picked leads are the best `opportunityScore` first, among the leads with an email in the chosen country.** Hungarian sequences offer Hungary only, English ones every other country. Other option: another order (newest, a category, no website first).
- **D209. Putting the picked leads in has no second preview.** The list itself is the preview: it is built by the same rules as the enrolment. The rules run again at the write.
- **D207. Approved on 2026-10-06: the covering index `gl_geo` for the map**, `{ project: 1, lat: 1, lng: 1, websiteStatus: 1, dedupKey: 1 }` on `leads`. Mongoose builds it when a server first connects with the new code.
- **D202. The Coverage tab counts from project queries, not from folders.** A place is done for a type when a query names it exactly as the reference list does. Other option: the folder badge's looser match (renamed projects and sub-folder names count too); it needs every folder to be named "<region> <type>".
- **D203. Rows outside the USA are cities checked against their areas, plus one row per country checked against its city list.** There is no county list in the reference data. Other option: add county reference lists (new data files).
- **D204. Types match without spaces, capitals and a plural s only.** "dental clinic" does not count projects scraped as "dentists". Other option: an alias list per column.
- **D205. The columns are kept in the browser (localStorage), default the 14 types asked for.** Other option: store them in the database (a new settings entry).
- **D206. The Italian area list has broken city names** ("Castel Fusano Milano" for Milano), from the generated `lib/countryAreas.ts`. Those rows will show as not started. Not changed.

- **D27. `npm audit` reports 8 vulnerabilities in `apps/web`** (in `postcss`, `sharp`, `nanoid` and others), none from `imapflow`. Nothing was changed. Other option: a separate task to update them.
- **D28. `blitzdeep.com` has no MX or TXT record at all.** Not needed for outreach; noted in case it is not intended.
