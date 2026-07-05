// GridLeads Review Scraper — MV3 service worker (multi-window parallel engine).
// Several WORKERS run at once. Each worker owns a window+tab and loops: claim the
// next business from the DB (the most-recent one with no reviews yet — claims are
// de-duplicated across workers via an `inflight` set + an `exclude` query param so
// two windows never grab the same business), open it on Maps, have the content
// script scrape up to the 100 newest reviews, POST them (which marks the business
// done), then claim the next. State is persisted so a killed service worker can be
// revived; an alarm watchdog recovers dropped events and tops up the window count.
//
// Two ways to start:
//   • reviewStart       → AUTO: we open up to N windows (chrome.windows.create).
//   • reviewStartAdopt  → MANUAL: claim the windows YOU already opened (no
//                          windows.create → never throttled). Recommended when
//                          auto-open caps below N on a constrained machine.

const SYNC_BASE = 'https://gridleads-wheat.vercel.app';
const SKEY = 'glr_state';
const HB_ALARM = 'glr_hb';
const DEFAULT_CONCURRENCY = 4;        // parallel windows
const NAV_SETTLE = 2500;              // after Maps loads, before scraping

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ── state ──────────────────────────────────────────────────────────────────
const BLANK = {
  active: false, mode: 'auto', concurrency: DEFAULT_CONCURRENCY,
  workers: [],                        // { id, windowId, tabId, created, stage, current, ts }
  inflight: [],                       // dedupKeys claimed but not yet saved
  skip: [],                           // dedupKeys to stop re-serving after repeated save failures
  saveFails: {},                      // dedupKey -> consecutive save-failure count
  noMore: false,                      // DB has no more businesses → stop adding workers
  done: 0, reviews: 0, errors: 0, lastError: '', message: 'Idle', startedAt: 0,
};
async function getState() { const o = await chrome.storage.local.get(SKEY); return Object.assign({}, BLANK, o[SKEY] || {}); }
async function setState(s) { await chrome.storage.local.set({ [SKEY]: s }); refreshBadge(s); return s; }

// Serialize every read-modify-write so parallel workers never clobber state.
let _lock = Promise.resolve();
function lockState(fn) { const p = _lock.then(() => fn()); _lock = p.then(() => {}, () => {}); return p; }

function refreshBadge(s) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: s.active ? '#6366f1' : '#3a3f52' });
    chrome.action.setBadgeText({ text: s.active ? String(s.done || 0) : '' });
  } catch {}
}

// ── DB calls ────────────────────────────────────────────────────────────────
async function fetchNext(exclude) {
  // Join with a newline, not a comma: a name-fallback dedupKey ("name|lat|lng") can
  // contain a comma, which would split into fragments that exclude nothing. Business
  // names never contain a newline. (Server /api/reviews/next splits on "\n" to match.)
  const q = exclude && exclude.length ? '?exclude=' + encodeURIComponent(exclude.join('\n')) : '';
  // Timeout so a hung request can't stall a worker indefinitely (and, now that the
  // fetch runs outside lockState, can't freeze the whole engine / the Stop button).
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(SYNC_BASE + '/api/reviews/next' + q, { method: 'GET', signal: ctrl.signal });
    if (!r.ok) throw new Error('next HTTP ' + r.status);
    return r.json();
  } finally { clearTimeout(t); }
}
async function postReviews(body) {
  const r = await fetch(SYNC_BASE + '/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('save HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// ── image/tile blocking (declarativeNetRequest) ──────────────────────────────
// Google Maps renders a full map (raster tiles) + business photos + avatars in
// every worker window. The review scraper reads only DOM TEXT — never images — and
// the review DATA arrives over XHR/fetch. Blocking just image+media on the worker
// TABS (session rules keyed by tabId, so the user's own Maps tabs are untouched)
// stops Chrome caching gigabytes of tiles/photos to disk, and cuts per-window RAM.
// Rule id == tabId (tabIds are unique positive ints; only we use session rules here).
async function blockImagesOnTab(tabId) {
  if (tabId == null || tabId < 1) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId],
      addRules: [{
        id: tabId,
        priority: 1,
        action: { type: 'block' },
        condition: { tabIds: [tabId], resourceTypes: ['image', 'media'] },
      }],
    });
  } catch (e) { console.warn('[GLR] image-block rule failed:', e && e.message); }
}
async function unblockTab(tabId) {
  if (tabId == null) return;
  try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }); } catch { /* */ }
}
// Drop every image-block rule (run finished/stopped) so adopted user windows get
// their images back.
async function clearAllImageBlocks() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
  } catch { /* */ }
}

