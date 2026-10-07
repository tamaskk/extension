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

Syncing to the web app needs your dashboard login: log in at the web app in the
same browser profile first (the session lasts 7 days). Without it a sync fails
with a "not logged in" message and the leads stay in the browser.

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

## Queue from the dashboard

The Coverage tab of the dashboard can put missing runs straight into the batch queue, without a JSON file. Click the cells to pick runs (a state and a business type), check the prefix ("bars near"), then **Queue in the extension** or **Queue and start**.

**Queue and start** runs the searches in one of three ways, chosen next to the button:

- *each batch in its own window* (default): as many windows of this browser as batches were queued (8 at most), one batch per window, side by side. A window closes when its batch is done.
- *in a tab of this window*: one worker, in a Google Maps tab of the same window. A Maps tab that is already open is used, otherwise one opens. No new browser window. It scrapes while that tab is the visible one; Chrome pauses a hidden tab, so drag it out into its own window to keep using the dashboard.
- *in my open Google Maps windows*: the same as "Claim" in the popup.

It works in the browser where this extension is installed: `content/dashboardBridge.js` runs on the dashboard page (`gridleads-wheat.vercel.app`, `localhost:3000` / `3001`) and passes on five commands only: `batchEnqueue`, `batchStartQueue`, `batchStartAdopt`, and the read-only `batchStatus` and `batchQueue`. After changing the extension, reload it on `chrome://extensions` and then reload the dashboard page.

## Emails (v0.3)

Google Maps never returns an email address, so the extension reads it off the
business's **own website**: the homepage first, then — only if that has none —
up to three contact / about / imprint pages. It understands `mailto:` links,
plain text, Cloudflare-protected addresses and `name [at] domain [dot] com`,
and drops asset names, tracking IDs, template placeholders, role addresses that
never buy (press@, careers@, privacy@…) and the web designer's address. Each
lead keeps the address, the page it came from (`emailSource`) and when it was
checked (`emailCheckedAt` / `emailStatus`), so nothing is looked up twice. See
[`lib/emailFinder.js`](lib/emailFinder.js).

- **While scraping** — popup switch *Find emails while scraping* (on by
  default). In *Stream to DB* mode a finished search waits (max 90 s) for its
  lookups before it is uploaded.
- **Email audit** ([`audit/`](audit/audit.html)) — for the leads you already
  have. Lists every project with what is missing (email / phone / address /
  category / rating) and how much; tick projects or press **▶ from here** to
  choose where to start. Source is either the web app's database (needs you to
  be logged in to the web app in the same browser) or this browser's projects.
- **Changelog** ([`changelog/`](changelog/changelog.html)) — every lead that
  came in, every field that changed on a re-scrape (old → new), every email and
  where it was read, audit runs, syncs, project and batch actions. Stored in
  IndexedDB ([`lib/activityLog.js`](lib/activityLog.js)), newest 150,000 events.

A lead **without a website** (or with only a Facebook/Instagram page) cannot be
filled in this way — there is nothing to read. Use the web app's AI lead search
for those.

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
