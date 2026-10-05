# 02 — Folder Structure (pnpm + Turborepo monorepo)

```
gridleads/
├─ apps/
│  ├─ web/                         # Next.js 15 dashboard
│  │  ├─ app/
│  │  │  ├─ (marketing)/           # public landing, pricing
│  │  │  ├─ (auth)/                # Clerk/Auth.js routes
│  │  │  ├─ (dashboard)/
│  │  │  │  ├─ layout.tsx          # sidebar + topbar shell
│  │  │  │  ├─ campaigns/
│  │  │  │  │  ├─ page.tsx         # campaign list
│  │  │  │  │  └─ [id]/
│  │  │  │  │     ├─ page.tsx      # MAIN TABLE (virtualized)
│  │  │  │  │     ├─ board/        # pipeline kanban
│  │  │  │  │     └─ [businessId]/ # lead detail drawer/route
│  │  │  │  ├─ analytics/
│  │  │  │  ├─ outreach/
│  │  │  │  └─ settings/           # team, billing, api keys, webhooks
│  │  │  └─ api/                   # route handlers proxying to NestJS (cookie auth)
│  │  ├─ components/               # app-specific composites
│  │  ├─ hooks/                    # useCampaigns, useBusinesses (TanStack Query)
│  │  ├─ stores/                   # Zustand: table selection, filters, ui
│  │  ├─ lib/                      # api client, query keys, formatters
│  │  └─ styles/
│  │
│  ├─ api/                         # NestJS REST API
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ app.module.ts
│  │     ├─ common/                # guards, interceptors, filters, decorators
│  │     │  ├─ rbac/               # RolesGuard, @Roles(), permission matrix
│  │     │  ├─ tenant/             # TenantInterceptor (injects orgId), Prisma RLS
│  │     │  ├─ rate-limit/         # Redis sliding-window guard
│  │     │  └─ idempotency/
│  │     ├─ auth/                  # token verification (Clerk/Auth.js JWKS)
│  │     ├─ campaigns/
│  │     ├─ businesses/            # list/filter/search, bulk actions
│  │     ├─ contacts/
│  │     ├─ ingest/                # extension batch endpoint
│  │     ├─ enrichment/           # enqueue + status
│  │     ├─ exports/
│  │     ├─ outreach/
│  │     ├─ analytics/
│  │     ├─ billing/               # Stripe checkout + webhooks + limits
│  │     ├─ webhooks/
│  │     └─ openapi/               # swagger module
│  │
│  ├─ worker/                      # BullMQ consumers
│  │  └─ src/
│  │     ├─ queues.ts              # queue + connection registry
│  │     ├─ processors/
│  │     │  ├─ ingest.processor.ts
│  │     │  ├─ website-probe.processor.ts
│  │     │  ├─ scoring.processor.ts
│  │     │  ├─ enrichment.processor.ts
│  │     │  ├─ export.processor.ts
│  │     │  └─ outreach.processor.ts
│  │     └─ providers/             # hunter, apollo, clearbit, pdl, rocketreach, psi, whois
│  │
│  └─ extension/                   # Manifest V3
│     ├─ manifest.json
│     ├─ src/
│     │  ├─ background/            # service worker: queue, auth, batching
│     │  ├─ content/               # Google Maps DOM scraper + autoscroll
│     │  ├─ popup/                 # React popup UI (campaign select, controls)
│     │  ├─ lib/                   # parser, dedup, api client
│     │  └─ types/
│     └─ vite.config.ts            # @crxjs/vite-plugin
│
├─ packages/
│  ├─ scoring/                     # ✅ implemented: lead score + opportunity engine
│  ├─ db/                          # Prisma client wrapper, repositories
│  ├─ ui/                          # Shadcn components, design tokens, themes
│  ├─ config/                      # eslint, tsconfig, tailwind preset
│  ├─ types/                       # shared DTO/types (zod schemas -> OpenAPI)
│  └─ emails/                      # react-email templates for outreach
│
├─ prisma/
│  ├─ schema.prisma                # ✅ implemented
│  ├─ migrations/
│  └─ seed.ts
│
├─ infra/
│  ├─ docker/                      # Dockerfiles per app
│  ├─ docker-compose.yml           # local: postgres, redis, minio
│  ├─ terraform/                   # AWS: VPC, ECS/Fargate, RDS, ElastiCache, S3, CF
│  └─ github/                      # CI/CD workflows
│
├─ docs/                           # this documentation set
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

## Conventions

- **Imports:** apps import from `@gridleads/scoring`, `@gridleads/db`, `@gridleads/ui`, `@gridleads/types`. No app imports another app.
- **Shared types are the contract:** Zod schemas in `packages/types` generate both DTO validation (NestJS) and the OpenAPI client used by `apps/web` and `apps/extension`.
- **One source of truth for scoring:** never reimplement scoring in the UI — call `@gridleads/scoring`.