// ── tab/window helpers ──────────────────────────────────────────────────────
function placeUrl(b) {
  const base = (b.mapsUrl && /maps\?cid=/.test(b.mapsUrl)) ? b.mapsUrl : ('https://www.google.com/maps?cid=' + b.cid);
  return base + (base.includes('hl=') ? '' : (base.includes('?') ? '&' : '?') + 'hl=en');
}
async function isLiveTab(id) { if (id == null) return false; try { await chrome.tabs.get(id); return true; } catch { return false; } }

async function startContent(tabId) {
  for (let i = 0; i < 6; i++) {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'scrapeReviews' }).catch(() => { void chrome.runtime.lastError; return undefined; });
    if (res && res.ok) return true;
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] }); } catch {}
    await sleep(1200);
  }
  return false;
}

// ── opening windows (AUTO mode) — tiled grid, retry, throttle-resilient ──────
async function openWorkerWindow(idx, count) {
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const W = 1440, H = 840;
  const w = Math.max(480, Math.floor(W / cols)), h = Math.max(400, Math.floor(H / rows));
  const left = (idx % cols) * w, top = Math.floor(idx / cols) * h;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const win = await chrome.windows.create({ url: 'https://www.google.com/maps', type: 'normal', focused: idx === 0, left, top, width: w, height: h });
      let tabId = (win && win.tabs && win.tabs[0]) ? win.tabs[0].id : null;
      if (tabId == null && win && win.id != null) { try { const ts = await chrome.tabs.query({ windowId: win.id }); if (ts && ts[0]) tabId = ts[0].id; } catch {} }
      if (tabId != null) return { windowId: win.id, tabId };
    } catch (e) { console.warn('[GLR] window create failed (attempt ' + (attempt + 1) + '):', e && e.message); }
    await sleep(700);
  }
  return null;
}

let _opening = false;
async function topUpWorkers() {
  if (_opening) return;
  _opening = true;
  try {
    let fails = 0;
    for (let guard = 0; guard < 16; guard++) {
      const s = await getState();
      if (!s.active || s.mode !== 'auto' || s.noMore) break;
      const live = s.workers.filter((w) => w.stage !== 'done').length;
      if (live >= s.concurrency) break;
      if (fails >= 3) break; // give up for now; the watchdog retries the rest in ~30s
      const idx = s.workers.length;
      const win = await openWorkerWindow(idx, s.concurrency);
      if (!win) { fails++; await sleep(1000); continue; }
      fails = 0;
      const id = await lockState(async () => {
        const ss = await getState(); if (!ss.active) return null;
        const nid = ss.workers.length;
        ss.workers.push({ id: nid, windowId: win.windowId, tabId: win.tabId, created: true, stage: 'init', current: null, ts: now() });
        await setState(ss); return nid;
      });
      if (id != null) { await blockImagesOnTab(win.tabId); driveWorker(id); }
      await sleep(800);
    }
  } finally { _opening = false; }
}

