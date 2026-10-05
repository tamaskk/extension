---
paths:
  - "apps/*/lib/models.ts"
  - "apps/*/lib/db.ts"
  - "apps/web/lib/{activity,projectStats,seed}.ts"
  - "apps/web/app/api/{sync,leads,projects,recalc,organize,export,duplicates}/**"
---

# Database (MongoDB Atlas + Mongoose 9)

- One database for GridLeads: `myapp`. The URI must contain the `/myapp` path. tokenleads owns `leadtokens` and reads `myapp` read-only; landing reads `myapp` read-only.
- Local development uses the production database. Do not run seeds, recalculations, bulk updates or deletes unless the task says so, and say so before you do.
- Schema changes (new collection, new, renamed or removed field, index change) need approval: docs/ARCHITECTURE.md §08. Update the model table in ARCHITECTURE.md and the mirror model in `apps/landing/lib/models.ts` when a `Lead` field it uses changes.
- One cached connection through `connectDB()` in `lib/db.ts`. Never call `mongoose.connect` anywhere else.
- Models live in `lib/models.ts` with `versionKey: false`. Dates are ISO strings, not `Date`.
- Leads are keyed by `{ project, dedupKey }` (unique). `project` is the query string, not an ObjectId. A business lives in one project only.
- On sync, an empty incoming contact field never overwrites a stored value.
- Never pass request objects into a query. Coerce scalars and whitelist field names.
- Reads: projection and `.lean()`; page lists on the server; no `$group` over the whole `leads` collection in a request, use `ProjectStat`.
- After a write that changes per-project counts, update `ProjectStat` and invalidate the cached `/api/projects` payload through `lib/projectStats.ts`.
- `activities` and `caches` use the native driver on purpose. The activity log is append-only.
