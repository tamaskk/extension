# Architecture: GridLeads

This file describes the code as it is. Goals that are not true yet are listed once, under "Target (not yet true)" at the end.

## 01 System overview

```
Chrome: apps/extension            Chrome: apps/extension-reviews
(Maps search scraper)             (review scraper)
    |  POST /api/sync (cookie)        |  GET /api/reviews/next
    |  GET  /api/missing-states       |  POST /api/reviews (cookie)
    |  POST /api/audit (cookie)       |
    v                                 v
apps/web  (Next.js dashboard + route handlers, Vercel project "gridleads")
    |
    +--> MongoDB Atlas, database "myapp"  <---- read-only ---- apps/landing (GET /api/stats)
    +--> OpenAI (drafts, email research)  <---- read-only ---- apps/tokenleads (own db "leadtokens")
    +--> Vapi (AI calls)
    +--> Resend (email)
    +--> local Claude CLI (enrich, localhost only)
```

- The operator uses the dashboard and the two extensions. The extensions call the production URL `https://gridleads-wheat.vercel.app`, hardcoded as `SYNC_BASE`.
- Browser code never talks to MongoDB. Everything goes through route handlers.
- Third-party services are called from route handlers only, with two exceptions that run in the browser: Nominatim geocoding and Leaflet from unpkg, both in `apps/web/components/MapModal.tsx`.

## 02 Tech stack

| Layer | Choice | Why this, not the obvious alternative |
| --- | --- | --- |
| Frontend | Next.js 16 App Router, React 19, TypeScript strict | One deployable per app on Vercel; no separate API server to run |
| Styling | One global stylesheet per app, CSS variables | The web CSS started as the extension's stylesheet, copied verbatim; Tailwind was never introduced |
| Backend | Next.js route handlers, `runtime = 'nodejs'` | Mongoose needs Node; Edge is used only for middleware |
| Database | MongoDB Atlas, single database `myapp` | Lead records are wide, sparse and change shape often; two-database sharding was tried and reverted |
| Queries | Mongoose 9; the native driver for `activities` and `caches` | Append-only and cache collections do not need schemas |
| Validation | Manual coercion and whitelists in each route | No validation library is installed |
| Auth (web) | One account from env `EMAIL` and `PASSWORD`, HS256 JWT cookie `gl_auth` via `jose` | Single operator; a user collection would be unused |
| Auth (tokenleads) | Users in MongoDB, bcryptjs, JWT cookie `tl_auth`, API keys | Multi-user product |
| Client state | zustand store for folders and summaries; component state for everything else | Most views are fetched on demand and paged on the server |
| Payments | None in GridLeads. Stripe in tokenleads | — |
| Email | Resend over raw `fetch` | Plain-text outreach only; no SDK needed |
| Outgoing sequence mail | `nodemailer` over SMTP, from the sender accounts in `outreachsenders` | SMTP is not HTTP, so raw `fetch` cannot send it. So far only the connection test uses it; the manual send is still Resend until T-036 |
| Incoming mail | `imapflow` over IMAP, one short read-only round per call (`lib/imapFetch.ts`) | Outreach goes out over SMTP, so replies and bounces come back only as mail; IMAP is not HTTP, so raw `fetch` cannot read it |
| AI | OpenAI over raw `fetch` (web); `@anthropic-ai/sdk` (tokenleads); local `claude -p` CLI (web enrich) | — |
| Calls | Vapi over raw `fetch` | — |
| Hosting | Vercel, deployed with the CLI from the app folder | No Git integration; see AGENTS.md §09 |
| Extensions | Manifest V3, plain JavaScript, no build step | Loaded unpacked; libraries attach to `self` through IIFEs |
| Testing | `node:test` for `apps/web/lib/*.test.mjs`; Vitest in tokenleads | No end-to-end tests |

Do not add a dependency that overlaps with a row in this table without asking.

## 03 Project structure

```
/
  AGENTS.md                agent instructions (read first)
  docs/                    PRD, design system, this file, security, tasks
  docs/archive/            the plan that was never built. Do not treat as truth.
  apps/
    web/                   the GridLeads dashboard
      app/                 pages, layout, globals.css
      app/api/<name>/route.ts   one folder per endpoint; logic lives here
      components/          flat folder, PascalCase files, one default export each
      lib/                 db.ts, models.ts, auth.ts, api.ts (client fetch wrappers),
                           store.ts (zustand), scoring.mjs, activity.ts, projectStats.ts,
                           generated data files (states.ts, countries.ts, ...)
      middleware.ts        login gate and the list of open API paths
    extension/             Maps scraper: background/, content/, popup/, dashboard/,
                           audit/, changelog/, lib/
    extension-reviews/     review scraper: background/, content/, popup/
    landing/               marketing page, one route: GET /api/stats
    tokenleads/            separate product; has lib/ helpers, tests/, vercel.json crons
  docs/archive/            also holds the legacy code of that plan: prisma/ (schema),
                           scoring/ (the old TypeScript scoring library) and states_table/
                           (census source spreadsheets). Nothing imports them.
  LeadsMap_Crx/            third-party reference, gitignored. Not used by any app.
```

