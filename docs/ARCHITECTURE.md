# Architecture: GridLeads

This file describes the code as it is. Goals that are not true yet are listed once, under "Target (not yet true)" at the end.

## 01 System overview

```
Chrome: apps/extension            Chrome: apps/extension-reviews
(Maps search scraper)             (review scraper)
    |  POST /api/sync                 |  GET /api/reviews/next
    |  GET  /api/missing-states       |  POST /api/reviews
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
| AI | OpenAI over raw `fetch` (web); `@anthropic-ai/sdk` (tokenleads); local `claude -p` CLI (web enrich) | — |
| Calls | Vapi over raw `fetch` | — |
| Hosting | Vercel, deployed with the CLI from the app folder | No Git integration; see AGENTS.md §09 |
| Extensions | Manifest V3, plain JavaScript, no build step | Loaded unpacked; libraries attach to `self` through IIFEs |
| Testing | `node:test` for `apps/web/lib/organize.test.mjs`; Vitest in tokenleads | No end-to-end tests |

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
                           store.ts (zustand), scoring.ts, activity.ts, projectStats.ts,
                           generated data files (states.ts, countries.ts, ...)
      middleware.ts        login gate and the list of open API paths
    extension/             Maps scraper: background/, content/, popup/, dashboard/,
                           audit/, changelog/, lib/
    extension-reviews/     review scraper: background/, content/, popup/
    landing/               marketing page, one route: GET /api/stats
    tokenleads/            separate product; has lib/ helpers, tests/, vercel.json crons
  packages/scoring/        TypeScript scoring library. Nothing imports it.
  prisma/, countries/, state_json/, states_table/, LeadsMap_Crx/
                           legacy or reference material. Not used by any app.
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

Response shape: mostly `{ ok: true, ... }` or `{ ok: false, error }` with 400, 404, 500 or 502. Exceptions that clients depend on: `GET /api/folders` returns a bare array, `GET /api/leads` returns `{ rows, total }`, `GET /api/missing-states` returns `{ error }` on failure.

State:
- Server state lives in MongoDB. Dates are stored as ISO strings.
- `lib/store.ts` (`useGrid`) holds only `folders`, `summaries` and `hydrated`. Its mutations are optimistic: state is set first, the request follows, and failures are swallowed.
- Leads and every other view are fetched into component state.
- `localStorage` holds layout only: `gridleads_sw`, `gridleads_pw`, `gridleads_collapsed`.

Long jobs: Vercel functions are limited to 60 seconds (120 or 300 on sync-like routes), so `projects/refresh`, `categories/summary` and `recalc` process one chunk per request and the client loops until done.

Extension data: `chrome.storage.local` keys `gridleads_projects`, `gridleads_folders`, `gridleads_batch*`; IndexedDB `gridleads_log` for the event log. Sync sends bundles of 500 leads, gzipped, with header `x-gl-gzip: 1`.

Errors: most handlers wrap in `try/catch` and return `e.message`. Several have no `try/catch` at all (`duplicates`, `folders`, `export`, `timezone-focus`, `reviews/businesses`, `reviews/list`, and the write methods of `leads`).

## 05 Boundaries

Allowed:
- Components import from `lib/api.ts`, `lib/store.ts`, `lib/types.ts` and pure helpers.
- Route handlers import `lib/db.ts`, `lib/models.ts` and the server helpers.

Never:
- A component or `lib/api.ts` imports `lib/db.ts`, `lib/models.ts`, `lib/auth.ts` or anything that reads `process.env` secrets.
- A third-party call with a secret from the browser. Keys are read in route handlers only. No `NEXT_PUBLIC_*` secret; the only public variable in the repo is `NEXT_PUBLIC_CRM_URL` in landing.
- `apps/tokenleads` or `apps/landing` writing to the `myapp` database. They read it; only `apps/web` writes.
- Extension code depending on a bundler, npm package or remote script.
- Code in one app importing from another app's folder. Shared logic is duplicated today (scoring in three places); change all copies together.

## 06 Decisions that look wrong but are intentional

The agent must not "fix" these.

- **Scraper endpoints are open.** `/api/sync`, `/api/reviews`, `/api/reviews/next`, `/api/missing-states` need no login, so the extensions work without a session. `OPEN_API` in `apps/web/middleware.ts` matches exact paths only, so sub-routes stay protected.
- **`/api/audit` is not open** although the extension calls it: it reads lead data and writes emails, so it requires the `gl_auth` cookie.
- **`/api/enrich` is open in middleware but guarded in the route** by a localhost Host check (`ENRICH_ALLOW=1` overrides). It spawns the local Claude CLI and is meant to run on the operator's machine only.
- **CORS `*` on every `json()` response** so the extensions can call the API from any origin.
- **Leads are a separate collection keyed by the project's query string**, not embedded and not referenced by ObjectId. A project document would pass 16 MB.
- **A business lives in exactly one project.** On sync the first project to hold a `dedupKey` wins.
- **Empty contact fields never overwrite stored values on sync.** Empty means unknown, not erased. The extension mirrors this rule.
- **`ProjectStat` holds precomputed counters.** A `$group` over more than a million leads is too slow and hits the Atlas memory limit.
- **The `/api/projects` payload is cached in MongoDB, gzipped, with an ETag** rather than in memory: Vercel spreads requests across cold instances, and the response must stay under 4.5 MB.
- **Long jobs are driven by the client in chunks** (see §04) instead of a queue.
- **The activity log uses the native driver and is never pruned.**
- **Reviews are marked as scraped even when scraping failed**, so one bad listing does not block the queue.
- **Sync uploads are gzipped by hand** to stay inside the Vercel transfer quota.
- **The extension re-fetches the Maps RPC response instead of reading the DOM**, and serializes storage writes through a promise-chain mutex.
- **The main extension requests `https://*/*` and `http://*/*`** because the email finder fetches arbitrary business websites from the service worker.
- **`apps/web/app/globals.css` has two `:root` blocks.** The first is the extension's dark palette, kept verbatim; the second, appended last, is the effective light theme.
- **Single MongoDB database.** Two-database sharding was reverted after an Atlas upgrade. The URI must include the `/myapp` path.
- **tokenleads:** the rate limiter is in memory; Edge middleware lets `Authorization: Bearer tl_...` through and the route verifies it; cron routes are open when `CRON_SECRET` is unset; missing provider keys fall back to mock behaviour in development.

