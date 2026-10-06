# GridLeads — Web Dashboard (`apps/web`)

The GridLeads dashboard: a **Next.js 16** web app that started as a replica of the
Chrome extension's dashboard and has since grown into the main tool (lead detail
panel, reviews, outreach, calls, map, stats). Behind a single login (`EMAIL` /
`PASSWORD` env, `gl_auth` cookie). See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
for the full picture; the feature and API lists below cover the original core only.

## Core features (shared with the extension dashboard)

- Project sidebar with **folders** (collapse/expand, rename, delete)
- **Checkbox selection** of projects + **shift+click** range select
- **Bulk actions**: move to folder, rename, delete
- Filter chips (All / No website / Has website / Hot / Email found)
- Stat widgets (Total / No website / Hot / Emails / Avg opportunity)
- Sortable table (click any column header; ▲/▼ indicators) + sort dropdown
- **Checked** column, persisted per business
- **Duplicates** modal: per-group **⚡ Fix it**, **⚡ Fix all**, checkbox +
  shift-click multi-delete, click a project name to jump to it
- Resizable sidebar (drag the right edge; width persisted)
- CSV export

## Data — MongoDB

The dashboard reads/writes everything through a **MongoDB** backend (Mongoose).
Set the connection string in `.env`:

```
MONGODB_URI=mongodb+srv://...
```

Collections: `folders`, `projects`, `leads` (leads are a separate collection,
unique on `{project, dedupKey}`, so it scales past the 16MB-per-document limit).
`outreachsequences` holds the email sequences: one document per sequence, its steps inside.
`suppressions` holds the addresses and company domains that must never be written to again.
`outreachsenders` holds the mailboxes outreach is sent from, each with its app password sealed.
`outreachinbox` holds one row per email that arrived in a sender mailbox: replies, bounces, out-of-office notes.
`outreachsends` holds one row per email sent, with what became of it (bounced, replied); the reports count from it.

