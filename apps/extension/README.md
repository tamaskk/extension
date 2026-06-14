# GridLeads — Maps Lead Scraper (loadable Chrome extension)

A **self-contained, no-build** Manifest V3 extension. Scrapes Google Maps search
results, detects who has **no website**, scores the **sales opportunity**, and
exports a **CSV** — all locally in your browser. No account or backend required.

> This is the standalone MVP. The full SaaS version (campaigns, server-side
> enrichment, CRM, outreach) is specified in [`/docs`](../../docs/01-architecture.md).

## Install (Load unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select this folder: `apps/extension`
5. The **◧ GridLeads** icon appears in your toolbar (pin it for easy access)

Works in Chrome, Edge, Brave, and any Chromium browser. After editing any file,
return to `chrome://extensions` and click the **↻ reload** icon on the card.

## Use it

1. Go to **Google Maps** and run a search, e.g.
   `dentists in Miami`, `roofers in Dallas`, `restaurants in NYC`.
2. Make sure the **results list** (left panel) is showing.
3. Click the **GridLeads** toolbar icon → **▶ Start scraping**.
4. It auto-scrolls the list, collecting + scoring each business. Watch the
   counters: **Total · No website · Hot · Errors**.
5. Click **■ Stop** any time (it also stops automatically at the end of the list).
6. Tick **“Export only no-website leads”** if you only want the prospects without
   a site, then click **⤓ Export CSV**.

The CSV includes: Business, Category, Rating, Reviews, Phone, Website, **Website
Status**, **Lead Score**, **Temperature**, **Opportunity Score**, **Top Pitch**,
Address, coordinates, and Maps URL — sorted by Opportunity Score (best first).

## How it works (v0.2)

Instead of scraping the DOM (where the **website** link is usually missing), the
background service worker captures Google Maps' `/search` protobuf responses and
reads each business by fixed index paths — `name = entry[14][11]`,
`website = entry[14][7][0]`, `phone = entry[14][178]`, `rating = entry[14][4][7]`,
etc. This is why website detection is now reliable. See
[`lib/mapsParser.js`](lib/mapsParser.js).

- The content script's only job is to **scroll the results list** (which makes
  Maps fetch the next page) and detect the true end of the list.
- Each **search is saved as its own Project**; switch between them in the
  dashboard sidebar.

## Notes & limitations

- **Keep the Maps tab in front** while scraping (Chrome throttles background tabs).
- Deeper signals — SSL, domain age, PageSpeed, Facebook Pixel / Google Analytics /
  Meta Ads pixel — still need the server-side probe in the full product (see
  [docs/06-lead-scoring.md](../../docs/06-lead-scoring.md)).
- If a future Google change breaks parsing, the index paths in
  [`lib/mapsParser.js`](lib/mapsParser.js) (`FIELDS`) are the one place to adjust.
- Data lives in `chrome.storage.local` until you delete a project or clear all.
- Respect Google's Terms of Service and local laws; this is a productivity tool
  for data you can already see in your own session.