// ── adopting windows (MANUAL mode) — claim the user's open windows ───────────
async function listAdoptableTabs() {
  let all = [];
  try { all = await chrome.tabs.query({}); } catch { return []; }
  let focusedActiveTabId = null;
  try { const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (act) focusedActiveTabId = act.id; } catch {}
  const byWin = {};
  for (const t of all) (byWin[t.windowId] = byWin[t.windowId] || []).push(t);
  const isMaps = (u) => typeof u === 'string' && u.startsWith('https://www.google.com/maps');
  const isBlank = (u) => !u || u === 'about:blank' || u.indexOf('chrome://newtab') === 0 || u.indexOf('chrome://new-tab-page') === 0;
  const out = [];
  for (const t of all) {
    if (t.id == null || t.windowId == null || t.id === focusedActiveTabId) continue;
    if (isMaps(t.url)) { out.push({ tabId: t.id, windowId: t.windowId }); continue; }
    if (isBlank(t.url || t.pendingUrl) && (byWin[t.windowId] || []).length === 1) out.push({ tabId: t.id, windowId: t.windowId });
  }
  return out;
}
async function adoptWorkers() {
  if (_opening) return;
  _opening = true;
  try {
    const s = await getState();
    if (!s.active || s.mode !== 'adopt' || s.noMore) return;
    const have = new Set(s.workers.map((w) => w.tabId));
    for (const tg of await listAdoptableTabs()) {
      if (have.has(tg.tabId)) continue;
      const id = await lockState(async () => {
        const ss = await getState(); if (!ss.active) return null;
        if (ss.workers.some((w) => w.tabId === tg.tabId)) return null;
        const nid = ss.workers.length;
        ss.workers.push({ id: nid, windowId: tg.windowId, tabId: tg.tabId, created: false, stage: 'init', current: null, ts: now() });
        await setState(ss); return nid;
      });
      if (id != null) { await blockImagesOnTab(tg.tabId); driveWorker(id); }
      await sleep(300);
    }
  } finally { _opening = false; }
}

// ── the pump: claim a business for a worker, then navigate its tab ───────────
async function driveWorker(workerId) {
  // 1) snapshot the exclude set (read is atomic; the authoritative guard is the
  //    commit lock in step 3). Skip if this worker is already busy/finished.
  const s0 = await getState();
  if (!s0.active) return;
  const w0 = s0.workers.find((x) => x.id === workerId);
  if (!w0 || w0.current || w0.stage === 'navigating' || w0.stage === 'scraping' || w0.stage === 'done') return;
  const exclude = [...(s0.inflight || []), ...(s0.skip || [])];

  // 2) network claim OUTSIDE lockState — a slow/hung fetch (bounded by fetchNext's
  //    15s timeout) no longer serializes every other worker, stop, or event handler.
  let res, err = null;
  try { res = await fetchNext(exclude); } catch (e) { err = e; }

  // 3) validate + commit under the lock
  const action = await lockState(async () => {
    const s = await getState(); if (!s.active) return { stop: true };
    const w = s.workers.find((x) => x.id === workerId); if (!w) return { stop: true };
    // A concurrent drive already advanced this worker → abandon our fetch result.
    // Any business the server returned was never added to inflight, so it is simply
    // re-served later — no orphaned claim (fixes the double-drive inflight leak).
    if (w.current || w.stage === 'navigating' || w.stage === 'scraping' || w.stage === 'done') return { stop: true };
    if (err) { w.stage = 'retry'; w.ts = now(); s.lastError = String(err.message || err); await setState(s); return { retry: true }; }
    if (!res || !res.ok) { w.stage = 'retry'; w.ts = now(); s.lastError = (res && res.error) || 'next failed'; await setState(s); return { retry: true }; }
    if (res.done) { // nothing left → this worker is finished
      w.stage = 'done'; w.current = null; w.ts = now(); s.noMore = true;
      const allDone = s.workers.every((x) => x.stage === 'done');
      await setState(s);
      return { done: true, allDone, created: w.created, windowId: w.windowId };
    }
    const biz = res.business;
    // raced: another worker claimed this exact business between snapshot and commit
    if ((s.inflight || []).includes(biz.dedupKey)) { w.stage = 'retry'; w.ts = now(); await setState(s); return { retry: true }; }
    s.inflight = [...(s.inflight || []), biz.dedupKey];
    w.current = biz; w.stage = 'navigating'; w.ts = now();
    s.message = 'Opening ' + (biz.name || biz.dedupKey) + '…';
    await setState(s);
    return { nav: true, tabId: w.tabId, biz };
  });
  if (!action || action.stop) return;
  if (action.retry) return; // watchdog re-drives shortly
  if (action.done) {
    if (action.created && action.windowId != null) { try { await chrome.windows.remove(action.windowId); } catch {} }
    if (action.allDone) await finishRun('✓ All businesses done — nothing left to scrape.');
    return;
  }
  if (action.nav) {
    try { await chrome.tabs.update(action.tabId, { url: placeUrl(action.biz) }); } catch { /* tab gone → onRemoved/watchdog recovers */ }
  }
}

