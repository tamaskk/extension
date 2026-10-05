# 07 — Contact Enrichment Pipeline

Triggered by **Scrape Contacts** (per-lead or per-selection). Runs as a BullMQ job; fan-out across providers; results become `Contact` rows with a confidence score.

## 1. Provider waterfall (stop-early to save cost)

Run cheapest/most-reliable first; stop when confidence threshold met or budget exhausted. Every step is **rate-limited per provider** in the worker and metered against the org's plan `enrichments` quota.

```
1. Domain resolution        website → registrable domain (+ WHOIS: age, registrar, expiry)
2. Website scrape           homepage + /contact /about: emails, tel:, social links, tech tags
3. Hunter.io                domain → email pattern + named emails + deliverability
4. Apollo                   company + people (titles, LinkedIn)
5. Clearbit                 firmographics + logo + tech
6. PeopleDataLabs           person enrichment fallback
7. RocketReach              email/phone fallback
8. Google search            "<business> owner email", site: queries (last resort)
```

A provider adapter interface keeps them swappable:

```ts
interface EnrichmentProvider {
  name: string;
  enrich(input: { domain?: string; businessName: string; city?: string }): Promise<ProviderResult>;
  cost: number;       // credits, for budgeting
  rateLimit: RateLimit;
}
```

## 2. Email classification & merge

Discovered emails are typed (`OWNER|INFO|SUPPORT|SALES|GENERIC|PERSONAL`) by local-part + role heuristics, deduped per business (`@@unique(businessId, email)`), and the highest-confidence per type is kept. Conflicting data from multiple providers is merged with provider precedence + recency.

## 3. Contact Confidence Score (0–100)

Composed, not just local-part based:

| Factor | Effect |
|--------|--------|
| Pattern match on company domain (`contact@`, `firstname@`) | high base |
| Provider deliverability = valid (Hunter SMTP check) | +25 |
| Found on the business's own website | +20 |
| Corroborated by ≥2 providers | +15 |
| Role local-part ranking | contact 95 · info 90 · hello 85 · sales 80 |
| Free webmail (gmail/yahoo/outlook) | capped ~50 |
| Catch-all domain / no MX | −20 |

Final value clamped 0–100, stored on `Contact.confidence`; the UI shows a colored dot + the source.

## 4. Output written

For each business: emails (typed), phone, LinkedIn/Facebook/Instagram/TikTok/YouTube/Twitter, `domain`, `whois`, `techStack`, `source`, `verified`. `Business.enrichmentStatus` transitions `QUEUED → RUNNING → ENRICHED|FAILED`; an `Activity` row records it. After enrichment, a scoring job re-runs (`hasFacebook/Instagram`, pixel/GA detection now known) so scores reflect new signals.

## 5. Cost control & GDPR

- **Budget guard:** per-job credit cap + plan quota check before each provider call; stop-early on threshold.
- **Caching:** domain-level results cached (Redis + a `domain_enrichment` table) so re-enriching businesses on the same domain is free for a TTL.
- **Lawful basis & deletion:** enriched personal data is processed under legitimate-interest B2B prospecting; provenance (`source`) stored for every field; per-contact and per-org erasure supported (see [10](10-security-gdpr.md)). Suppression list prevents re-adding erased contacts.
