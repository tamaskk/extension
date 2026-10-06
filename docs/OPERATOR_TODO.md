# Operator to-do: outreach setup

Manual steps that only the operator can do (accounts, DNS, the Kamatera machine). No code. Tick a box when the step is done and checked. The matching tasks are T-037 and T-038 in docs/TASKS.md.

Never put an app password into this file, the code, a `.env` file or a chat. They go only into the encrypted sender store once it exists.

## 1. DNS for itsblitzdeep.com (T-038)

Edit at GoDaddy, the name servers are `domaincontrol.com`. Do these first: a change takes hours to spread, and DMARC reports take days to arrive.

State on 2026-10-06: MX is right (`smtp.google.com`), the DKIM key is published under the `google` selector, SPF and DMARC are still GoDaddy's defaults.

- [ ] SPF: change the existing TXT record on `@`, do not add a second one. New value:
      `v=spf1 include:_spf.google.com ~all`
      If mail is also sent from GoDaddy's own mailbox on this domain, use
      `v=spf1 include:_spf.google.com include:spf.em.secureserver.net ~all`
- [ ] DMARC: change the TXT record on `_dmarc` to
      `v=DMARC1; p=none; rua=mailto:tom@itsblitzdeep.com`
      Keep `p=none` for weeks and read the reports. Move to `p=quarantine` only when every legitimate send passes.
- [ ] Check from a terminal that the records are really out:
      `nslookup -type=TXT itsblitzdeep.com`
      `nslookup -type=TXT _dmarc.itsblitzdeep.com`
      `nslookup -type=TXT google._domainkey.itsblitzdeep.com`

## 2. Google Workspace (T-038)

- [ ] DKIM signing switched on: Workspace admin → Apps → Google Workspace → Gmail → Authenticate email → Start authentication. The status must read "Authenticating email". Publishing the key alone is not enough.
- [ ] `tom@itsblitzdeep.com` (English): 2-step verification on.
- [ ] `tom@itsblitzdeep.com`: app password generated (16 characters) and kept in a password manager.
- [ ] `tom@itsblitzdeep.com`: IMAP enabled in Gmail → Settings → Forwarding and POP/IMAP.
- [ ] `tamas@itsblitzdeep.com` (Hungarian): 2-step verification on.
- [ ] `tamas@itsblitzdeep.com`: app password generated and kept in a password manager.
- [ ] `tamas@itsblitzdeep.com`: IMAP enabled.
- [ ] The From display name of both accounts is a person's name, not a company name.

Connection data for later: SMTP `smtp.gmail.com`, port 587, STARTTLS. IMAP `imap.gmail.com`, port 993, SSL.

## 3. Proof that authentication works (T-038)

- [ ] Test email from `tom@` to a Gmail address: open it, "Show original", and see SPF PASS, DKIM PASS and DMARC PASS. All three; "neutral" or "softfail" does not count.
- [ ] The same from `tamas@`.
- [ ] Test email from both accounts to an Outlook address, headers read there too.
- [ ] Google Postmaster Tools: `itsblitzdeep.com` added and verified. It does not measure backwards, so add it before the first campaign.

## 4. Kamatera machine and the runner tab (T-037)

The commands and the reasons are in apps/web/README.md, section "Outreach runner".

- [ ] Sleep, display sleep and hibernate turned off with `powercfg`.
- [ ] Chrome: Memory Saver and Energy Saver off, or the dashboard address kept always active.
- [ ] Automatic restart after Windows updates off, Chrome automatic update off.
- [ ] Logged in to the dashboard in that Chrome (the session lasts 90 days), `/outreach/runner` open in one tab.
- [ ] 12 hours unattended: "Longest pause in the log" stays under 10 minutes.
- [ ] One hour disconnected from RDP (left with `tscon`): rounds kept coming.
- [ ] Two minutes without network: the tab shows the error and returns to "Running" by itself.
- [ ] A second tab on the same page shows "Paused".
- [ ] Vercel plan checked: about 58,000 function calls a month at the 45 second rhythm, plus the IMAP loop.

