# GridLeads

A production-grade SaaS + Chrome Extension for **Google Maps lead generation** — built for agencies, freelancers, web designers, SEO consultants, and sales teams. Discover local businesses, enrich their data, detect who has no (or a broken) website, score the opportunity, and export qualified leads.

> **The USP:** every lead carries a **Website Sales Opportunity Score (0–100)** — a sales-ready number that tells a rep exactly how much website/marketing work they can pitch and bill.

## Monorepo at a glance

| Path | What it is |
|------|------------|
| [apps/web](docs/02-folder-structure.md) | Next.js 15 dashboard (App Router, Shadcn/UI, TanStack Query, Zustand) |
| [apps/api](docs/02-folder-structure.md) | NestJS REST API + BullMQ producers |
| [apps/worker](docs/02-folder-structure.md) | BullMQ consumers: scraping, enrichment, scoring, exports, outreach |
| [apps/extension](docs/05-chrome-extension.md) | Manifest V3 Chrome extension (Google Maps scraper) |
| [packages/scoring](packages/scoring/index.ts) | **Lead Score + Website Opportunity engines** (framework-free, shared by API, worker, and extension) |
| [packages/db](prisma/schema.prisma) | Prisma schema, migrations, seed |
| [packages/ui](docs/02-folder-structure.md) | Shared Shadcn-based component library + design tokens |

## Documentation

1. [Architecture](docs/01-architecture.md) — system design, data flow, infra topology
2. [Folder structure](docs/02-folder-structure.md) — full monorepo layout
3. [Database schema](docs/03-database-schema.md) — ERD, indexes, partitioning, RLS
4. [API specification](docs/04-api-specification.md) — REST surface, DTOs, RBAC, rate limits
5. [Chrome extension](docs/05-chrome-extension.md) — MV3 architecture + scraping workflow
6. [Lead scoring & Website Opportunity Engine](docs/06-lead-scoring.md)
7. [Enrichment pipeline](docs/07-enrichment-pipeline.md) — contacts, confidence scoring
8. [UI / wireframes / user flows](docs/08-ui-wireframes.md)
9. [Billing & RBAC](docs/09-billing-rbac.md) — Stripe plans, permission matrix
10. [Security & GDPR](docs/10-security-gdpr.md)
11. [Roadmap: MVP → V2 → scaling](docs/11-roadmap.md)
12. [Deployment & production checklist](docs/12-deployment-checklist.md)

## Quickstart (target DX)

```bash
pnpm install
docker compose up -d            # postgres + redis + minio(s3)
pnpm db:migrate && pnpm db:seed
pnpm dev                        # web :3000, api :4000, worker, extension watcher
```

## Status

This repository currently contains the **architecture package** and the **runnable scoring engines** (`packages/scoring`, with vitest tests). The application scaffolding (Next.js/NestJS/extension) is specified in the docs and ready to be generated next — see [the roadmap](docs/11-roadmap.md).