There is no root `package.json` and no workspace. Each Next.js app has its own `package.json` and `package-lock.json`; run npm with `--prefix apps/<app>`. The import alias `@/*` maps to the app's own root folder.

Where new code belongs:
- A new endpoint in web: `apps/web/app/api/<name>/route.ts`, plus a wrapper in `apps/web/lib/api.ts`.
- Logic shared by two or more routes: a named export in `apps/web/lib/<topic>.ts`.
- A new model or field: `apps/web/lib/models.ts` (ask first, see §08).
- A new view or modal: `apps/web/components/<Name>.tsx`, styles in `apps/web/app/globals.css` under a new class prefix.
- A new endpoint the extension must reach without login: also add the exact path to `OPEN_API` in `apps/web/middleware.ts` (ask first).
- tokenleads: follow its own helper layer (`lib/apiUtil.ts`, `lib/tokens.ts`, `lib/leads.ts`).

## 04 Data flow

Request path for a write in `apps/web`:
1. A component calls a wrapper in `lib/api.ts` (`jget` / `jsend`).
2. `middleware.ts` checks the `gl_auth` cookie unless the path is in `OPEN_API`.
3. The route handler calls `connectDB()`, coerces and whitelists the input by hand, and runs the query and the business rule inline.
4. Writes that change counters call the helpers in `lib/projectStats.ts`; edits are recorded with `lib/activity.ts`.
5. The handler returns through `json()` from `lib/models.ts`, which adds the CORS headers.

Response shape: mostly `{ ok: true, ... }` or `{ ok: false, error }` with 400, 404, 500 or 502. Exceptions that clients depend on: `GET /api/folders` returns a bare array, `GET /api/projects` returns the compact `{ v, folders, rows }` payload, `GET /api/geo` returns `{ cols, points, total, capped }` with array rows, `GET /api/leads` returns `{ rows, total }`, `GET /api/missing-states` returns `{ error }` on failure.

State:
- Server state lives in MongoDB. Dates are stored as ISO strings.
- `lib/store.ts` (`useGrid`) holds the folders, the per-folder sums (`own`, `missing`, `ungrouped`, `all`), the filter `facets`, `summaries` (only the projects of folders opened so far), `folderState` and `hydrated`. `hydrate()` first reads the sidebar payload from the browser's HTTP cache (`fetch` with `force-cache`), so the sidebar shows the last seen state at once, then revalidates and replaces it only when the ETag differs. Its mutations are optimistic: state is set first, the request follows, and failures are swallowed.
- Leads and every other view are fetched into component state.
- `localStorage` holds layout only: `gridleads_sw`, `gridleads_pw`, `gridleads_collapsed`, `gridleads_ungrouped`, `gridleads_cols`, `gridleads_hidden_cols`. The outreach runner tab adds `gridleads_orun_lock` (which tab runs the loop) and `gridleads_orun_log` (its last 2,000 rounds).

Long jobs: Vercel functions are limited to 60 seconds (120 or 300 on sync-like routes), so `projects/refresh`, `categories/summary`, `recalc`, `duplicates` and `search-backfill` process one chunk per request and the client loops until done.

Extension data: `chrome.storage.local` keys `gridleads_projects`, `gridleads_folders`, `gridleads_batch*`; IndexedDB `gridleads_log` for the event log. Sync sends bundles of 500 leads, gzipped, with header `x-gl-gzip: 1`.

Errors: every handler that touches the database wraps its body in `try/catch` and answers `{ ok: false, error: e.message }` with 500. `GET /api/folders` and `POST /api/export` answer a bare payload on success, so their wrappers in `lib/api.ts` must not treat an error body as data.

## 05 Boundaries

Allowed:
- Components import from `lib/api.ts`, `lib/store.ts`, `lib/types.ts` and pure helpers.
- Route handlers import `lib/db.ts`, `lib/models.ts` and the server helpers.

Never:
- A component or `lib/api.ts` imports `lib/db.ts`, `lib/models.ts`, `lib/auth.ts` or anything that reads `process.env` secrets.
- A third-party call with a secret from the browser. Keys are read in route handlers only. No `NEXT_PUBLIC_*` secret; the only public variable in the repo is `NEXT_PUBLIC_CRM_URL` in landing.
- `apps/tokenleads` or `apps/landing` writing to the `myapp` database. They read it; only `apps/web` writes.
- Extension code depending on a bundler, npm package or remote script.
- Code in one app importing from another app's folder. Shared logic is duplicated today; change all copies together. Scoring has two copies, `apps/web/lib/scoring.mjs` and `apps/extension/lib/scoring.js`, and `apps/web/lib/scoring.test.mjs` fails when they disagree.

## 06 Decisions that look wrong but are intentional

