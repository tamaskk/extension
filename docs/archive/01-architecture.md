# 01 — System Architecture

## 1. High-level

GridLeads is a multi-tenant SaaS with three runtime planes:

- **Edge/Web plane** — Next.js 15 dashboard, served via CloudFront in front of the app (Vercel or ECS+ALB). Talks to the API only.
- **API plane** — NestJS REST service. Stateless, horizontally scaled behind an ALB. Owns auth verification, RBAC, validation, rate limiting, and enqueues jobs.
- **Async plane** — BullMQ workers (Node) consuming Redis queues for the heavy work: scraping ingestion, website probing, enrichment, scoring, exports, and outreach sending.

```
                        ┌──────────────────────────────┐
        Chrome ░░░░░░░  │  Google Maps tab (content     │
        Extension  ░░░  │  script scrapes DOM)          │
        (MV3)      ░░░  └───────────────┬──────────────┘
            │ batched POST /ingest      │
            ▼                           │
   ┌─────────────────┐   HTTPS   ┌──────▼───────┐      ┌──────────────┐
   │  CloudFront/CDN │──────────▶│  Next.js 15  │─────▶│   NestJS API │
   └─────────────────┘           │  dashboard   │ REST │  (stateless) │
                                 └──────────────┘      └──────┬───────┘
                                                              │ enqueue
                              ┌──────────────┬────────────────┼───────────────┐
                              ▼              ▼                ▼               ▼
                        ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
                        │ Postgres │  │   Redis    │  │  BullMQ    │  │  S3 +      │
                        │ (Prisma) │  │ cache+queue│  │  workers   │  │ CloudFront │
                        └──────────┘  └────────────┘  └─────┬──────┘  └────────────┘
                                                            │ calls
                          Hunter · Apollo · Clearbit · PDL · RocketReach · PSI · WHOIS
```

## 2. Component responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| Next.js dashboard | UI, server components for first paint, route handlers proxy to API for auth cookies | No direct DB access |
| NestJS API | REST, OpenAPI, RBAC guards, Zod/class-validator DTOs, rate limiting, job enqueue, Stripe webhooks | Stateless; scale by CPU |
| Worker | Scrape ingest, website probe, enrichment, scoring, export render, email send | Separate queues + concurrencies |
| Postgres | System of record | RLS by `organizationId`; pg_trgm + tsvector search; partition `Business` by org-hash at scale |
| Redis | BullMQ queues, response cache, rate-limit counters, idempotency keys | Cluster mode in prod |
| S3 + CloudFront | Export files, business thumbnails, signed URLs | Lifecycle expiry on exports |
| Chrome Extension | Client-side Maps scraping (uses the operator's own session) | Sends batches to `/ingest` |

## 3. Why scraping lives in the extension

Server-side scraping of Google Maps is brittle and adversarial (bot detection, IP bans). Doing the DOM extraction inside the user's browser, on their own authenticated Maps session, is far more robust and keeps the server clean. The extension is a **thin collector**; all scoring/enrichment/storage happens server-side so logic is centralized and updatable without re-shipping the extension.

## 4. Data flow: from search to qualified lead

1. User opens Google Maps, runs a search, opens the GridLeads extension popup, picks a **Campaign**, hits **Start Scraping**.
2. Content script auto-scrolls the results panel, extracts each business card + detail pane, dedups by `placeId`, and streams **batches** to `POST /campaigns/:id/ingest`.
3. API validates, dedups (`@@unique(organizationId, placeId)`), inserts `Business` rows with `enrichmentStatus=NONE`, updates the `ScrapeJob` progress, returns saved/duplicate counts.
4. A **website-probe job** is enqueued per business → fetches the site, runs `classifyWebsite()`, WHOIS, PageSpeed → sets `WebsiteStatus` + technical signals.
5. A **scoring job** runs `scoreBusiness()` → writes `leadScore`, `leadTemperature`, `opportunityScore`, breakdown JSON.
6. When the user clicks **Scrape Contacts**, an **enrichment job** runs the provider waterfall (see [07](07-enrichment-pipeline.md)) → creates `Contact` rows with confidence scores.
7. Dashboard reads via cursor-paginated, cached, RLS-scoped queries; tables are virtualized.

## 5. Caching strategy

- **Read cache (Redis):** campaign list, analytics widgets, filter facet counts — keyed by `org:campaign:filtersHash`, TTL 30–60s, busted on write.
- **Idempotency:** `/ingest` accepts an `Idempotency-Key` per batch so retries from the extension never double-insert.
- **HTTP:** `Cache-Control` + ETag on static/exported assets via CloudFront.

## 6. Scaling posture (summary — full detail in [11](11-roadmap.md))

- Stateless API + worker autoscale on CPU/queue-depth.
- Postgres: read replicas for analytics; `Business` table partitioned by `organizationId` hash beyond ~50–100M rows; covering indexes for the table view.
- Search: start with Postgres `tsvector`/`pg_trgm`; graduate hot tenants to OpenSearch.
- BullMQ: per-queue concurrency caps + rate limiters to respect external API quotas.

## 7. Tech decisions / trade-offs

- **NestJS over bare Express:** DI, guards, interceptors, and OpenAPI generation pay off for RBAC + a large surface.
- **BullMQ over SQS (initially):** Redis is already present; richer job semantics (pause/resume/progress) match the scraping UX. Revisit SQS+Lambda for spiky enrichment fan-out at scale.
- **Cursor pagination, never OFFSET:** required for the 100k+ leads/user requirement.
- **Scoring as a pure shared package:** identical results in API, worker, and (optional preview in) the extension; trivially unit-testable.
