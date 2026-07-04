// GridLeads Review Scraper — content script on google.com/maps.
// On {action:'scrapeReviews'} it opens the Reviews tab, sorts by Newest, scrolls
// to lazy-load, and returns up to the 100 most-recent reviews. The background
// drives navigation (one business at a time) and persists the results to the DB.

(function () {
  if (window.__glrReviewsLoaded) return;   // guard against double-injection
  window.__glrReviewsLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ctxAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  function safeSend(message) { if (!ctxAlive()) return; try { chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; }); } catch { /* context gone */ } }

  async function waitFor(fn, timeout = 10000, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { let v = null; try { v = fn(); } catch { v = null; } if (v) return v; await sleep(interval); }
    return null;
  }

  // ── consent (in-page dialog on the maps domain) ──────────────────────────
  async function dismissConsent() {
    const btn = await waitFor(() =>
      document.querySelector('button[aria-label*="Accept all" i], button[aria-label*="Reject all" i]') ||
      [...document.querySelectorAll('form[action*="consent"] button, button')].find((b) => /(accept all|reject all|i agree|elfogad|elutas)/i.test(b.textContent || '')),
      3000);
    if (btn) { try { btn.click(); } catch {} await sleep(700); }
  }

  // ── confirm the place panel loaded ───────────────────────────────────────
  async function waitForPlace(timeout = 22000) {
    return waitFor(() => {
      const panel = document.querySelector('div[role="main"][aria-label]');
      const title = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
      return (panel && title && (title.textContent || '').trim().length > 0) ? panel : null;
    }, timeout);
  }

  // ── open the Reviews tab ─────────────────────────────────────────────────
  function findReviewsTab() {
    const tabs = [...document.querySelectorAll('button[role="tab"], [role="tab"]')];
    return tabs.find((t) => /reviews?|értékelés/i.test(t.getAttribute('aria-label') || '') || /^\s*reviews?\b|értékelés/i.test(t.textContent || '')) || tabs[1] || null;
  }
  // 'no-tab'   → the place genuinely has no reviews tab (0 reviews) — a real success
  // 'no-cards' → the tab exists but nothing rendered in time — a load failure
  // 'ok'       → review cards are present
  async function openReviews() {
    const tab = await waitFor(findReviewsTab, 15000);
    if (!tab) return 'no-tab';
    if (tab.getAttribute('aria-selected') !== 'true') { try { tab.click(); } catch {} }
    const cards = await waitFor(() => document.querySelector('div[data-review-id], div.jftiEf'), 15000);
    return cards ? 'ok' : 'no-cards';
  }

  // ── sort by Newest so we collect the most-recent reviews first ───────────
  async function sortNewest() {
    const btn = await waitFor(() =>
      document.querySelector('button[aria-label*="Sort" i], button[data-value="Sort"]') ||
      [...document.querySelectorAll('button')].find((b) => /^\s*(sort|most relevant|rendezés|legrelevánsabb)\b/i.test(b.textContent || '')),
      8000);
    if (!btn) return false;
    try { btn.click(); } catch {}
    const menu = await waitFor(() => document.querySelector('div[role="menu"], #action-menu'), 5000);
    if (!menu) return false;
    const items = [...menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')];
    const newest = items.find((i) => /newest|legújabb/i.test(i.getAttribute('aria-label') || i.textContent || '')) || items[1];
    if (newest) { try { newest.click(); } catch {} }
    await sleep(900);
    await waitFor(() => document.querySelector('div[data-review-id]'), 8000);
    return true;
  }

  // ── find the scrollable reviews container ────────────────────────────────
  function getScrollContainer() {
    let el = document.querySelector('div[role="feed"]');
    if (el && el.scrollHeight > el.clientHeight + 50) return el;
    const card = document.querySelector('div[data-review-id], div.jftiEf');
    el = card;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 50) return el;
      el = el.parentElement;
    }
    return document.querySelector('div.m6QErb.DxyBCb') || document.querySelector('div[role="main"] div[tabindex="-1"]') || null;
  }

  // ── expand every truncated "See more" (review text + owner responses) ────
  function expandAll(container) {
    const btns = (container || document).querySelectorAll('button.w8nwRe, button[aria-label*="See more" i], button[jsaction*="expandReview"], button[aria-label*="Tovább" i]');
    btns.forEach((b) => { try { if (b.offsetParent !== null) b.click(); } catch {} });
  }

  // ── parse one review card ────────────────────────────────────────────────
  function parseReview(card) {
    const id = card.getAttribute('data-review-id') || '';
    const author = (card.querySelector('.d4r55')?.textContent || '').trim();
    const authorUrl = card.querySelector('a[href*="/maps/contrib/"]')?.getAttribute('href') || '';
    const rEl = card.querySelector('span.kvMYJc[aria-label], [role="img"][aria-label*="star" i], [aria-label*="csillag" i]');
    let rating = null;
    const rm = (rEl?.getAttribute('aria-label') || '').match(/([\d.]+)\s*(?:star|csillag)/i);
    if (rm) rating = parseFloat(rm[1]);
    if (rating == null) { const t = card.querySelector('span.fzvQIb')?.textContent || ''; const tm = t.match(/([\d.]+)/); if (tm) rating = parseFloat(tm[1]); }
    const time = (card.querySelector('.rsqaWe, .xRkPPb, .DZSIDd')?.textContent || '').replace(/\s*on Google\s*/i, '').replace(/^Edited\s*/i, '').trim();
    const text = (card.querySelector('span.wiI7pd')?.textContent || '').trim();
    const respEl = card.querySelector('div.CDe7pd .wiI7pd, .CDe7pd .MyEned');
    const ownerResponse = respEl ? respEl.textContent.trim() : '';
    return { id, author, authorUrl, rating, time, text, ownerResponse };
  }

  // A card still showing a visible "See more" button holds truncated text — its
  // expandAll() click may not have taken effect when we first parsed it.
  function isTruncated(card) {
    const b = card.querySelector('button.w8nwRe, button[aria-label*="See more" i], button[jsaction*="expandReview"], button[aria-label*="Tovább" i]');
    return !!(b && b.offsetParent !== null);
  }

  function harvest(container, seen, max) {
    for (const card of container.querySelectorAll('div[data-review-id]')) {
      const id = card.getAttribute('data-review-id');
      if (!id) continue;
      if (!card.querySelector('.d4r55')) continue; // skip non-review wrappers
      // Re-parse an already-seen card only while its text is still truncated, so a
      // late "See more" expansion is captured instead of a permanently clipped review.
      if (seen.has(id) && !isTruncated(card)) continue;
      const parsed = parseReview(card);
      const prev = seen.get(id);
      if (!prev || (parsed.text || '').length >= (prev.text || '').length) seen.set(id, parsed);
      if (!prev && seen.size >= max) break; // cap only counts distinct reviews
    }
  }

  // ── the full scrape ──────────────────────────────────────────────────────
  async function scrapeGoogleReviews(max = 100) {
    await dismissConsent();
    const panel = await waitForPlace();
    if (!panel) throw new Error('place panel did not load');
    const place = (document.querySelector('h1.DUwDvf')?.textContent || document.querySelector('h1')?.textContent || '').trim();

    const opened = await openReviews();
    if (opened === 'no-tab') return { place, reviews: [] }; // genuine: place has no reviews
    if (opened === 'no-cards' && !document.querySelector('div[data-review-id]')) {
      // the reviews tab exists but nothing loaded — a failure, NOT a real zero.
      // Report it so the background can retry instead of marking the business done.
      return { place, reviews: [], error: 'reviews-did-not-load' };
    }
    const sorted = await sortNewest();

    const container = await waitFor(getScrollContainer, 12000);
    if (!container) {
      // last-ditch: maybe a tiny list with no scroll container
      const seen0 = new Map(); harvest(document, seen0, max);
      return { place, reviews: [...seen0.values()].slice(0, max), sortStale: !sorted };
    }

    const seen = new Map();
    let stall = 0, lastCount = -1, lastDom = -1;
    const MAX_STALL = 4, HARD_CAP_LOOPS = 140;
    for (let i = 0; i < HARD_CAP_LOOPS && seen.size < max; i++) {
      expandAll(container); await sleep(60);
      harvest(container, seen, max);
      if (seen.size >= max) break;

      container.scrollTop = container.scrollHeight;
      try { container.dispatchEvent(new WheelEvent('wheel', { deltaY: 1200, bubbles: true })); } catch {}
      await sleep(850 + Math.random() * 450);

      const dom = container.querySelectorAll('[data-review-id]').length;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      if (seen.size === lastCount && dom === lastDom) stall++; else stall = 0;
      lastCount = seen.size; lastDom = dom;
      if (stall >= MAX_STALL && atBottom) break;
    }
    expandAll(container); await sleep(80); harvest(container, seen, max);
    return { place, reviews: [...seen.values()].slice(0, max), sortStale: !sorted };
  }

  let running = false;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === 'scrapeReviews') {
      if (running) { sendResponse({ ok: true, busy: true }); return true; }
      running = true;
      sendResponse({ ok: true });
      (async () => {
        let result;
        try { result = await scrapeGoogleReviews(100); }
        catch (e) { result = { error: String((e && e.message) || e), reviews: [] }; }
        running = false;
        safeSend({ type: 'reviewsScraped', place: result.place || '', reviews: result.reviews || [], count: (result.reviews || []).length, error: result.error || '', sortStale: !!result.sortStale });
      })();
      return true;
    }
    if (msg && msg.action === 'ping') { sendResponse({ ok: true, running }); return true; }
    return false;
  });
})();
