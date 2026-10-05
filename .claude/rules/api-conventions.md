---
paths:
  - "apps/*/app/api/**"
  - "apps/*/middleware.ts"
  - "apps/web/lib/{api,auth,activity,projectStats,projectScope,projectGeo}.ts"
  - "apps/tokenleads/lib/**"
---

# API routes and server helpers

## apps/web
- One folder per endpoint: `app/api/<name>/route.ts`. Each file sets `export const runtime = 'nodejs'`, a `maxDuration`, and exports `OPTIONS` returning the shared `CORS` headers.
- Return through `json()` from `lib/models.ts`. Shape: `{ ok: true, ... }` or `{ ok: false, error }` with 400, 404, 500 or 502. Do not change the shape of an existing endpoint: `lib/api.ts`, both extensions and the audit page depend on it.
- Wrap the handler body in `try/catch`. Call `connectDB()` first.
- Input: coerce every field (`String()`, `Number()`, `Boolean()`), whitelist field names for updates and sort keys, and never pass `req.json()` or a query-param object into a Mongo query.
- A new endpoint is login-protected by default. Adding a path to `OPEN_API` in `middleware.ts` needs approval; it matches exact paths only.
- Writes that change per-project counts call the helpers in `lib/projectStats.ts`. Lead edits are recorded with `lib/activity.ts`.
- A job that may pass 60 seconds processes one chunk per request and lets the client loop (see `projects/refresh`).
- Every new endpoint gets a wrapper in `lib/api.ts`.
- Third-party calls (OpenAI, Vapi, Resend) are raw `fetch` in the route that needs them, with the key read from `process.env` there. No SDKs without asking.
- Do not return `e.message` from a provider error that may contain a key or a full URL with credentials.

## apps/tokenleads
- Start every route with one of `requireSession`, `requireSessionOrKey`, `requireVerified`, `requireAdmin` from `lib/apiUtil.ts`, and use `jsonError` and `rateLimited`.
- Token balance changes go only through `spend` and `credit` in `lib/tokens.ts`, with an idempotency key.
- Contact fields leave the server only through the masking in `lib/leads.ts`.
- The `myapp` database is read-only from here. Never write through `useDb('myapp')`.
- The Stripe webhook verifies the signature before parsing the body.

## apps/landing
- `GET /api/stats` is public and returns aggregate counts only. Never return lead rows from it.
