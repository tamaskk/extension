# 10 — Security & GDPR

## 1. AuthN / AuthZ
- Identity via Clerk/Auth.js; API verifies JWT against provider JWKS. Short-lived access tokens, rotating refresh handled by the provider.
- **RBAC** (see [09](09-billing-rbac.md)) + **tenant isolation** at app layer (Prisma org-scope extension) **and** DB layer (Postgres RLS keyed on `app.org_id`). API keys are hashed (sha-256), prefixed, revocable, last-used tracked.

## 2. Transport & data security
- TLS 1.2+ everywhere; HSTS; secure, `HttpOnly`, `SameSite` cookies for the web session.
- **Encryption at rest:** RDS + S3 SSE-KMS. Provider API secrets and webhook secrets stored in AWS Secrets Manager (or KMS-encrypted columns), never in plaintext env in prod.
- Field-level encryption for sensitive enrichment PII columns where required.

## 3. App hardening
- **Input validation:** every DTO via Zod/class-validator; reject unknown fields.
- **XSS:** React auto-escaping; sanitize any rendered HTML (outreach templates) with a allowlist sanitizer; strict CSP (`default-src 'self'`, nonce'd scripts), `X-Content-Type-Options: nosniff`.
- **CSRF:** state-changing browser requests use double-submit token / `SameSite=Lax` cookies; API-key/Bearer paths are CSRF-exempt by design (no ambient cookie).
- **SQL injection:** Prisma parameterizes; raw SQL only via tagged templates with bound params.
- **SSRF:** the website-probe + webhook senders run through an allowlist/denylist resolver that blocks private/link-local IP ranges (critical, since we fetch arbitrary user/business URLs).
- **Rate limiting & abuse:** Redis sliding-window per org/IP; bot/credential-stuffing protection on auth via the identity provider.
- **Secrets/CI:** secret scanning, dependency audit (`pnpm audit`, Dependabot), SAST in CI.

## 4. Auditing & observability
- `AuditLog` for every privileged/destructive action (actor, ip, UA, target, meta).
- Centralized structured logs (no PII in logs), traces (OpenTelemetry), metrics; alerting on auth anomalies, RLS errors, queue backlog, provider error spikes.

## 5. GDPR / privacy
- **Lawful basis:** B2B prospecting under legitimate interest; data minimization (only business-relevant contact data); provenance (`source`) stored per enriched field.
- **DSAR support:** export and **erase** by data subject (contact-level) and by tenant (org-level hard delete; partitioning makes per-tenant purge cheap — see [03](03-database-schema.md) §6).
- **Suppression list:** erased/opted-out contacts are blocked from re-import/re-enrichment.
- **Outreach compliance:** every email includes a working unsubscribe (`/u/:token`), honored globally; supports CAN-SPAM/GDPR/ePrivacy requirements; physical-address footer; per-domain sending limits.
- **DPA & subprocessors:** documented list (Hunter, Apollo, Clearbit, PDL, RocketReach, AWS, Stripe, Clerk); DPAs in place; data-residency option (EU region) for Enterprise.
- **Retention:** configurable retention windows; auto-purge cold/expired leads; export files in S3 expire via lifecycle policy.

## 6. Scraping/legal posture
Maps extraction happens in the operator's own browser session and is positioned as productivity tooling; ToS discloses risk, offers an official Places API ingestion alternative, and prohibits reselling raw Google content. Robots/ToS guidance surfaced in onboarding.
