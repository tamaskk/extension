// GridLeads content script — runs on google.com/maps.
// It no longer parses the DOM for business data (that was unreliable for the
// WEBSITE field). Instead it just drives the results feed: scrolling triggers
// Maps' /search RPC for each page, and the BACKGROUND captures + parses those
// protobuf responses (reliable website/phone/etc).
//
// This script's responsibilities: start/stop, patient auto-scroll, and robust
// end-of-list detection (the feed's last child becomes a ~64px end spacer).

(function () {
  const FEED = '[role="feed"]';
  let running = false;
  let note = '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // After the extension is reloaded/updated, old content scripts left on a page
  // lose their connection — any chrome.runtime call then throws "Extension
  // context invalidated". Guard every message so those old scripts go quiet.
  const ctxAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  function safeSend(message) {
    if (!ctxAlive()) { running = false; return; }
    try { chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; }); }
    catch { running = false; /* context gone */ }
  }

  function currentQuery() {
    const box = document.querySelector('#searchboxinput');
    if (box && box.value && box.value.trim()) return box.value.trim();
    try {
      const m = location.pathname.match(/\/maps\/search\/([^/]+)/);
      if (m) return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    } catch {}
    return '';
  }

  // Continuously tell the background which search this tab is on, so it can
  // attribute captured /search responses to the right project (incl. page 1,
  // which loads before you press Start).
  let lastReported = '';
  function reportQuery() {
    const q = currentQuery();
    if (q && q !== lastReported) { lastReported = q; safeSend({ type: 'setTabQuery', query: q }); }
  }
  reportQuery();
  const reportTimer = setInterval(() => { if (!ctxAlive()) { clearInterval(reportTimer); return; } reportQuery(); }, 2500);

  // Always-visible batch progress banner pinned to the top of the Maps page,
  // showing which search is running and what comes next.
  function escHtml(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  let banner = null;
  async function updateBanner() {
    let st = null;
    if (!ctxAlive()) return;
    try { st = await chrome.runtime.sendMessage({ type: 'batchStatus' }); } catch { return; }
    // only show on the tab that's actually being driven (its search matches)
    const onDrivenTab = st && st.active && st.current && currentQuery() === st.current;
    if (onDrivenTab) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'gridleads-batch-banner';
        banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 18px;border-radius:0 0 12px 12px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:92vw;text-align:center;pointer-events:none;';
        document.documentElement.appendChild(banner);
      }
      const next = st.next ? ` &nbsp;·&nbsp; next: <b>${escHtml(st.next)}</b>` : ' &nbsp;·&nbsp; last one';
      const batchesLeft = (st.queuedBatches || 0) + 1; // current + the ones still queued
      const batchInfo = `📦 <b>${batchesLeft}</b> batch${batchesLeft === 1 ? '' : 'es'} left${st.batchLabel ? ` &nbsp;·&nbsp; <b>${escHtml(st.batchLabel)}</b>` : ''}`;
      banner.innerHTML = `${batchInfo}<br>⚡ search <b>${st.index + 1}/${st.total}</b> &nbsp;·&nbsp; now: <b>${escHtml(st.current)}</b>${next}`;
    } else if (banner) {
      banner.remove();
      banner = null;
    }
  }
  updateBanner();
  const bannerTimer = setInterval(() => {
    if (!ctxAlive()) { clearInterval(bannerTimer); if (banner) { banner.remove(); banner = null; } return; }
    updateBanner();
  }, 2000);

  // True when Maps has appended its end-of-list spacer (last feed child ~64px).
  function atEnd(feed) {
    const last = feed.lastElementChild;
    if (!last) return false;
    const style = last.getAttribute('style') || '';
    if (style.includes('height: 64px') || style.includes('height:64px')) return true;
    // text fallback (localized): "You've reached the end of the list"
    const txt = (last.textContent || '').toLowerCase();
    return txt.includes('end of the list') || txt.includes('a lista végére');
  }

  // Wait for the results feed to appear (after a fresh navigation it isn't
  // there immediately). Used so batch automation can start right after navigating.
  async function waitForFeed(timeoutMs = 18000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (document.querySelector(FEED)) return true;
      await sleep(400);
    }
    return false;
  }

  async function loop() {
    await waitForFeed();
    const feed = document.querySelector(FEED);
    if (!feed) {
      note = 'No results list found — run a Maps search first.';
      running = false;
      safeSend({ type: 'scrapeDone' }); // let batch advance
      return;
    }

    let endHits = 0;
    const NEED_END = 3;     // consecutive end-confirmations before stopping
    let stagnant = 0;
    let lastH = 0;

    while (running) {
      note = '';
      feed.scrollTo({ top: feed.scrollHeight + 1500, behavior: 'smooth' });
      await sleep(1600 + Math.random() * 700);

      const grew = feed.scrollHeight > lastH + 20;
      lastH = feed.scrollHeight;

      if (atEnd(feed)) {
        // Reached the bottom — but Maps may still be streaming the last page.
        endHits++;
        note = `Reached bottom — confirming (${endHits}/${NEED_END})…`;
        // wait patiently and nudge, in case more is still loading
        await sleep(2600);
        feed.scrollBy(0, -300);
        await sleep(500);
        feed.scrollTo({ top: feed.scrollHeight + 1500, behavior: 'smooth' });
        await sleep(2200);
        if (!atEnd(feed) || feed.scrollHeight > lastH + 20) { endHits = 0; lastH = feed.scrollHeight; continue; }
        if (endHits >= NEED_END) break;
        continue;
      }

      // Not at the end. If the list stopped growing for a while, wait extra —
      if (!grew) {
        stagnant++;
        note = 'Waiting for more results to load…';
        await sleep(2500 + stagnant * 800);
        if (stagnant >= 8) break; // give up after long stagnation
      } else {
        stagnant = 0;
      }
    }

    running = false;
    note = '';
    safeSend({ type: 'scrapeDone' }); // natural end → batch advances
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'start') {
      if (!running) {
        running = true;
        safeSend({ type: 'scrapeStart', query: currentQuery() });
        loop();
      }
      sendResponse({ ok: true, query: currentQuery() });
    } else if (msg.action === 'stop') {
      running = false;
      safeSend({ type: 'scrapeStop' });
      sendResponse({ ok: true });
    } else if (msg.action === 'status') {
      sendResponse({ running, note, query: currentQuery() });
    }
    return true;
  });
})();
