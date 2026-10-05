# 09 — Billing (Stripe) & RBAC

## 1. Plans & limits

Limits live in **Stripe Price metadata** (source of truth) and are cached on `Organization.limits`. Enforced via `UsageCounter` (per `YYYY-MM`) checked before the limited action.

| | Free | Starter | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Price (mo) | $0 | $39 | $99 | $299 | Custom |
| Campaigns | 2 | 10 | 50 | Unlimited | Unlimited |
| Leads stored | 500 | 10k | 100k | 1M | Custom |
| Enrichments / mo | 50 | 1k | 10k | 50k | Custom |
| Exports / mo | 2 | 50 | 500 | Unlimited | Custom |
| Team seats | 1 | 3 | 10 | 25 | Custom |
| Outreach | — | — | ✓ | ✓ | ✓ |
| API access | — | — | ✓ | ✓ | ✓ |
| Support | community | email | priority | priority | SLA + CSM |

## 2. Stripe integration

- **Checkout:** `POST /v1/billing/checkout` → Stripe Checkout Session (subscription mode) → redirect. On success, the webhook provisions the plan.
- **Customer Portal:** `POST /v1/billing/portal` for upgrades/downgrades/cancel/payment method.
- **Webhook** (`POST /v1/billing/webhook`, raw body, signature-verified, no auth guard): handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid|payment_failed`. Update `Organization.plan`, `stripeSubscriptionId`, and refresh cached `limits` from price metadata. Idempotent on Stripe event id.
- **Metering:** usage-based add-ons (extra enrichment credits) reported via Stripe usage records; hard caps enforced server-side regardless.
- **Dunning:** `payment_failed` → grace period flag → downgrade to read-only on final failure.

### Limit-enforcement guard (shape)

```ts
async function assertWithinLimit(orgId: string, metric: 'leads'|'enrichments'|'exports'|'campaigns', delta = 1) {
  const { limits } = await org(orgId);
  const used = await usage(orgId, metric, currentPeriod());
  if (limits[metric] !== null && used + delta > limits[metric])
    throw new PaymentRequired(`Plan limit reached for ${metric}. Upgrade to continue.`);
}
```

## 3. Roles & permission matrix

Roles: **Admin, Manager, Sales Rep, User, Viewer.** Enforced by `RolesGuard` + object-level checks.

| Capability | Admin | Manager | Sales Rep | User | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| View campaigns/leads | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit campaign | ✓ | ✓ | ✓ | ✓ | — |
| Delete/archive campaign | ✓ | ✓ | — | — | — |
| Scrape / ingest | ✓ | ✓ | ✓ | ✓ | — |
| Run enrichment | ✓ | ✓ | ✓ | ✓ | — |
| Edit lead (stage/owner/notes) | ✓ | ✓ | ✓ (own/assigned) | ✓ (own) | — |
| Bulk delete leads | ✓ | ✓ | — | — | — |
| Export | ✓ | ✓ | ✓ | ✓ | — |
| Outreach send | ✓ | ✓ | ✓ | — | — |
| Manage team / roles | ✓ | — | — | — | — |
| Billing | ✓ | — | — | — | — |
| API keys / webhooks | ✓ | — | — | — | — |
| View audit logs | ✓ | ✓ | — | — | — |

"own/assigned" = object-level: a Sales Rep edits leads they own or are assigned; Managers edit any within the org. All destructive actions are written to `AuditLog`.
