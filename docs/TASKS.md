# Tasks

Small tasks, at most a day each. Tick a box only when AGENTS.md §07 is met. IDs: T-###; feature refs: F# from docs/PRD.md §05; S = security, from docs/SECURITY.md §07.

## Now
- [ ] T-001 (S) Require `AUTH_SECRET` in production: remove the `PASSWORD` and source-string fallbacks in `apps/web/lib/auth.ts` and `apps/tokenleads/lib/auth.ts`, and confirm the variable is set in Vercel
- [ ] T-002 (S) Validate the `next` parameter in `apps/web/app/login/page.tsx` so it only accepts a local path
- [ ] T-003 (F3) Decide the correct "no real website" status list and make `apps/web/lib/models.ts`, `apps/landing/lib/models.ts`, both scoring files and the extension background agree

## Next
- [ ] T-004 (S) Protect `POST /api/sync` and `POST /api/reviews` with a shared secret header sent by the extensions, or a rate limit
- [ ] T-005 (S) Rate limit `POST /api/login`
- [ ] T-006 (S) Make tokenleads cron routes fail closed when `CRON_SECRET` is unset in production
- [ ] T-007 Replace the removed `next lint` script with a working ESLint setup, or delete the script
- [ ] T-008 Answer the open questions in docs/PRD.md §08

## Later
- [ ] T-009 (F3) One scoring implementation shared by web and the extension; decide the fate of `packages/scoring`
- [ ] T-010 Add `try/catch` to the route handlers listed in docs/ARCHITECTURE.md §04
- [ ] T-011 Remove or archive the unused root folders: `prisma/`, `countries/`, `state_json/`, `states_table/`

## Done
