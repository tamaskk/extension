# GridLeads — Review Scraper

A separate Chrome MV3 extension that walks the GridLeads database and scrapes
Google Maps reviews for each business, **one at a time**, **newest first**, up to
**100 reviews** per business, and **skips any business that already has reviews**.

## How it works

1. You click **▶ Start** in the popup.
2. The background asks the DB for the most-recently-scraped business that has no
   reviews yet (`GET /api/reviews/next`) and opens it on Google Maps (`?cid=…&hl=en`).
3. The content script opens the **Reviews** tab, sorts by **Newest**, scrolls to
   lazy-load, and collects up to the **100 newest** reviews (author, rating,
   relative time, text, owner response).
4. The reviews are posted to `POST /api/reviews`, which stores them in a separate
   `reviews` collection and stamps `reviewsScrapedAt` on the lead — so it is never
   scraped again.
5. It immediately moves to the next business. Stop any time with **■ Stop**.

You can start it whenever ("random"): it always continues from the latest
un-scraped business. All state is persisted, so it survives Chrome closing the
service worker, and an alarm watchdog recovers from any stuck step.

## Load it (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder: `apps/extension-reviews`.
3. Pin the **GridLeads — Review Scraper** icon, open it, press **Start**.
4. Keep the Google Maps tab it opens in the foreground while it runs (Chrome
   throttles background tabs, which stalls scrolling).

It talks to the deployed app at `https://gridleads-wheat.vercel.app`. This is a
different extension from the lead scraper (`apps/extension`) — load both if you
want; they don't conflict.