## 07 Scalability and future considerations

- Scale today: one operator, more than 1.2 million leads in one collection on a shared Atlas tier.
- Known limits: 60 second functions, 4.5 MB responses, 100 MB aggregation memory, no job queue, no rate limiting in `apps/web`, the activity log grows without bound.
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
| Production web | https://gridleads-wheat.vercel.app | Vercel CLI in `apps/web`, project `gridleads` | production |

Local development writes to production data. Treat every write, recalculation and delete as live.

Environment variables (names only; values live in Vercel and in untracked `.env` files):

| App | Names |
| --- | --- |
| web | `MONGODB_URI`, `EMAIL`, `PASSWORD`, `AUTH_SECRET`, `OPENAI`, `LEAD_SEARCH_MODEL`, `RESEND_API_KEY`, `OUTREACH_FROM`, `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `CLAUDE_BIN`, `CLAUDE_MODEL`, `ENRICH_ALLOW` |
| tokenleads | `MONGODB_URI`, `AUTH_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| landing | `MONGODB_URI`, `NEXT_PUBLIC_CRM_URL` |

All are server-only except `NEXT_PUBLIC_CRM_URL`.

## Target (not yet true)

- Input validation with a schema library at every route.
- A uniform response shape and `try/catch` in every handler.
- Rate limiting on the open routes and on login.
- One scoring implementation shared by web and the extension.
- A separate development database.