The agent must not "fix" these.

- **Only the read-only scraper endpoints are open.** `/api/reviews/next` and `/api/missing-states` need no login. `OPEN_API` in `apps/web/middleware.ts` matches exact paths only, so sub-routes stay protected.
- **Every route that writes lead data requires the `gl_auth` cookie**, including the ones the extensions call: `/api/sync`, `/api/reviews` and `/api/audit`. The extensions send the cookie (`credentials: 'include'`), so the operator must be logged in to the dashboard in the same browser; the session lasts 7 days. On a 401 the main extension keeps the leads in the browser and the review scraper stops its run.
- **`/api/enrich` is open in middleware but guarded in the route** by a localhost Host check (`ENRICH_ALLOW=1` overrides). It spawns the local Claude CLI and is meant to run on the operator's machine only.
- **CORS `*` on every `json()` response** so the extensions can call the API from any origin.
- **Leads are a separate collection keyed by the project's query string**, not embedded and not referenced by ObjectId. A project document would pass 16 MB.
- **"No real website" is eight statuses**: `NO_WEBSITE`, `FACEBOOK_ONLY`, `INSTAGRAM_ONLY`, `BROKEN`, `DOMAIN_EXPIRED`, `NOT_WORKING`, `DOMAIN_PARKED`, `UNDER_CONSTRUCTION`. A parked or under-construction domain is still a sales opportunity. The list has copies in `apps/web/lib/models.ts`, `apps/web/lib/types.ts`, `apps/web/lib/scoring.mjs`, `apps/landing/lib/models.ts` and the extension (`lib/scoring.js`, `background/background.js`, `dashboard/dashboard.js`).
- **A business lives in exactly one project.** On sync the first project to hold a `dedupKey` wins.
- **Empty contact fields never overwrite stored values on sync.** Empty means unknown, not erased. The extension mirrors this rule.
- **`ProjectStat` holds precomputed counters.** A `$group` over more than a million leads is too slow and hits the Atlas memory limit.
- **The `/api/projects` payload is cached in MongoDB, gzipped, with an ETag** rather than in memory: Vercel spreads requests across cold instances, and the response must stay under 4.5 MB. The ETag is a hash of the content, so the browser gets a 304 until a name, a folder or a counter really changes. After 120 seconds the stored payload is still served at once and rebuilt after the response (`after()` in the route, helpers in `lib/cache.ts`); only a structural edit drops it and makes the next request rebuild inline.
- **`GET /api/projects` answers compact rows**, not objects (`lib/projectsPayload.mjs`): `{ v: 2, folders, rows }`. `lib/api.ts` decodes it back to `ProjectSummary[]`; it is the only client of that route.
- **The lead table sorts without an `_id` tie-break**, except by opportunity and lead score. `{ field, _id }` matches no single-field index and made MongoDB sort all leads in memory; ties come in index order instead. Sort keys are whitelisted in `app/api/leads/route.ts`.
- **The sidebar renders only the rows near the viewport** (`lib/windowing.mjs`). Rows have fixed heights (project 33 px, folder 34 px, 4 px apart) that `Dashboard.tsx` and `.side-rows` in `globals.css` must agree on. Projects with no folder sit in one "Ungrouped" group, closed by default. Rendering every row was 64,000 DOM nodes.
- **The lead count is a separate request** (`GET /api/leads?only=total`), and where a chip is the only filter the dashboard takes it from the project counters and asks nothing. Counting was often 100 times slower than fetching the page.
- **Lead search is by word prefix once the backfill has run.** Each lead stores `searchTokens` (`lib/searchTokens.mjs`); every write path refreshes them from the stored values (`lib/searchIndex.ts`). `POST /api/search-backfill` fills them for existing leads and then sets a flag in `caches`; until that flag exists the search stays the old substring regex. After it, "pizz" finds "Pizza Hut" but "zza" finds nothing.
- **Duplicates are found by Google `cid`**, in a chunked scan the client drives, cached in `caches`. A single `$group` over all leads exceeds the aggregation memory limit.
- **Map markers carry only position, colour and `dedupKey`**; the popup is fetched on click (`GET /api/leads?key=`). The map draws them itself on one canvas (`lib/mapGrid.mjs`, the layer in `MapModal.tsx`): single dots when few are in view, otherwise one circle per screen cell. `leaflet.markercluster` is no longer loaded; it built an object per lead and took tens of seconds for a full map. `GET /api/geo` reads one row past the cap instead of counting, so `total` is the number of points sent. The index `gl_geo` covers the unfiltered query; the route asks for number ranges on `lat` / `lng` because a `$ne: null` test would force a document read.
- **The dashboard can queue searches in the extension, through a content script.** `apps/extension/content/dashboardBridge.js` runs on the dashboard's own pages and relays `window.postMessage` requests from `CoverageMatrix.tsx` to the background. It passes on `batchEnqueue`, `batchStartQueue`, `batchStartAdopt` and the read-only `batchStatus` and `batchQueue` only, checks that the message comes from the page itself, and caps the sizes; no other background command is reachable from a page. It works only in the browser that has the extension. A new dashboard host needs a line in the manifest's `content_scripts`. The batch engine opens worker windows because Chrome stops rendering a hidden tab and the scrape scrolls the result list; the tab mode (`inTab`, one worker in a tab of the current window, brought to the front) exists for runs started from the dashboard and is slower by design.
- **The Coverage tab is a second, stricter count than the folder badge.** `GET /api/coverage` (`lib/coverageMatrix.mjs`, `lib/coverageMatrixData.ts`, cache key `coverage-matrix`) reads project queries only, not folders: a place counts for a type when a query is "<type> near <place> <region>" with the place spelled as in the reference list. The folder badge (`lib/coverage.mjs`) also accepts renamed projects and sub-folder names, so the two numbers can differ. Types are compared without spaces, capitals and a plural s. The index covers every type, so the columns are chosen in the browser (localStorage).
- **The sidebar is lazy.** The store starts from `GET /api/sidebar` (folders, one row of sums per folder, filter options, the accurate coverage gap per folder; about 250 KB) and fetches a folder's projects when it is opened (`GET /api/projects?folder=`). The sidebar filter is a server search (`?search=`), and the tiles of a project scope or a type / region / country filter come from `GET /api/sidebar/stats`. The browser never holds all projects. After a project move or delete the store reloads the sidebar and the open folders instead of patching sums locally. `GET /api/projects` without parameters (the full list) is no longer called by the dashboard; it stays until the lazy sidebar has run in production for a while, then goes.
- **The lead table does not wait for the sidebar.** `Dashboard.tsx` requests the lead page on mount; only the sidebar and the tiles show a skeleton until the store is hydrated.
- **The web functions run in `fra1`** (`apps/web/vercel.json`) because the Atlas cluster is in Frankfurt. In the default region every query crossed the Atlantic.
- **Long jobs are driven by the client in chunks** (see §04) instead of a queue.
- **After the opening email a lead waits; the follow-ups are started by hand.** A sender has a few dozen emails a day. If every follow-up went out by itself, the day's limit would go to people already written to, and there would be days with one new company reached. So unless a sequence says `autoFollowUp`, `planAdvance` leaves a lead `waiting` after the opening email: it keeps its next step and nothing is due. The operator starts the follow-ups for the leads they choose (the same three selections as enrolment, with a preview: `continue` in `POST /api/outreach/enroll`); from there the steps follow by their waits and share the daily limits with the opening emails. A waiting lead is outside the partial index `gl_seq_due`, so it costs the send round nothing. One opening email per company, ever: enrolment leaves out an address, and a company domain, that `outreachsends` already holds an email for.
- **A sequence step is found by a random `id`, never by its position, and its wait is `delayDays` after the step before it.** With the position as the key, one inserted step would shift every running lead and people would get the same email twice; with absolute days, an insert would mean renumbering the rest. A switched-off step is skipped but its wait still counts. The steps are a `Mixed` array in `outreachsequences`; the rules and the validation are in `lib/outreachSequence.mjs`.
- **Every email sent has a row in `outreachsends`, beside the lead fields and the activity event.** The lead keeps only its last send and the activity log is append-only, but the outcome of an email changes days later (a bounce, a reply), so it needs a row that can be updated. Reports count from `outreachsends` only, never from `leads`. `lib/outreachSends.ts` writes the row; incoming mail is matched through the `{ to, sentAt }` index.
- **Sender app passwords are stored in the database, sealed.** Twenty or thirty mailboxes cannot each be an environment variable and a deploy. `lib/secretBox.mjs` seals with AES-256-GCM under `OUTREACH_SECRET_KEY`, which lives only in the environment; with the key missing nothing is stored, there is no plain fallback. The sealed value is `authSecret` on `outreachsenders`, declared `select: false`, and it has one way out: `lib/outreachSenders.ts` opens it for a connection. `GET /api/outreach/senders` answers `hasPassword` and nothing else about it; an empty password on `PATCH` keeps the stored one; the connection test answers with sentences of our own, never the mail server's. An account may point only at Gmail's servers (`ALLOWED_MAIL` in `lib/outreachSenderRules.mjs`), checked on save and again before every connection: the stored password is sent to whatever host the account names, so a free host field would be a way to read it out. The sender routes also verify the session cookie themselves (`lib/session.ts`) instead of relying on the middleware alone. Accounts are switched off, not deleted.
- **Enrolment is always two steps, and the lead table's filter exists once.** `POST /api/outreach/enroll` with `dryRun` writes nothing and answers what would happen; only an explicit `dryRun: false` writes, one chunk of 500 candidates per call, with the client looping as for every long job (§04). A request without the flag is a preview. Both steps decide by the same pure rules (`lib/enrollPlan.mjs`), in a fixed order: a usable address, no running sequence, not suppressed, the language, a free company domain, a sender; every lead left out is counted under the first rule that left it out. The selection is one of three existing notions (the table's filter, the checked leads, a group), and the filter reaches the server as the query string of `GET /api/leads`, turned into a match by `lib/leadMatch.ts`, the same code the table uses, so a preview cannot count one set of leads and the run write another. The first emails of a batch are spread over 120 minutes. A lead's language comes from the country of its project (Hungary: Hungarian, any other known country: English); a lead whose country is not recognised is not enrolled on a guess.
- **Whether anything may be sent today is a gate on the server, not a screen.** The warm-up says how much a sender may send; `campaignGate` (`lib/campaignGate.mjs`, pure, every threshold in the constant `GATE`) says whether sending may happen at all: bounces over 5 % or blocked emails over 1 % of the last seven days, a Postmaster Tools spam rate over 0.3 % or older than 14 days, no seed test within 14 days, SPF, DKIM and DMARC not confirmed, a limit of 0 for every sender, a send loop silent for more than 10 minutes. The send round asks it first, on every call, and answers 409 with every reason, so calling the route directly cannot get round it; the Control tab shows the same answer. Three of its inputs no machine can read, so the operator enters them with a date (`caches`, key `outreach:settings`): the Postmaster spam rate, the seed result, and that the replies were read. A reading that is too old shuts the gate; that is uncomfortable on purpose. The gate judges the loop by the heartbeat from before the round, so after a long silence the first round is refused and the second one sends.
- **A sender that fell silent comes back one tier lower.** More than three days without an email, and on the day it sends again `warmupStatus` puts it one tier down for that whole day; the Control tab says so with the number of days.
- **The report counts what SMTP can show and names what it cannot** (`lib/outreachReport.mjs`, from `outreachsends` only). Accepted by our server is not delivered; "assumed delivered" is accepted minus what came back, and is labelled an estimate. A share is shown only from 30 emails; below that the count stands alone. Bounced and blocked sit next to their limits (2 % and 1 %). Inbox against spam folder can only be seen by a seed test, sent to mailboxes of one's own and read by hand; a complaint cannot be seen at all, and the Postmaster figure stands in for it. Seed emails are marked `isSeed` and stay out of every rate. The reply rate is a floor: a call back is not in it.
- **One send round at a time.** Beside the claim on the lead and the lock on the sender, the round takes a lock on the heartbeat document in one atomic update, freed when the round ends and after 90 seconds if it died.
- **Who gets written to, at which address and with which offer is settled at enrolment, never during a send.** The send round has no time for DNS or for a website, so everything slow happens before. `bestEmail` (`lib/emailQuality.mjs`) picks one address per lead: a person at the business's own domain before `info@`, before a mailbox-provider address; never `noreply@` and its kind, never a placeholder, and never another company's domain found on the business's website, which is usually the agency that built it. `lib/mxCheck.ts` asks once per domain whether it takes mail at all; a domain without an MX record is a certain bounce. `routeOffer` (`lib/routeOffer.mjs`) decides whether the second round offers AI automation or social media, from the category, the reviews and the signals read from the website, and stores the decision with its reasons in `seq`; a close call goes to social and says so, and a choice the operator makes by hand is never recomputed. It is a separate function from the opportunity score, which it does not touch. A lead whose time zone is not known is not enrolled.
- **Website signals are three short values, read by a guarded fetch.** `POST /api/outreach/signals` reads the websites of leads that have an email, a chunk per call, and stores in `sig` only the name of a booking engine, of an ordering service and an Instagram handle, never the page. The URL comes from scraped data, so every hop is checked (`lib/netGuard.mjs`, `lib/siteFetch.ts`): http or https, a host name that resolves to public addresses only, redirects followed by hand and checked again, the first 400 KB only.
- **Everything that comes back comes back as mail, and is stored before it is acted on.** There is no webhook: outreach goes out over SMTP, so a reply, a bounce and an out-of-office note all land in the sender's mailbox. `POST /api/outreach/inbox` reads one mailbox per call (`lib/inboxWatcher.ts`), writes each message into `outreachinbox` under a unique key (sender, UIDVALIDITY, UID), and only then applies it; a message stored but not handled is handled on the next round, a handled one is never applied twice. There is no "delivered" either: an email our server took and that did not come back is assumed to have arrived. A complaint (marked as spam) cannot be seen at all over SMTP; the only stand-in is the spam rate of Google Postmaster Tools, read by hand.
- **Incoming mail must prove where it is from before it changes anything.** Anyone can send a mail to a sender mailbox with any From line and any text. A mail that looks like a bounce and names a lead's address, or says "blocked", would otherwise suppress that lead or shut the campaign through the gate. So `mailAuth` (`lib/inboxClassify.mjs`) reads Gmail's own verdict, the first `Authentication-Results` header, which a sender cannot put above Gmail's. A bounce has an effect only when it is proven to come from Google's mail system, which is the one that reports the failures of mail sent through Gmail; any other is stored, shown and logged with no effect. A stop request from an address that matches no lead suppresses it only when the mail is proven to come from that address. A reply matched by its subject alone ends the sequence, which is harmless if wrong, but never puts the lead's own address on the list. The suppression list can be lifted by the operator only, on the Replies tab.
- **A bounce is one of three things, and they get three answers** (`lib/bounceRules.mjs`). Hard (5.x.x): the address is dead, it is suppressed and the sequence stops. Soft (4.x.x): counted on the lead, the next step waits a day, the third one counts as hard. Block (5.7.1, or the receiving server's words: blocked, spam, reputation, blacklist): the address is fine and WE were refused, so it is never suppressed and is counted apart as `blocked`, because the cure is less volume, not a cleaner list. A bounce is matched by the address in its delivery report to the last email sent there. A bounce that cannot be read or matched is logged for the operator, never dropped.
- **A reply stops the sequence for good, and only what the person wrote is read.** A reply is matched by its sender's address to the last email sent there, or else by its subject to the thread (the owner who answers from another address than the `info@` we wrote to). Every reply carries our own email quoted under it, footer included, so `stripQuoted` cuts the quote before `isStopRequest` looks for a stop word: otherwise every reply would read as "STOP". A stop request sets the status and writes the suppression together; an out-of-office note is not a reply and only delays the next step by three days. Replies are not sorted into good and bad by a machine. The lead panel keeps a manual "Mark as replied" for what no mailbox shows (a phone call).
- **The suppression list is asked at four points, and no answer means no send.** At enrolment, one query for the whole chunk; in the send round, right before the email, because the queue was built hours earlier; in the mailbox watcher, where a final bounce or a stop request also stops every other running lead at that address at once; and in the manual send of the lead panel. `isSuppressed()` throws when the database cannot answer, and none of the four turns that into "not suppressed".
- **Every email ends with one footer, attached in code** (`lib/outreachFooter.mjs`): the operator's name, a real postal address, and how to stop, in the lead's language (`seq.language`). It is not part of a sequence's wording or of a generated draft, so it cannot be forgotten, and the preflight refuses an email that does not end with it. The name and address are one constant, `FOOTER_IDENTITY`; while it is empty no sequence email can leave.
- **One email goes out in a fixed order, and a doubt is never settled by sending again.** SMTP has no idempotency key, and the round is an HTTP route a tab calls around the clock: it can start twice, and it can die on any line. The order (`lib/sendGuard.mjs`, `lib/dispatcher.ts`): claim the lead in one atomic update that only one round can win (`seq.claimedAt`; a claim older than 10 minutes is a dead round's) → write an `outreachsends` row with outcome `sending` → hand the email to the mail server → the row becomes `sent`, the lead moves on. Two more lines of defence: a step whose id, or a variant's, is in `seq.sentStepIds` is never claimed, and a row that says the step went out or may have blocks it too. A `sending` row older than 10 minutes becomes `unknown` and its lead goes on `hold`: the email may have gone out, so only the operator settles it ("it was sent" or "send it again"). A send the server refused before taking the message is `failed` and tried again; the third failure in a row takes the lead out as `failed`. A broken connection during the hand-over counts as unknown, not as refused: the mail library reports a connection that closed while the answer to the message body was awaited with the same code as one that never opened. A send round also takes a short lock per sender account (`roundAt`), so two overlapping rounds cannot both find the limit open and the pause over.
- **A round sends three emails at most, one per sender, and always answers with a sentence.** `POST /api/outreach/tick` writes the heartbeat first, on every call, so an idle night does not look like a dead loop. Then: sweep the stale sends, the gate, and per sender its limit of the day, its pause since the last email (the limit spread over its sending hours), the due leads of the zones where it is a sending hour (through `gl_seq_due`, with a projection), the claim, rendering, the footer, the preflight, the send. A lead whose text cannot be rendered for it is moved on to its next step, not stopped. Emails are plain text, no `html` part, no tracking. The mail server's own error text never reaches the client or the activity log, only its code reaches the server log. A shut gate answers 409 with the reasons.
- **The send window runs on the recipient's clock, from a zone found once.** A sender's days and hours (`sendDays`, `windowFrom`, `windowTo`; Monday to Friday, 7 to 19 unless set) are read in the lead's own time zone, never the sender's or the server's: 7:00 on the east coast is 4:00 in California, and an email in the small hours is the plainest sign of automation. `timezoneFromCoords` (`lib/timezoneFromCoords.mjs`, behind `zoneOf`) finds the zone from the lead's `lat` and `lng` with rough boxes and border lines for the countries the leads come from, or from a country that keeps one clock, or from the country the address ends in. When none of them says, the lead has no zone: it is not enrolled and never inside a window, rather than sent to on somebody else's clock. It is an approximation on purpose: an exact lookup is a library of polygons loaded into every cold start, and a wrong hour next to a zone border disappears in a 12 hour window. Arizona and Saskatchewan, which do not change their clocks, have zones of their own. The zone is stored as `seq.tz` when the lead is enrolled, so the dispatcher never computes it.
- **A step can have several wordings, and a lead always gets the same one.** A variant is a step with `variantOf`; `pickVariant` in `lib/outreachVariant.mjs` chooses between a step and its switched-on variants by their weights, from the lead's `dedupKey` alone, so a rerun cannot mix up a measurement. The id of the wording that went out is what `sentStepIds` and `outreachsends.stepId` hold; the lead then moves on from the step the wording belongs to. Fewer than 100 sends of a wording is shown as too little data; there is no statistical test.
- **A sequence is never saved before the editor has shown what the save does.** Sequences are edited while leads are in the middle of them. `POST /api/outreach/sequences/[id]/check` compares the stored sequence with the edit against the leads active in it (`lib/sequenceImpact.mjs`, pure) and answers one line per change with numbers: new wording, a new step, a step switched off or on, a changed wait, a deleted step, a changed order. Two rules behind those lines: a lead that got a step never gets it again, and a due date that is already set is not moved by a save, because rewriting it would turn a small correction into a mass send. The `{{variables}}` a text may use are one catalogue, `lib/outreachRender.mjs`, shared by the editor, the preview and the send, and every one is a real field of the lead or a part of its address; a name outside it is a typo, and the preflight (`lib/outreachPreflight.mjs`) keeps a text with a gap from being sent.
- **A lead's sequence state is written in one place, `lib/outreachState.ts`.** `advanceSequence` and `stopSequence` are the only code that moves `seq`; what the next state is comes from the pure `planAdvance` and `statusForStop` in `lib/outreachSequence.mjs`. The dispatcher and the dashboard both go through them, so "what is next, and when" is not written twice. `advanceSequence` writes only while the lead is still active and still on the step the caller read, so an overlapping round cannot advance a step twice. `sentStepIds` holds the step that really went out, which may be a variant. Deleting a sequence first stops every lead active in it, then removes it. Active leads are counted by reading the active set through `gl_seq_due`, never with a `$group` over `leads`.
- **One running sequence per company domain, and senders share leads by their limits.** `dedupKey` is unique per place, not per company, so one company can be several leads at one email domain; a sequence to each is spam to the people who get it. Enrolment and the dispatcher keep one active sequence per domain (`pickOnePerDomain`, `domainHeldByAnother` in `lib/dispatchPlan.mjs`); addresses at mailbox providers never block each other, by the same provider list as the suppression rules. `activeCompanyDomains()` reads the active set through `gl_seq_due` with a hint, so it fails rather than scan every lead. A lead gets its sender once, at enrolment, by weighted rendezvous hashing of its `dedupKey` (`assignSenders`): the shares follow each sender's limit of the day, a rerun gives the same answer, and a new sender takes only its own share. "Sent today" is counted from `outreachsends` on every call; a serverless instance has no memory to keep a counter in.
- **The daily limit of a sender is data on the account, computed by `lib/warmup.mjs`.** Tiers (`{ fromDay, dailyLimit }`, stored sorted) are counted in calendar days from the account's own first successful send (`firstSendAt`), the last tier holds for good, and the account's `dailyLimit` is a ceiling no tier lifts. A lower tier after a higher one is allowed: stepping back is how the pace is taken down after a complaint, without a deploy. The day turns at midnight in `Europe/Budapest` for the limit and for the "sent today" count alike, never at the server's local midnight. The dashboard shows the limit with the same functions the dispatcher uses.
- **The suppression list is a collection (`suppressions`), not a field on the lead.** Someone who asked not to be written to must stay out of every later sequence, and a lead can be deleted and scraped again. A row is one address, or a whole company domain stored as `@domain`; a domain block is refused for mailbox providers such as gmail.com (the list is in `lib/suppressionRules.mjs`). `isSuppressed()` throws when the database cannot answer and the caller must let that stop the send. No code deletes a row except `unsuppress()`, which only an action taken by the operator may call.
- **Outreach sequence state lives on the lead, in `seq`**, not in a collection of its own: the dispatcher asks "what is due for this sender now" and answers it from the partial index `gl_seq_due`, which holds only the leads with `seq.status: 'active'`. A query must name that status to use the index. `seq` has no schema defaults, so a lead that was never enrolled stores nothing, and it is written by the server only: `POST /api/sync` and `POST /api/leads` drop an incoming `seq`, because an old export would otherwise bring back a past state and steps already sent would go out again. Dates in it are ISO strings in UTC, so they compare as text.
- **The outreach loop is a browser tab, not a service.** `/outreach/runner` stays open around the clock on the operator's Kamatera Windows machine and calls `POST /api/outreach/tick` every 30 to 60 seconds. The tab only schedules (a `setTimeout` chain, a wait that grows after errors, one tab at a time through a `localStorage` lock, rules in `lib/outreachRunner.mjs`); the route decides on every call whether anything is sent. Each call stores a heartbeat in `caches` under `outreach:runner`, and `GET /api/outreach/tick` reports it stale after 10 minutes, because a dead tab gives no error, only silence. Nothing is installed on that machine and no cron calls the route.
- **The activity log uses the native driver and is never pruned.**
- **Reviews are marked as scraped even when scraping failed**, so one bad listing does not block the queue.
- **Sync uploads are gzipped by hand** to stay inside the Vercel transfer quota.
- **The extension re-fetches the Maps RPC response instead of reading the DOM**, and serializes storage writes through a promise-chain mutex.
- **The main extension requests `https://*/*` and `http://*/*`** because the email finder fetches arbitrary business websites from the service worker.
- **`apps/web/app/globals.css` has two `:root` blocks.** The first is the extension's dark palette, kept verbatim; the second, appended last, is the effective light theme.
- **Single MongoDB database.** Two-database sharding was reverted after an Atlas upgrade. The URI must include the `/myapp` path.
- **tokenleads:** the rate limiter is in memory; Edge middleware lets `Authorization: Bearer tl_...` through and the route verifies it; cron routes answer 503 in production when `CRON_SECRET` is unset and are open only in local development; missing provider keys fall back to mock behaviour in development.

## 07 Scalability and future considerations

- Scale today: one operator, more than 1.2 million leads in one collection on a shared Atlas tier.
- Known limits: 60 second functions, 4.5 MB responses, 100 MB aggregation memory, no job queue, rate limiting in `apps/web` only on login and only in memory, the activity log grows without bound.
- Lead indexes: every index the dashboard needs is declared in `apps/web/lib/models.ts` under its production name. That includes `gl_opp_sort` (the default page), `gl_project_opp` (project and folder pages), `checked_1` (the checked count on every load), `name_1` and `salesStatus_1` (column sorts), `gl_email_opp` (partial: leads with an email) and `gl_todo_opp` (the email filters), `searchTokens_1` (search), `cid_1` (duplicates), `gl_seq_due` (partial: leads in an active outreach sequence, by sender and due time); on `reviews`, `scrapedAt_-1__id_-1` (the Reviews view) and two of the tokenleads indexes, `tl_leadscore_sort` and `tl_category_score`, because the lead table sorts through them. A new index on 1.6 million leads is built in the background the first time a deployed function uses the model: add it outside busy hours.
- Timing: `GET /api/leads` and `GET /api/projects` send a `Server-Timing` header (`connect`, `db`, `total`); docs/PERFORMANCE_PLAN.md has the snippet that reads it.
- Not planned: multi-tenant GridLeads, a separate API server, a job queue. Do not add abstractions for these.

## 08 When the agent must stop and ask

Stop, name the conflict, and propose the smallest change that avoids it when a task needs any of:
- Crossing a boundary in §05 or changing a decision in §06.
- A new collection, a new or renamed model field, or a new index.
- A new dependency, environment variable or third-party service.
- A change to login, cookies, `OPEN_API`, CORS, or tokenleads token spending and Stripe code.
- A change to the sync bundle format or to `dedupKey`: both extensions and the server must change together.
- Deleting or bulk-updating lead data.

## 09 Environments and configuration

| Environment | URL | Deployed from | Data |
| --- | --- | --- | --- |
| Local web | http://localhost:3000 | `npm --prefix apps/web run dev` | the production Atlas database (there is no separate dev database) |
| Local tokenleads | http://localhost:3010 | `npm --prefix apps/tokenleads run dev` | `leadtokens` plus read-only `myapp` |
| Local landing | http://localhost:3020 | `npm --prefix apps/landing run dev` | read-only `myapp` |
| Production web | https://gridleads-wheat.vercel.app | Vercel CLI in `apps/web`, project `gridleads`, functions in `fra1` | production (Atlas, Frankfurt) |
| Production landing | https://extension-eight-iota.vercel.app | Vercel project `extension` | read-only `myapp` |
| Production tokenleads | not deployed | — | — |

Local development writes to production data. Treat every write, recalculation and delete as live.

Environment variables (names only; values live in Vercel and in untracked `.env` files):

| App | Names |
| --- | --- |
| web | `MONGODB_URI`, `EMAIL`, `PASSWORD`, `AUTH_SECRET`, `OPENAI`, `LEAD_SEARCH_MODEL`, `RESEND_API_KEY`, `OUTREACH_FROM`, `OUTREACH_SECRET_KEY`, `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `CLAUDE_BIN`, `CLAUDE_MODEL`, `ENRICH_ALLOW` |
| tokenleads | `MONGODB_URI`, `AUTH_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| landing | `MONGODB_URI`, `NEXT_PUBLIC_CRM_URL` |

All are server-only except `NEXT_PUBLIC_CRM_URL`.

## Target (not yet true)

- Input validation with a schema library at every route.
- A uniform response shape in every handler.
- Rate limiting on the open routes.
- A separate development database.