### API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/folders` `/api/projects` `/api/leads?project=` | the dashboard reads from here. `/api/projects` answers compact rows (`lib/projectsPayload.mjs`); both list routes send an ETag |
| POST | `/api/sync` | **the extension pushes a bundle** (a project, a folder's projects, or everything) — upsert. Needs the login cookie |
| POST | `/api/leads` | add a single lead (`{project, lead}`) one-by-one |
| PATCH/DELETE | `/api/projects` `/api/folders` `/api/leads` | the dashboard's edits persist to the DB |
| GET | `/api/leads?only=total` · `?total=0` · `?key=` | the count alone · rows without a count · one lead by `dedupKey` |
| GET | `/api/sidebar` · `/api/sidebar/stats` | per-folder sums and filter options · stat tiles for a scope (for the lazy sidebar, not used by the dashboard yet) |
| GET | `/api/projects?folder=` · `?search=` | the projects of one folder · the projects matching the sidebar filters |
| GET/POST | `/api/duplicates` | the cached duplicate scan · one slice of a new scan |
| POST | `/api/search-backfill` | one chunk of the search-token backfill; the last chunk switches the lead search to the token index |
| GET | `/api/coverage` | the coverage matrix: per region (US state, country, city) and business type, how many reference places have a project; `?fresh=1` skips the 120 s cache |
| GET | `/api/coverage/missing` | `?type=&country=&kind=`: the places a business type still lacks, as `[{ city, areas }]` for the extension's "Load batches from JSON" |
| POST | `/api/outreach/suggest` | leads to start a sequence with: the best-scored leads of a country that pass every enrolment rule; writes nothing |
| POST | `/api/outreach/cron?job=send\|inbox` | the outreach loop for a scheduler (cron-job.org) instead of the runner tab; needs `Authorization: Bearer <CRON_SECRET>` |
| GET | `/api/outreach/today` | the Campaign tab: the gate, each sender's limit, the leads in line for today with what will become of each, and what went out today |
| GET | `/api/outreach/report` | what went out and what became of it, by step, sender and offer, for 7 or 30 days or all time |
| GET/POST | `/api/outreach/control` | may anything be sent today and why not, the senders' limits, the loop's heartbeat · the values entered by hand (Postmaster spam rate, seed result, acknowledgements) |
| POST | `/api/outreach/seed` | send one step to the seed addresses, the operator's own test mailboxes |
| POST | `/api/outreach/signals` | one chunk of reading leads' websites for booking, ordering and Instagram signals; call until `remaining` is 0 |
| POST | `/api/outreach/offer` | the operator sets a lead's second-round offer by hand |
| POST | `/api/outreach/enroll` | put leads into a sequence or take them out, from the table's filter, the checked leads or a group. `dryRun` first (writes nothing), then one chunk per call until `done` |
| GET/POST | `/api/outreach/sequences` | the email sequences with their steps, what keeps each from running, and its active lead count · a new one |
| PATCH/DELETE | `/api/outreach/sequences/[id]` | edit, switch on or off (switched on, it must pass every check) · delete, after stopping the leads active in it |
| POST | `/api/outreach/sequences/[id]/preview` | the steps of a sequence as one real lead would get them, values filled in; takes an unsaved edit; sends nothing |
| POST | `/api/outreach/sequences/[id]/check` | what saving an edit would do to the leads in the sequence, and which variables lack values; writes nothing |
| GET/POST/PATCH | `/api/outreach/senders` | the sender accounts with today's numbers · add one · edit, switch on or off, restart the warm-up. The app password goes in and never comes back |
| POST | `/api/outreach/senders/test` | log in to one account over SMTP and IMAP; answers ok or a sentence of our own |
| GET | `/api/outreach/porttest` | whether the function reaches Gmail's SMTP (587) and IMAP (993) ports; greeting only, no login |
| POST/GET | `/api/outreach/tick` | one round of the outreach loop, called by the runner tab: sends at most three emails, answers with a sentence, 409 when nothing may be sent · the loop's heartbeat (`stale` after 10 minutes without a round) |
| POST/GET/PATCH | `/api/outreach/inbox` | read one sender mailbox and act on bounces, replies, stop requests · what arrived, for the Replies tab · mark the replies as read |
| GET/POST | `/api/outreach/suppressions` | the suppression list · add an address or a company domain, or lift a suppression by hand |
| POST | `/api/outreach/replied` | the operator marks a lead as having replied by hand; its sequence stops |
| GET/POST | `/api/outreach/unknown` | emails a dead round left behind that may have gone out · the operator's decision on one: it was sent, or send it again |

All endpoints send permissive CORS headers so the Chrome extension can call them.

### Syncing from the extension

In the extension dashboard:
- **⟳ Sync all** (sidebar header) → pushes every project to the web DB
- **⟳** on a folder → syncs that folder's projects
- Select projects → **Sync** (bulk bar) → syncs the selection

Sync needs your dashboard login: `/api/sync` and `POST /api/reviews` accept only requests
that carry the `gl_auth` cookie, so log in to the web app in the same Chrome profile first
(the session lasts 7 days). Without it the extension reports the failed sync and keeps the
leads in the browser.

The extension posts to the production app, `https://gridleads-wheat.vercel.app/api/sync`.
`SYNC_BASE` is hardcoded in four files (`apps/extension/background/background.js`,
`dashboard/dashboard.js`, `audit/audit.js`, and `apps/extension-reviews/background/background.js`);
to sync against `http://localhost:3000`, change all of them.

## Outreach runner

The outreach loop has no server process. One browser tab, `/outreach/runner`, stays open
around the clock on the Kamatera Windows machine and calls `POST /api/outreach/tick` every
30 to 60 seconds. The route decides what is sent; the tab only schedules, shows what the
last round did, and writes today's count into the tab title. Until the dispatcher is built
the route skips every round.

Open the page in one tab only. A second tab shows "Paused" and takes over when the first
one closes. After an error the tab waits 30 seconds, 1, 2 and then 5 minutes and keeps
trying. `GET /api/outreach/tick` answers `stale: true` when no round arrived for 10 minutes.

Machine setup, once, in an administrator command prompt on the Kamatera machine:

```bat
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

- Leave RDP with `tscon` instead of closing the window, so the desktop keeps rendering and
  Chrome does not freeze the tab's timers. Run `query session` to see your session name
  (for example `rdp-tcp#0`), then `tscon rdp-tcp#0 /dest:console`.
- Chrome: Settings → Performance → turn off Memory Saver and Energy Saver, or add the
  dashboard address under "Always keep these sites active".
- Turn off the automatic restart after Windows updates and Chrome's automatic update on
  that machine. A restart stops the loop without any error.

Check on the first day, not during a campaign: 12 hours unattended ("Longest pause in the
log" stays under 10 minutes), an hour disconnected from RDP, two minutes without network,
and a second tab.

## Run

```bash
cd apps/web
npm install
npm run dev      # http://localhost:3000
npm run typecheck
```

`vercel.json` pins the functions to `fra1`, next to the Atlas cluster in Frankfurt. Do not
remove it: in the default US region every database query crosses the Atlantic.

## Structure

```
app/
  layout.tsx          # html shell + globals.css (the extension's CSS, verbatim)
  page.tsx            # renders <Dashboard/>
  globals.css
components/
  Dashboard.tsx       # the full dashboard (sidebar, topbar, table, widgets)
  DuplicatesModal.tsx # duplicate finder + Fix it / Fix all
  OutreachRunner.tsx  # the tab that keeps the outreach loop running (/outreach/runner)
  OutreachSenders.tsx # the Senders tab: accounts, password entry, connection test
  SequencesView.tsx   # the Sequences tab: list, step editor, preview, the check before a save
  EnrollModal.tsx     # put leads into a sequence or take them out: preview first, then the run
  UnknownSends.tsx    # emails that may or may not have gone out, for the operator to settle
  RepliesView.tsx     # the Replies tab: replies, bounces, and mail that matched no lead
  OutreachReport.tsx  # the Report tab: accepted, bounced, blocked, replied, by step, sender and offer
  WarmupConsole.tsx   # the Control tab: the day's gate, the senders' limits, the loop, the seed test
lib/
  types.ts            # Lead / Project / Folder types
  scoring.mjs         # lead + opportunity scoring (copy of the extension engine, parity-tested)
  store.ts            # Zustand store (folders + project summaries, optimistic updates)
  api.ts              # client fetch wrappers for every /api route
  models.ts, db.ts    # Mongoose models and the cached connection
  auth.ts             # JWT cookie login
  outreachSequence.mjs # sequence steps: next step, waits, validation
  sequenceImpact.mjs  # what saving an edited sequence does to the leads in it
  sequenceTemplates.mjs # ready-made four-email sequences the editor can start from
  outreachVariant.mjs # which wording of a step a lead gets (A/B), always the same one
  stableHash.mjs      # a number from a string that never changes between runs
  outreachState.ts    # the only writer of a lead's sequence state: advanceSequence, stopSequence
  inboxWatcher.ts     # one mailbox round: store each message once, then bounces, replies, stop requests
  bounceRules.mjs     # hard, soft or block: what a bounce means and what follows
  replyRules.mjs      # stop words, cutting the quoted original, matching a reply by subject
  campaignGate.mjs    # may anything be sent today: blockers and warnings, every threshold in one constant
  campaignState.ts    # reads what the gate needs and asks it
  outreachSettings.ts # the values the operator enters by hand, in one document
  outreachReport.mjs  # folds counted send rows into the report
  seedTest.ts         # sends one step to the seed addresses
  dispatcher.ts       # one send round: gate, limits, window, claim, render, preflight, send
  sendGuard.mjs       # the rules against a double send: claim, stale, unknown, failure kinds
  outreachRender.mjs  # {{variables}} of a sequence text: the catalogue, rendering, address parts
  outreachPreflight.mjs # the last check before an email leaves: blocks and warnings
  outreachMessage.mjs # the plain-text message for the mail library, with threading
  outreachFooter.mjs  # attaches the footer every email must end with
  enroll.ts           # enrolment and unenrolment: preview and chunked run
  enrollPlan.mjs      # who goes into a sequence and who is left out, and why
  emailQuality.mjs    # which address of a lead is worth writing to, and which never
  mxCheck.ts          # does a domain take mail at all (cached MX lookup)
  routeOffer.mjs      # the second-round offer of a lead: AI automation or social media, with reasons
  timezoneFromCoords.mjs # a lead's time zone from its coordinates, offline
  siteSignals.mjs     # booking, ordering and Instagram signals out of a page's HTML
  siteFetch.ts        # guarded fetch of a lead's website
  netGuard.mjs        # is a URL, and an address, safe for the server to fetch
  leadMatch.ts        # the lead table's filter as a MongoDB match, shared with enrolment
  outreachSends.ts    # one row per email sent (recordSend)
  outreachSenders.ts  # sender accounts: list for the dashboard, connection test
  outreachSenderRules.mjs # sender input checks, connection messages, warm-up day
  secretBox.mjs       # seals and opens the app passwords (AES-256-GCM, OUTREACH_SECRET_KEY)
  warmup.mjs          # a sender's daily limit: tiers, calendar days, the day's start
  sendWindow.mjs      # the lead's time zone from its coordinates, and the send window on that clock
  dispatchPlan.mjs    # room left today, which sender gets which lead, one sequence per company domain
  companyDomains.ts   # the company domains that have a running sequence
  session.ts          # in-route session check for the sender routes
  suppression.ts      # the suppression list: isSuppressed, suppress, suppressDomain, unsuppress
  suppressionRules.mjs # how an address is keyed, which domains are mailbox providers
  outreachRunner.mjs  # rhythm, backoff and tab lock of the outreach runner
  inboxClassify.mjs   # incoming mail: bounce, auto-reply or human; delivery report parsing
  inboxPlan.mjs       # IMAP UID tracking per sender, UIDVALIDITY change
  imapFetch.ts        # one read-only IMAP round over imapflow
  portProbe.mjs       # greeting-only check of a mail port
  seed.ts             # demo dataset (with folders + duplicates)
```
