# 05 — Chrome Extension (Manifest V3) & Scraping Workflow

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Popup (React)              Background (service worker)         │
│  • campaign selector        • auth token store (chrome.storage)│
│  • Start/Pause/Resume/Stop  • batch queue + retry/backoff      │
│  • progress bar             • POST /ingest, /scrape-jobs       │
│  • found / saved / errors   • messaging hub (ports)            │
│        ▲  ▲                          ▲                         │
│        │  └──── chrome.runtime ──────┘                         │
│        ▼                              ▼                         │
│ Content script (injected on google.com/maps)                  │
│  • auto-scroll results feed   • parse cards   • open detail    │
│  • dedup by placeId           • emit business objects          │
└──────────────────────────────────────────────────────────────┘
```

- **manifest.json** (MV3): `permissions: ["storage","scripting","tabs","alarms"]`, `host_permissions: ["https://www.google.com/maps/*","https://<api-host>/*"]`, a `service_worker` background, and a content script matched to Maps. Use `chrome.alarms` to keep the SW alive during long scrapes (MV3 SWs are killed when idle).
- **Build:** Vite + `@crxjs/vite-plugin`, React for the popup.

## 2. Scraping workflow

1. **Init** — popup sends `{action:'start', campaignId}` to the SW; SW creates a `ScrapeJob` (`POST /scrape-jobs`) and tells the content script to begin.
2. **Auto-scroll** — content script scrolls the results feed container (`div[role="feed"]`) in steps, waiting for new `.Nv2PK`-style result nodes; detects end-of-list ("You've reached the end of the list").
3. **Extract** — for each result card, parse name, category, rating, review count, and the lat/lng + CID from the card's `href` (`!3d<lat>!4d<lng>` and `0x…:0x<cid>`). For deeper fields (phone, website, address, hours, attributes, photos, description) optionally open the detail pane and parse it (configurable: "fast" = list only, "deep" = open each).
4. **Dedup** — a `Set` of seen `placeId`/CID in the content script avoids re-emitting as the feed virtualizes.
5. **Batch & send** — SW buffers extracted businesses and flushes every N (e.g. 50) or every few seconds to `POST /campaigns/:id/ingest` with an `Idempotency-Key` (hash of the batch). Tracks `recordsFound/recordsSaved/errors`.
6. **Progress** — SW pushes counts to the popup; also `PATCH /scrape-jobs/:id` so the web dashboard shows live progress.
7. **Controls** — Pause (stop scrolling, keep buffer), Resume, Stop (flush + mark job `COMPLETED`/`CANCELLED`).
8. **Background scraping** — work continues while the user is on the Maps tab; the SW + alarms keep state. (Chrome cannot scrape a backgrounded/discarded tab reliably, so the UX keeps the Maps tab active; document this limitation to users.)

## 3. Parser contract

The content script emits objects matching the `IngestBusiness` Zod schema (see [04](04-api-specification.md) §4). The parser is isolated in `src/lib/parser.ts` with **selector constants at the top** because Google's Maps DOM changes — when it breaks, you fix one file. Each selector has a fallback chain and the parser never throws on a single bad card (it counts an error and continues).

```ts
// src/lib/parser.ts (shape)
const SEL = {
  feed: 'div[role="feed"]',
  card: 'div[role="feed"] > div > div[jsaction]',
  name: '.qBF1Pd, .fontHeadlineSmall',
  rating: '.MW4etd',
  reviews: '.UY7F9',
  category: '.W4Efsd > span:first-child',
  link: 'a.hfpxzc',           // contains lat/lng + cid
} as const;

export function parseCard(el: Element): Partial<IngestBusiness> | null { /* ... */ }
export function parseLatLngCid(href: string): { lat?: number; lng?: number; cid?: string } { /* regex */ }
```

## 4. Resilience & anti-fragility

- **Selector drift:** versioned parser; the SW reports parse-success ratio to the API; if it drops below a threshold the API can flag "extension needs update."
- **Rate/behavior:** human-like scroll cadence with jitter; never automate Maps navigation beyond scrolling/opening panes; respect the user's own session (no credential handling).
- **Retries:** failed `/ingest` batches retry with exponential backoff; the `Idempotency-Key` guarantees no duplicates.
- **Auth:** the popup performs an OAuth/device-code-style handshake to fetch a scoped extension token; stored in `chrome.storage.session`.

## 5. Popup UI (matches spec)

Search results summary · Campaign selector (fetched from `/campaigns`) · Start Scraping · Pause · Resume · Stop · Progress bar · Records Found · Records Saved · Errors · "Open in dashboard" link. Built with the shared design tokens so it visually matches the web app.

## 6. Compliance note

The extension scrapes within the operator's own browser session and is positioned as a productivity tool for data the operator can already see. Scraping Google Maps may conflict with Google's ToS; the product surfaces this in onboarding and ToS, offers an official **Places API** ingestion path as an alternative data source, and never resells raw Google content. (See [10](10-security-gdpr.md).)
