# 12 — Deployment Architecture & Production Checklist

## 1. Deployment topology (AWS)

```
Route53 ─▶ CloudFront ─▶ { Next.js (Vercel or ECS+ALB) }
                         { NestJS API  (ECS Fargate service, ALB) }
ECS Fargate ─▶ Worker service (BullMQ consumers, no public ingress)
RDS Postgres (Multi-AZ, primary + read replica)
ElastiCache Redis (cluster mode)
S3 (exports, thumbnails) ─▶ CloudFront signed URLs
Secrets Manager (provider keys, Stripe, DB creds)   CloudWatch + OTel ─▶ Grafana/Sentry
```

- **Containers:** one Dockerfile per app (`web`, `api`, `worker`); multi-stage builds; distroless/node-slim runtime; non-root user.
- **IaC:** Terraform modules in `infra/terraform` (VPC, subnets, ECS, RDS, ElastiCache, S3, CloudFront, IAM, Secrets). Environments: `dev`, `staging`, `prod` via workspaces.
- **CI/CD (GitHub Actions):** lint → typecheck → test → build → image push to ECR → migrate (gated) → deploy (blue/green via CodeDeploy or ECS rolling). Extension built + zipped as a release artifact; submitted to Chrome Web Store via the publish API.
- **DB migrations:** run as a one-off ECS task before service rollout; `CREATE INDEX CONCURRENTLY` for hot tables; backward-compatible (expand/contract) deploys.

## 2. Environments & config
- 12-factor: all config via env/Secrets Manager; no secrets in images.
- Feature flags for risky features (deep scraping, new providers).
- Separate Stripe (test/live), Clerk instances, and provider keys per env.

## 3. Observability
- **Logs:** structured JSON → CloudWatch → centralized (no PII).
- **Tracing:** OpenTelemetry across web→api→worker→providers.
- **Metrics/alerts:** p95 latency, error rate, queue depth/age, provider error %, RLS violations, Stripe webhook failures, scrape parse-success ratio.
- **Errors:** Sentry on all three apps + extension.
- **Uptime:** synthetic checks on key flows; status page.

## 4. Backups & DR
- RDS automated backups + PITR; periodic snapshot copy to a second region.
- S3 versioning + lifecycle (exports expire).
- Documented RTO/RPO; restore drills quarterly.

## 5. Production readiness checklist

**Security**
- [ ] RLS policies on every tenant table, verified by tests
- [ ] RBAC matrix enforced + object-level checks
- [ ] SSRF allowlist on website-probe & webhook senders
- [ ] CSP, HSTS, secure cookies, CSRF protection
- [ ] Secrets in Secrets Manager; rotation enabled
- [ ] Rate limiting (API + per-provider) live
- [ ] `pnpm audit` / SAST / secret-scanning clean in CI
- [ ] Pen-test / security review completed

**Data & compliance**
- [ ] Backups + PITR + tested restore
- [ ] DSAR export + erase (contact & org) working; suppression list
- [ ] Unsubscribe link honored globally; ToS/Privacy/DPA published
- [ ] Retention/auto-purge jobs scheduled

**Reliability**
- [ ] Autoscaling configured (API/worker) + load tested to 100k+ leads/tenant
- [ ] Queue DLQ + retry/backoff; idempotent `/ingest`
- [ ] Stripe webhooks idempotent + signature-verified
- [ ] Health/readiness probes; graceful shutdown (drain queues)
- [ ] Zero-downtime migration playbook

**Product/billing**
- [ ] Plan limits enforced server-side (campaigns/leads/enrichments/exports/seats)
- [ ] Dunning / payment-failure downgrade path
- [ ] Extension published + auto-update channel; parser version reporting

**Observability**
- [ ] Dashboards + alerts wired; on-call + runbooks
- [ ] Error tracking on all surfaces; trace IDs surfaced in API errors
- [ ] Scrape parse-success monitoring with "update extension" signal