## 5. Mail ports from Vercel (T-039)

- [ ] After the next deploy, open `https://gridleads-wheat.vercel.app/api/outreach/porttest` while logged in. `smtp.ok` and `imap.ok` must both be `true`. If either is `false`, stop: the outreach design depends on these two ports and has to be rethought before more code is written.

## 6. The `gl_seq_due` index (T-040)

The index is declared in the code. MongoDB builds it the first time a deployed function, or a local dev server, loads the lead model: it scans all leads once, in the background, and the collection stays readable.

- [ ] Make that first load happen while the scraper is not syncing (deploy, or start the local dev server, at a quiet hour).
- [ ] In Atlas, or with `db.leads.getIndexes()`, see that `gl_seq_due` exists with its `partialFilterExpression`.
- [ ] Once a few leads are enrolled, run this in `mongosh` and check that the winning plan is `IXSCAN` on `gl_seq_due`, that `totalDocsExamined` is close to `nReturned`, and that `executionTimeMillis` is under 100. Put a real sender id in place of `SENDER_ID`:

```js
db.leads.find({ 'seq.senderId': 'SENDER_ID', 'seq.status': 'active', 'seq.nextStepAt': { $lte: new Date().toISOString() } })
  .sort({ 'seq.nextStepAt': 1 }).limit(20).explain('executionStats')
```

## 7. Sender accounts in the dashboard (T-044)

- [ ] Generate the master key once: `openssl rand -base64 32`. Keep a copy in a password manager: if it is lost, every app password has to be typed in again.
- [ ] Set it as `OUTREACH_SECRET_KEY` in Vercel (Production and Preview) and in the local `apps/web/.env`, then deploy.
- [ ] Dashboard → Senders → Add account, for `tom@` (English) and `tamas@` (Hungarian), each with its app password. Type the password only into that form.
- [ ] Press "Test connection" on both: "SMTP works. IMAP works."
- [ ] Type a wrong password into one account, test (it must say the login was refused), then put the right one back.
- [ ] Save an account with the password field left empty, then test again: it still works.
- [ ] Open `/api/outreach/senders` in the browser and read the answer: nothing in it looks like a password.
- [ ] Look at one document of `outreachsenders` in Atlas: `authSecret` starts with `v1:` and is not readable.
- [ ] Switch the accounts on only when sending is ready to start.

## 8. First enrolment (T-049)

Enrolment writes `seq` on many leads at once, on live data. Before the first real run:

- [ ] The `gl_seq_due` index exists (section 6). Without it the preview fails, on purpose.
- [ ] At least one sender account of the sequence's language is switched on, and the sequence passes its checks.
- [ ] Lead table → filter to a small, known set → "📨 Sequence" → Preview. The number under "The selection holds" equals the table's total for the same filter.
- [ ] Read the preview: how many would be enrolled, who is left out and why, the ten sample rows. Start with a limit of 10.
- [ ] After the run: the leads show in the sequence's count, their first emails are due at different times within two hours, and the Changelog has one "Enrolled" event.
- [ ] Run the same enrolment again: it enrols nobody ("already in a sequence").
- [ ] Take them out again with "Take leads out of their sequence", preview first.

## 9. The footer: name and postal address (T-057)

Nothing can be sent from a sequence until this is done.

- [ ] Decide which postal address goes into every email. It ends up in spam databases, so a virtual office address may be better than a home address.
- [ ] Put your full name and that address into `FOOTER_IDENTITY` in `apps/web/lib/outreachFooter.mjs`. It is the one place.
- [ ] Deploy, then send yourself one English and one Hungarian email and read the footer.
- [ ] Send a draft by hand from a lead's email tab: the footer is on it too.

## 10. Replies, every day