// Re-navigate a worker's CURRENT business (used when a nav/complete event was missed).
async function renavWorker(workerId) {
  const a = await lockState(async () => {
    const s = await getState(); if (!s.active) return null;
    const w = s.workers.find((x) => x.id === workerId); if (!w) return null;
    if (!w.current) return { drive: true };
    w.stage = 'navigating'; w.ts = now(); await setState(s);
    return { tabId: w.tabId, biz: w.current };
  });
  if (!a) return;
  if (a.drive) { driveWorker(workerId); return; }
  try { await chrome.tabs.update(a.tabId, { url: placeUrl(a.biz) }); } catch {}
}

// Save a worker's result, release its claim, advance to the next business.
async function releaseAndAdvance(tabId, reviewCount, errMsg, isErr) {
  const wid = await lockState(async () => {
    const s = await getState(); if (!s.active) return null;
    // Only a worker that is actually scraping can be released. Without this guard a
    // watchdog scrape-timeout racing a late reviewsScraped would double-release:
    // resurrect a 'done' worker, double-count, release the wrong claim, double-drive.
    const w = s.workers.find((x) => x.tabId === tabId); if (!w || w.stage !== 'scraping') return null;
    if (w.current) s.inflight = (s.inflight || []).filter((k) => k !== w.current.dedupKey);
    s.done = (s.done || 0) + 1;
    s.reviews = (s.reviews || 0) + (reviewCount || 0);
    if (isErr) { s.errors = (s.errors || 0) + 1; s.lastError = errMsg || s.lastError; }
    s.message = `Saved ${reviewCount} review${reviewCount === 1 ? '' : 's'}` + (w.current ? (' for ' + (w.current.name || w.current.dedupKey)) : '');
    w.current = null; w.stage = 'init'; w.ts = now();
    await setState(s);
    return w.id;
  });
  if (wid != null) driveWorker(wid);
}

async function finishRun(message) {
  await lockState(async () => {
    const s = await getState();
    await setState(Object.assign({}, BLANK, { message: message || 'Stopped.', done: s.done, reviews: s.reviews, errors: s.errors, lastError: s.lastError }));
  });
  await clearAllImageBlocks(); // restore images on any adopted user windows
  try { await chrome.alarms.clear(HB_ALARM); } catch {}
}
async function stopRun(message) {
  const s = await getState();
  if (s.active && Array.isArray(s.workers)) {
    for (const w of s.workers) { if (w.created && w.windowId != null) { try { await chrome.windows.remove(w.windowId); } catch {} } }
  }
  await finishRun(message || 'Stopped.');
}

