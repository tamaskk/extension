# 03 — Database Schema

Full Prisma schema: [prisma/schema.prisma](../prisma/schema.prisma). This doc explains the model, the indexing strategy, tenancy/RLS, search, and the scale plan.

## 1. ERD (logical)

```
Organization 1───* Membership *───1 User
     │
     ├──* Campaign 1──* Business 1──* Contact
     │                    │ 1──* Note
     │                    │ 1──* Task
     │                    │ 1──* Activity
     │                    └ *──* Tag (BusinessTag)
     ├──* ScrapeJob
     ├──* Export
     ├──* Sequence 1──* SequenceStep
     │        └──* Enrollment 1──* EmailEvent
     ├──* ApiKey / Webhook / AuditLog / UsageCounter
```

## 2. Tenancy & isolation

- **Tenant boundary = `Organization`.** Every business table carries `organizationId`.
- **Defense in depth:**
  1. **App layer** — a NestJS `TenantInterceptor` resolves the active org from the verified token + membership and injects it; a Prisma extension auto-injects `where: { organizationId }` and rejects writes without it.
  2. **DB layer** — Postgres **Row-Level Security** policies on every tenant table: `USING (organization_id = current_setting('app.org_id'))`. The connection sets `app.org_id` per request/transaction. Even a query bug cannot cross tenants.

## 3. Indexing strategy (the part that makes 100k+ leads fast)

The primary view is *"businesses in a campaign, filtered + sorted, cursor-paginated."* Key indexes (see schema):

| Index | Serves |
|-------|--------|
| `(organizationId, campaignId, createdAt)` | default table list + newest/oldest sort + keyset cursor |
| `(organizationId, websiteStatus)` | "No website / Facebook only / Broken" filters |
| `(organizationId, leadTemperature)` | Hot/Warm/Cold filter |
| `(organizationId, opportunityScore)` | sort/filter by Opportunity Score |
| `(organizationId, pipelineStage)` | kanban / pipeline counts |
| `(organizationId, city/category/rating/reviewCount)` | facet filters & sorts |
| `@@unique(organizationId, placeId)` / `(…, googleCid)` | dedup on ingest |

**Rules:**
- **Keyset pagination only.** Cursor = `(createdAt, id)`; never `OFFSET` (it degrades linearly).
- **Composite filter+sort:** combine the active filter column with `createdAt` so Postgres can both filter and order from one index. For arbitrary multi-filter combos, fall back to a bitmap-AND across single-column indexes; monitor `pg_stat_statements` and add covering indexes for the top real-world combos.
- **Partial indexes** for cheap hot facets, e.g. `CREATE INDEX ... ON "Business"(organizationId, createdAt) WHERE "websiteStatus" IN ('NO_WEBSITE','FACEBOOK_ONLY',...)`.

## 4. Full-text & fuzzy search

- Add a generated `tsvector` column on `Business` over `name`, `category`, `city`, `addressLine`, maintained by a trigger; GIN index it.
- `pg_trgm` GIN index on `name` for typo-tolerant "search businesses" (`ILIKE '%term%'` / similarity).
- Cross-entity search (businesses, contacts, campaigns, emails, domains, phones, tags) is a `UNION ALL` over per-entity ranked queries, capped + cursor-paginated. Graduate hot tenants to OpenSearch (see [11](11-roadmap.md)).

Example migration snippet:

```sql
ALTER TABLE "Business" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(category,'') || ' ' ||
      coalesce(city,'') || ' ' || coalesce("addressLine",''))
  ) STORED;
CREATE INDEX business_search_idx ON "Business" USING GIN (search_vector);
CREATE INDEX business_name_trgm ON "Business" USING GIN (name gin_trgm_ops);
```

## 5. JSON columns (deliberate)

`hours`, `attributes`, `photos`, `scoreBreakdown`, `opportunitySignals`, `customFields`, `whois`, `techStack` are JSON/array. They are display/audit payloads, not query predicates — keeping them schemaless avoids migration churn as Google's Maps DOM and provider responses evolve. Anything we filter on is promoted to a typed column (e.g. `opportunityScore`).

## 6. Scale plan for `Business` (the big table)

- **Phase 1 (≤ ~50M rows):** single table, the indexes above, read replica for analytics.
- **Phase 2:** declarative **partitioning by `hash(organizationId)`** (e.g. 32 partitions). Keeps each tenant's working set local and indexes smaller; enables cheap per-tenant purge for GDPR.
- **Phase 3:** move cold leads (untouched > N months, `LOST`/archived) to a `business_archive` partition; analytics roll-ups precomputed into summary tables refreshed by a worker (the `Campaign.totalLeads/qualifiedLeads` denorm pattern, extended).

## 7. Migrations

- Managed by Prisma Migrate; every migration reviewed for lock impact (`CREATE INDEX CONCURRENTLY` via raw SQL migrations for hot tables).
- Seed (`prisma/seed.ts`) creates a demo org, the example campaigns (NYC Restaurants, Dentists Miami, …), and a spread of businesses across every `WebsiteStatus`/temperature for UI development.
