# Security: GridLeads

Read before changing auth, data handling, the open API routes, secrets or deletion. Where this file is stricter than AGENTS.md §05, this file wins.

## 01 What we protect

| Data | Examples | Sensitivity | Where stored | Retention |
| --- | --- | --- | --- | --- |
| Leads | business name, phone, emails, address, notes, outreach drafts, sales status | business contact data, some personal | `leads` collection, db `myapp` | until the operator deletes the lead |
| Reviews | reviewer display name, Google profile link, review text | personal data | `reviews` collection | until deleted |
| Activity log | field diffs, copies of deleted leads, sent email body and recipient, called numbers | personal data | `activities` collection | never pruned |
| Suppression list | email addresses and company domains that must not be written to, with the reason and the source | personal data | `suppressions` collection | kept for good, also after the lead is deleted; a row is removed only by the operator, by hand |
| Website signals | for leads with a website: the name of a booking engine and of an ordering service found on it, and the Instagram handle it links to | business data | `leads.sig` | until the lead is deleted |
| Outreach inbox | sender address, subject and the first 2,000 characters of every email that arrived in a sender mailbox (replies, bounces, out-of-office notes) | personal data | `outreachinbox` collection | never pruned |
| Outreach sends | recipient address, lead key, sender, send time, outcome; no email text | personal data | `outreachsends` collection | never pruned |
| Call records | Vapi call id, time, end reason. Recordings and transcripts stay at Vapi and are fetched live | personal data at a third party | `leads.vapiCalls`; Vapi | Vapi's retention |
| Sender accounts | mailbox address, login name, the Gmail app password sealed with AES-256-GCM | secret | `outreachsenders` collection (`authSecret`); the master key only in env `OUTREACH_SECRET_KEY` | until the operator replaces the password |
| Operator login | one email and password | secret | Vercel env `EMAIL`, `PASSWORD` | — |
| Extension data | the same lead records, unencrypted | business contact data | `chrome.storage.local`, IndexedDB | until synced in stream mode or cleared |
| tokenleads users | email, name, bcrypt hash, wallet ledger, API key hashes | personal and financial | db `leadtokens` | until account deletion |

Data leaves the system to OpenAI (lead facts), Vapi (phone, name, address), Resend (recipient, body), Nominatim (city names) and the local Claude CLI (lead facts, review texts).

## 02 Trust boundaries

- Browser to server: untrusted. Coerce and whitelist every field in the route handler.
- Extension to server: untrusted. The routes that write (`POST /api/sync`, `POST /api/reviews`, `POST /api/audit`) need the `gl_auth` cookie, which the extensions send from the operator's browser. The two read-only scraper routes (`GET /api/reviews/next`, `GET /api/missing-states`) are unauthenticated: anyone who knows the URL can call them.
- Scraped content (Maps fields, review text, business websites): untrusted. Escape before it reaches HTML.
- Third-party API responses: untrusted input.
- tokenleads Stripe webhook: the signature is verified before the body is parsed.

## 03 Authentication and authorization

- web: one account. `POST /api/login` compares env `EMAIL` and `PASSWORD` with `timingSafeEqual` and sets `gl_auth`: HS256 JWT, 7 days, HttpOnly, SameSite=Lax, Secure in production.
- Both apps sign the session JWT with `AUTH_SECRET` and have no fallback key: when it is unset, login returns an error and every existing cookie is rejected.
- After login the web app follows the `next` query parameter only when `localPath()` in `apps/web/lib/localPath.mjs` accepts it as a path on the same site; anything else goes to `/`.
- `apps/web/middleware.ts` protects every page and API path except `/login` and the exact paths in `OPEN_API`. Adding a path to `OPEN_API` needs approval.
- `POST /api/login` allows 10 attempts per client address in 15 minutes, then answers 429 (`apps/web/lib/rateLimit.mjs`). The counter is in memory per function instance, so it slows guessing; it is not an exact quota.
- web `POST /api/outreach/cron` is in `OPEN_API` (approved by the operator on 2026-10-06) so a scheduler can run the outreach loop without a session. The route lets in only `Authorization: Bearer <CRON_SECRET>`, compared in constant time; with the variable unset or shorter than 32 characters it answers 404 to everyone. It can start a send round and a mailbox read, nothing else, and has none of the tick route's test switches. The gate, the daily limits and the send window are inside the round, so the secret cannot be used to write to anyone new.
- tokenleads `/api/cron/*` needs `Authorization: Bearer <CRON_SECRET>`. With the variable unset the routes answer 503 in production and are open only in local development.
- No roles. Any valid session can do everything.
- tokenleads: `requireSession`, `requireSessionOrKey`, `requireVerified`, `requireAdmin` in `lib/apiUtil.ts`. Every route calls one of them; ownership is checked in the route.