// A business failed to scrape/save (render failure, injection failure, timeout, or
// a failed POST). Do NOT postReviews — that is what marks the business done in the
// DB, and every business we're served has reviewCount>0, so a 0-review result is a
// transient failure, not a real empty. Leave it un-done so it retries, but bump a
// per-business counter and, after 3 attempts, add it to `skip` (included in the
// fetchNext exclude) so a permanently-broken business can't loop forever this run.
// Used by ALL failure paths so their behaviour is identical regardless of timing.
async function failBusiness(tabId, label) {
  await lockState(async () => {
    const s = await getState(); if (!s.active) return;
    // stage==='scraping' guard: a watchdog snapshot can race a late reviewsScraped
    // that already advanced this worker to a new business — without the guard we'd
    // charge the error/save-failure to that healthy new business.
    const w = s.workers.find((x) => x.tabId === tabId); if (!w || !w.current || w.stage !== 'scraping') return;
    const key = w.current.dedupKey;
    s.errors = (s.errors || 0) + 1;
    s.lastError = label;
    s.saveFails = s.saveFails || {};
    s.saveFails[key] = (s.saveFails[key] || 0) + 1;
    if (s.saveFails[key] >= 3 && !(s.skip || []).includes(key)) {
      s.skip = [...(s.skip || []), key];
      s.lastError = 'giving up on ' + (w.current.name || key) + ' after 3 attempts';
    }
    await setState(s);
  });
  await releaseAndAdvance(tabId, 0, '', false); // isErr=false: failBusiness already counted the error (no double-count)
}

// content finished (or failed) → save + advance
async function onReviewsScraped(msg, tid) {
  const s = await getState();
  if (!s.active) return;
  const w = s.workers.find((x) => x.tabId === tid);
  if (!w || !w.current || w.stage !== 'scraping') return; // stale
  const cur = w.current;
  const reviews = Array.isArray(msg.reviews) ? msg.reviews : [];
  if (msg.sortStale) console.warn('[GLR] reviews for', cur.name || cur.dedupKey, 'may not be in newest order (sort failed)');

  // Hard scrape failure reported by the content script → retry, don't mark done.
  if (msg.error) { await failBusiness(tid, 'scrape: ' + String(msg.error)); return; }

  // Save the result (this marks the business done in the DB).
  try {
    await postReviews({ project: cur.project, dedupKey: cur.dedupKey, cid: cur.cid || '', placeId: cur.placeId || '', name: cur.name || '', reviews, error: '' });
  } catch (e) {
    await failBusiness(tid, 'save: ' + String(e.message || e)); // POST failed → not done → retry
    return;
  }
  // success → clear any prior failure count for this business, then advance
  await lockState(async () => { const ss = await getState(); if (ss.saveFails && ss.saveFails[cur.dedupKey]) { delete ss.saveFails[cur.dedupKey]; await setState(ss); } });
  await releaseAndAdvance(tid, reviews.length, '', false);
}

// ── events ───────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  (async () => {
    const s = await getState();
    if (!s.active) return;
    const w = s.workers.find((x) => x.tabId === tabId);
    if (!w || w.stage !== 'navigating') return;
    const url = (tab && tab.url) || '';
    if (url.includes('consent.google.com')) return; // consent.js dismisses it → another 'complete' follows
    if (!/^https:\/\/www\.google\.com\/maps/.test(url)) return;
    await lockState(async () => { const ss = await getState(); const ww = ss.workers.find((x) => x.tabId === tabId); if (ww && ww.stage === 'navigating') { ww.stage = 'scraping'; ww.ts = now(); ss.message = 'Scraping reviews…'; await setState(ss); } });
    await sleep(NAV_SETTLE); // let Maps render the place panel
    const ok = await startContent(tabId);
    if (!ok) { // couldn't inject/start → retry (don't mark done), capped by skip
      await failBusiness(tabId, 'could not start scraper');
    }
  })();
});

