# 06 — Lead Scoring & Website Opportunity Engine

Implementation: [packages/scoring](../packages/scoring/index.ts) — pure, framework-free, unit-tested ([leadScore.test.ts](../packages/scoring/leadScore.test.ts)). Shared by the API, the worker, and (optionally) the extension preview.

## 1. Two scores, two questions

| Score | Question it answers | Audience |
|-------|--------------------|----------|
| **Lead Score (0–100)** → Cold/Warm/Hot | "How qualified / how weak is this business's digital presence overall?" | prioritization, filtering |
| **Website Sales Opportunity Score (0–100)** → the USP | "How much website/marketing work can I sell them *right now*, and what's the pitch?" | the sales call itself |

Both run from the same `BusinessSignals` object produced by the scraper + website probe.

## 2. Lead Score rules ([leadScore.ts](../packages/scoring/leadScore.ts))

| Signal | Points |
|--------|-------:|
| No website (incl. social-only, broken, expired) | +50 |
| Website older than 5 years | +20 |
| No SSL | +20 |
| < 50 reviews | +15 |
| No Facebook | +10 |
| No Instagram | +10 |
| No Google Posts | +10 |
| No booking system | +15 |
| No online ordering | +15 |

Clamped to 100. **Cold 0–39 · Warm 40–69 · Hot 70–100.** "Old site" and "no SSL" are skipped when there is no website (you can't have an old site you don't have). Weights are a per-org config (`LeadScoreWeights`) so agencies can tune to their offer.

## 3. Website Opportunity Engine ([websiteOpportunity.ts](../packages/scoring/websiteOpportunity.ts)) — the USP

Scores concrete, *fixable-and-billable* technical gaps and emits a ranked list of **sales pitches**:

| Signal | Points | Auto-pitch |
|--------|-------:|-----------|
| No website | +30 | Full website build (highest ticket) |
| Not mobile-friendly | +14 | Responsive rebuild |
| Slow website (PageSpeed < 50) | +12 | Performance/redesign engagement |
| No SSL | +12 | Quick-win security fix upsell |
| No online booking | +10 | Booking/scheduling integration |
| No Facebook Pixel | +8 | Retargeting/ads setup |
| No Google Analytics | +8 | Analytics + reporting retainer |
| No Meta Ads pixel | +6 | Paid-social management |

Clamped to 100. On-page technical signals (speed, mobile, pixels, GA) only count when a site actually responds; "no booking" applies regardless. The result includes `pitches[]` sorted by value, so the lead detail panel can render: *"Top opportunities: no website → full build; not mobile-friendly → responsive rebuild; no SSL → quick win."*

This is what makes GridLeads more than a scraper: a rep opens a Hot lead and already has the opening line.

## 4. How signals are produced

| Signal | Source |
|--------|--------|
| `websiteStatus` | `classifyWebsite()` ([websiteStatus.ts](../packages/scoring/websiteStatus.ts)) — probe + WHOIS + social-host heuristics |
| `domainAgeYears`, `hasSsl` | WHOIS + TLS handshake in the probe job |
| `pageSpeedScore`, `isMobileFriendly` | Google PageSpeed Insights / Lighthouse |
| `hasFacebookPixel`, `hasGoogleAnalytics`, `hasMetaAdsPixel` | HTML/script scan of the homepage (tag fingerprints) |
| `hasBookingSystem`, `hasOnlineOrdering` | link/keyword fingerprints (Calendly, OpenTable, Resy, Toast, Square, etc.) |
| `reviewCount`, `rating`, `hasGooglePosts` | scraped from Maps |
| `hasFacebook`, `hasInstagram` | scraped links + enrichment |

## 5. Website Status Detector

`classifyWebsite()` returns one of: `HAS_WEBSITE`, `NO_WEBSITE`, `FACEBOOK_ONLY`, `INSTAGRAM_ONLY`, `BROKEN`, `REDIRECTS`, `NOT_WORKING`, `DOMAIN_EXPIRED`, `DOMAIN_PARKED`, `UNDER_CONSTRUCTION`. Logic: missing URL → none; social host → social-only; WHOIS expired → expired; unreachable → not working; HTTP ≥400 → broken; parked/construction body markers; cross-domain redirect → redirects; else has website. Fully covered by tests.

## 6. Recompute strategy

Scores are recomputed by the **scoring job** whenever a probe/enrichment updates signals, and on a periodic **revalidation sweep** (e.g. websites re-checked every 30–90 days, since a "no website" prospect may build one). `scoreBusiness()` returns the exact JSON persisted to `Business.scoreBreakdown` / `opportunitySignals` so the UI shows the *why* with zero recomputation.
