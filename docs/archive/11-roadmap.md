# 11 — Roadmap: MVP → V2 → Scaling

## MVP (launch-ready, ~6–8 weeks with a small team)
Goal: a freelancer/agency can scrape Maps, see who has no website, and export Hot leads.

- Auth + orgs + memberships (Clerk), billing with Free/Starter/Pro (Stripe).
- Campaigns CRUD (+ duplicate/archive).
- **Chrome extension:** search-results scraping (fast mode), campaign selector, start/pause/resume/stop, progress, batch `/ingest`.
- **Website Status Detector + Lead Score + Website Opportunity Engine** (already implemented in `packages/scoring`).
- Main table: filter (No website, temperature, rating, city), sort, server-side cursor pagination, virtualization, bulk select.
- Contact enrichment v1 (website scrape + Hunter) with confidence score.
- Export: CSV + Excel + JSON.
- Basic analytics widgets. Dark/light mode.
- Security baseline: RBAC, RLS, rate limiting, audit log, validation.

**MVP cut lines:** deep per-card scraping, multi-provider waterfall beyond Hunter, outreach, pipeline board, Sheets/Webhook export, OpenSearch — all deferred.

## V2 (differentiation & retention)
- Full enrichment waterfall (Apollo/Clearbit/PDL/RocketReach) with budget guard + caching.
- **CRM:** pipeline kanban, notes/tasks/activity, owners, custom fields, saved filter views.
- **Outreach module:** sequences, templates, variables, open/click/reply tracking, unsubscribe management, scheduling.
- Deep scraping mode (detail-pane fields, photos, attributes, hours), background scraping hardening.
- Exports: Google Sheets + Webhooks; selectable fields; scheduled exports.
- Agency/Enterprise plans, seats, RBAC depth, API + webhooks public.
- Analytics: trends, geo heat map, revenue, conversion funnel.
- Revalidation sweeps (re-check websites/scores every 30–90 days).

## V3 / Scaling & moat
- OpenSearch for cross-entity search on large tenants; ClickHouse for analytics.
- Partition `Business` by org-hash; read replicas; archive cold leads.
- Server-side scraping option via official Places API; data marketplace.
- AI: auto-draft outreach from the opportunity pitch; lead-quality model; "best time to contact."
- Team collaboration (mentions, shared views), Zapier/Make integrations, white-label for agencies.

## Scaling strategy (technical)
| Dimension | Approach |
|-----------|----------|
| API/Worker | Stateless, autoscale on CPU + queue depth (ECS Fargate / K8s HPA) |
| Postgres | Read replicas → partition `Business` by `hash(orgId)` → archive tier |
| Search | Postgres tsvector/pg_trgm → OpenSearch for hot tenants |
| Queues | Per-queue concurrency + provider rate limiters; DLQ + retries/backoff |
| Cache | Redis for hot reads, facet counts, idempotency; CDN for assets |
| Cost | Enrichment caching by domain; stop-early waterfall; plan quotas |
| Multi-region | EU data-residency option (Enterprise); region-pinned RDS/S3 |
