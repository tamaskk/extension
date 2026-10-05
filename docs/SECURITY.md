# Security: GridLeads

Read before changing auth, data handling, the open API routes, secrets or deletion. Where this file is stricter than AGENTS.md §05, this file wins.

## 01 What we protect

| Data | Examples | Sensitivity | Where stored | Retention |
| --- | --- | --- | --- | --- |
| Leads | business name, phone, emails, address, notes, outreach drafts, sales status | business contact data, some personal | `leads` collection, db `myapp` | until the operator deletes the lead |
| Reviews | reviewer display name, Google profile link, review text | personal data | `reviews` collection | until deleted |
| Activity log | field diffs, copies of deleted leads, sent email body and recipient, called numbers | personal data | `activities` collection | never pruned |
| Call records | Vapi call id, time, end reason. Recordings and transcripts stay at Vapi and are fetched live | personal data at a third party | `leads.vapiCalls`; Vapi | Vapi's retention |
| Operator login | one email and password | secret | Vercel env `EMAIL`, `PASSWORD` | — |
| Extension data | the same lead records, unencrypted | business contact data | `chrome.storage.local`, IndexedDB | until synced in stream mode or cleared |
| tokenleads users | email, name, bcrypt hash, wallet ledger, API key hashes | personal and financial | db `leadtokens` | until account deletion |

Data leaves the system to OpenAI (lead facts), Vapi (phone, name, address), Resend (recipient, body), Nominatim (city names) and the local Claude CLI (lead facts, review texts).

## 02 Trust boundaries

- Browser to server: untrusted. Coerce and whitelist every field in the route handler.
- Extension to server: untrusted and unauthenticated on the open routes. Anyone who knows the URL can call them.
- Scraped content (Maps fields, review text, business websites): untrusted. Escape before it reaches HTML.
- Third-party API responses: untrusted input.
- tokenleads Stripe webhook: the signature is verified before the body is parsed.

## 03 Authentication and authorization

- web: one account. `POST /api/login` compares env `EMAIL` and `PASSWORD` with `timingSafeEqual` and sets `gl_auth`: HS256 JWT, 7 days, HttpOnly, SameSite=Lax, Secure in production.
- `apps/web/middleware.ts` protects every page and API path except `/login` and the exact paths in `OPEN_API`. Adding a path to `OPEN_API` needs approval.
- No roles. Any valid session can do everything.
- tokenleads: `requireSession`, `requireSessionOrKey`, `requireVerified`, `requireAdmin` in `lib/apiUtil.ts`. Every route calls one of them; ownership is checked in the route.

## 04 Secrets

- Stored in Vercel env (production) and untracked `.env` files (development). Never in git, never in `NEXT_PUBLIC_*`, never in logs or error responses.
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

- The JWT signing key in `apps/web/lib/auth.ts` falls back to `PASSWORD` and then to a string in the source when `AUTH_SECRET` is unset. tokenleads has the same source fallback. If production runs without `AUTH_SECRET`, sessions can be forged.
- `POST /api/sync` and `POST /api/reviews` write to the database with no authentication and no rate limit.
- `apps/web/app/login/page.tsx` redirects to the `next` query parameter without checking that it is a local path.
- tokenleads `/api/cron/*` is open when `CRON_SECRET` is unset.
- No rate limit on `POST /api/login`.
- No security headers or CSP in any app. Leaflet is loaded from unpkg without an `integrity` attribute.
- CORS `*` is sent on protected routes too. The cookie is SameSite=Lax and there is no CSRF token.
- `extension-reviews/content/bridge.js` posts messages with target origin `*`.

## 08 Incident basics

- Contact: the repository owner. A leaked secret: rotate first, then clean the history.