- [ ] Open the Replies tab once a day and read what came. "Mark all as read" when done.
- [ ] Look at "Matched no lead": these are in the sender's mailbox and need a person.
- [ ] After the first few hundred sends, read the bounces that could not be read (Changelog, "Bounce"): a pattern that keeps coming back should be added to the parser.
- [ ] A lead who called back, or answered in a brand-new email: lead panel → email tab → "Mark as replied".

## 11. Before the first real send, and every day after (T-063, T-064)

The Control tab says whether sending is allowed and exactly why not. These are the things only you can do to open the gate.

- [ ] Create six to ten test mailboxes at three providers or more: Gmail (the most important), Outlook or Hotmail, Yahoo, one or two on a domain of your own. Not the mailboxes you use every day, and not in the same browser profile.
- [ ] Control tab → enter the seed addresses → "Send seed test" with the first step of the sequence. Open every mailbox. Count: inbox, Promotions, spam.
- [ ] Send a plain email with no link from the same sender too. If that one arrives and the step does not, the text is the problem; if both land in spam, it is the domain or the authentication.
- [ ] Enter the result ("in the inbox, out of") on the Control tab. Repeat at least every 14 days, and before every new step goes live.
- [ ] If it lands in spam: stop. Do not raise the volume. Check SPF, DKIM and DMARC, cut the links, shorten the text, simplify the subject, and take the daily limit down a tier.
- [ ] Add `itsblitzdeep.com` to Google Postmaster Tools. Read its spam rate and enter it on the Report tab, with the day. Repeat at least every 14 days.
- [ ] Control tab → "I checked: all three pass", once SPF, DKIM and DMARC all show PASS in "Show original".
- [ ] Every day: read the Replies tab and press "Mark all as read".
- [ ] Once: while the Control tab says blocked, open `/api/outreach/tick` directly (a POST with JSON). It must answer 409 and send nothing.

## 12. Two things outside the outreach code (T-065)

Found by the security audit; not changed, because they touch the login gate and a dependency.

- [ ] Decide on the middleware matcher: a path that contains `.png`, `.ico` or another image extension anywhere reaches its route without a session. The fix is one `$` at the end of the extension group in `apps/web/middleware.ts`.
- [ ] Decide on updating `next` past 16.3.5 (advisory GHSA-6gpp-xcg3-4w24, middleware bypass).
- [ ] After any change to `apps/web/lib/models.ts`, restart the local dev server before saving anything: a running server keeps the old model and silently drops the new fields.

## 13. Leftovers in the repository

- [ ] Session length text still says "7 days" in docs/ARCHITECTURE.md §06, docs/SECURITY.md §03, apps/web/README.md and apps/extension/README.md. The code is 90 days. Change the text by hand, or let the agent do it.

## 14. The `gl_geo` index (map speed)

- [ ] Restart the dev server (or deploy). Mongoose builds the index on first connect; on 1.6M leads allow a few minutes.
- [ ] In Atlas, or with `db.leads.getIndexes()`, see that `gl_geo` exists.
- [ ] Open the Map on a large folder and time it. If it is still slow, run the query with `.explain('executionStats')` and check that the winning plan is `IXSCAN` on `gl_geo` with `totalDocsExamined: 0`.

## 15. Sending without an open tab (cron-job.org)

- [ ] Generate a secret: `openssl rand -hex 32`. Put it in Vercel as `CRON_SECRET`. Deploy.
- [ ] cron-job.org, job "GridLeads send": URL `https://<production domain>/api/outreach/cron?job=send`, every 1 minute, Advanced: method POST, header `Authorization` = `Bearer <the secret>`.
- [ ] Job "GridLeads inbox": URL `https://<production domain>/api/outreach/cron?job=inbox`, every 5 minutes, same method and header.
- [ ] "Test run" on both: the answer is `{"ok":true,...}`. A 404 means the secret is missing in Vercel, shorter than 32 characters, or the header is wrong.
- [ ] On the Campaign tab the chip reads "Send loop last ran" with the current minute. Close every runner tab.
- [ ] If the secret leaks: change `CRON_SECRET` in Vercel, redeploy, update the two jobs.