// A worker's window/tab closed by the user → end that worker, release its claim
// (the business is still un-done in the DB, so another worker re-claims it).
chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    await unblockTab(tabId); // drop this tab's image-block rule (id == tabId)
    await lockState(async () => {
      const s = await getState(); if (!s.active) return;
      const w = s.workers.find((x) => x.tabId === tabId); if (!w || w.stage === 'done') return;
      if (w.current) s.inflight = (s.inflight || []).filter((k) => k !== w.current.dedupKey);
      w.stage = 'done'; w.current = null; w.ts = now();
      await setState(s);
    });
  })();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tid = sender && sender.tab && sender.tab.id;
    try {
      switch (msg && msg.type) {
        case 'reviewsScraped': await onReviewsScraped(msg, tid); sendResponse({ ok: true }); break;
        case 'reviewStart': { // AUTO: open up to N windows ourselves
          const s = await getState();
          if (s.active) { sendResponse({ ok: true, already: true }); break; }
          await setState(Object.assign({}, BLANK, { active: true, mode: 'auto', concurrency: DEFAULT_CONCURRENCY, startedAt: now(), message: 'Starting…' }));
          try { await chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch {}
          topUpWorkers();
          sendResponse({ ok: true });
          break;
        }
        case 'reviewStartAdopt': { // MANUAL: claim the user's already-open windows
          const s = await getState();
          if (s.active && (s.workers || []).length) {
            let alive = 0; for (const w of s.workers) { if (w.stage !== 'done' && await isLiveTab(w.tabId)) alive++; }
            if (alive > 0) { sendResponse({ ok: true, already: true, adopted: alive }); break; }
          }
          const targets = await listAdoptableTabs();
          if (!targets.length) { sendResponse({ ok: false, error: 'no-maps' }); break; }
          await setState(Object.assign({}, BLANK, { active: true, mode: 'adopt', concurrency: Math.max(targets.length, 1), startedAt: now(), message: 'Claiming windows…' }));
          try { await chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch {}
          await adoptWorkers();
          const fin = await getState();
          sendResponse({ ok: true, adopted: (fin.workers || []).length });
          break;
        }
        case 'reviewStop': await stopRun('Stopped.'); sendResponse({ ok: true }); break;
        case 'reviewStatus': {
          const s = await getState();
          const live = (s.workers || []).filter((w) => w.stage !== 'done');
          const cur = (live.find((w) => w.current) || {}).current || null;
          sendResponse({ ok: true, active: s.active, mode: s.mode, done: s.done, reviews: s.reviews, errors: s.errors, message: s.message, current: cur, workers: live.length, concurrency: s.concurrency });
          break;
        }
        default: sendResponse({ ok: false });
      }
    } catch (e) {
      console.error('[GLR] message handler threw for type=' + (msg && msg.type) + ':', e);
      try { sendResponse({ ok: false, error: (e && e.message) || String(e) }); } catch {}
    }
  })();
  return true; // async sendResponse
});

// ── watchdog: recover dropped events + top up the window count ───────────────
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HB_ALARM) watchdog(); });
async function watchdog() {
  const s = await getState();
  if (!s.active) { try { await chrome.alarms.clear(HB_ALARM); } catch {} return; }
  const t = now();
  for (const w of s.workers) {
    const age = t - (w.ts || 0);
    if (w.stage === 'done') continue;
    if (w.stage === 'retry' && age > 15000) driveWorker(w.id);
    else if (w.stage === 'init' && age > 20000) driveWorker(w.id);
    else if (w.stage === 'navigating' && age > 60000) renavWorker(w.id);     // nav/complete missed → re-navigate current
    else if (w.stage === 'scraping' && age > 240000) {                       // stuck >4min → retry (capped by skip), don't mark done
      await failBusiness(w.tabId, 'scrape timeout');
    }
  }
  if (!s.noMore) { if (s.mode === 'adopt') adoptWorkers(); else topUpWorkers(); }
}

chrome.runtime.onInstalled.addListener(() => refreshBadge(BLANK));
chrome.runtime.onStartup.addListener(async () => refreshBadge(await getState()));