## 04 Secrets

- Stored in Vercel env (production) and untracked `.env` files (development). Never in git, never in `NEXT_PUBLIC_*`, never in logs or error responses.
- One exception to env-only storage: the app passwords of the outreach sender accounts are in the database, sealed by `apps/web/lib/secretBox.mjs` under `OUTREACH_SECRET_KEY`. A database dump without that key does not open them. The password is never returned by an API, never logged and never written to the activity log; anyone logged in to the dashboard can still use it through the connection test and the sends, but cannot read it. That last part holds only because an account may point at Gmail's own servers and nowhere else (`ALLOWED_MAIL`): do not loosen that list without replacing the protection. The sealed value is not tied to its account, so someone who can write to the database can copy it between accounts; it still only ever travels to Google. Losing or changing the key means typing every app password in again.
- Agents do not read `.env*` files other than `.env.example`.
- Rotation: the operator, in the provider dashboard and then in Vercel. A leaked secret: rotate first, then clean the history.

## 05 Input, output, injection

- MongoDB: never pass a request body or query-param object into a query. Coerce with `String()` or `Number()` and whitelist field names, as `apps/web/app/api/leads/route.ts` does. Reject values that are objects where a scalar is expected.
- React: no `dangerouslySetInnerHTML` in web. tokenleads uses it once, on the admin page, for stored email HTML.
- HTML strings (Leaflet popups in `MapModal.tsx`, every `innerHTML` in the extensions): pass each field through the local `esc()` and allow only `^https?://` URLs in `href`.
- Uploads: none. Imports are JSON bundles parsed on the server.
- Rate limits: none in web and landing. tokenleads limits auth, search, unlock, export, AI and purchase routes in memory.

## 06 Dependencies

- New dependency: ask first. The extensions take no dependencies at all.

## 07 Known gaps

These are open. Do not assume they are handled. Tracked in docs/TASKS.md.

- `GET /api/reviews/next` and `GET /api/missing-states` return lead and project data with no authentication and no rate limit.
- The login rate limit is per function instance and keyed by client address; there is no lockout that survives a cold start.
- No security headers or CSP in any app. Leaflet is loaded from unpkg without an `integrity` attribute.
- CORS `*` is sent on protected routes too. The cookie is SameSite=Lax and there is no CSRF token.
- `extension-reviews/content/bridge.js` posts messages with target origin `*`.
- The matcher of `apps/web/middleware.ts` leaves out every path that contains `.png`, `.ico`, `.gif` and the like anywhere in it, so `/api/outreach/sequences/x.png` reaches its handler with no session. The outreach routes that change anything check the session themselves (`lib/session.ts`); other routes do not. The pattern should end with `$`.
- `next` 16.2.9 is listed under GHSA-6gpp-xcg3-4w24 (middleware bypass with Turbopack). Whether this app meets its conditions was not confirmed. The middleware is the only login gate of every route outside outreach.
- `POST /api/sync` and `POST /api/leads` take whatever top-level fields a bundle carries. They drop `seq`, `sig`, dotted keys and operators, but there is no whitelist of lead fields.

## 08 Incident basics

- Contact: the repository owner. A leaked secret: rotate first, then clean the history.
