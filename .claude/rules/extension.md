---
paths:
  - "apps/extension/**"
  - "apps/extension-reviews/**"
---

# Chrome extensions (Manifest V3, plain JavaScript)

- No build step, no npm packages, no TypeScript, no remote scripts. Files are loaded as they are, with classic `<script src>` tags and `importScripts` in the service worker. Libraries in `lib/` attach to `self` through an IIFE.
- You cannot run or test an extension. After a change, tell the user which extension to reload in `chrome://extensions` and which page or flow to check.
- `SYNC_BASE` (the production URL) is hardcoded in four files: `apps/extension/background/background.js`, `dashboard/dashboard.js`, `audit/audit.js`, and `apps/extension-reviews/background/background.js`. Change all of them together, and the `host_permissions` in both manifests if the host changes.
- Every value that reaches `innerHTML` goes through the page's `esc()`. URLs used in `href` must match `^https?://`. Scraped and imported data is untrusted.
- Writes to `gridleads_projects` in `chrome.storage.local` go through the promise-chain mutex in `background.js`. Do not write that key from anywhere else.
- Service workers are killed when idle: no state in module-level variables that must survive; use `chrome.storage` and alarms (see the `gl_batch_hb` watchdog).
- `lib/scoring.js` mirrors `apps/web/lib/scoring.ts`, and the "no real website" status list is repeated in `background.js`. Change all copies in the same commit.
- The sync bundle format and `dedupKey` are a contract with `apps/web/app/api/sync/route.ts`: change both sides together (docs/ARCHITECTURE.md §08).
- `mapsParser.js` reads fixed index paths in Google's response. When parsing breaks, fix the paths; do not switch to DOM scraping.
- New permissions or host permissions in a manifest need approval.
- Styles: the dark tokens at the top of `dashboard/dashboard.css`; `lib/pages.css` reuses them. See docs/DESIGN_SYSTEM.md §02.
- Bump `version` in `manifest.json` only when the user asks.
