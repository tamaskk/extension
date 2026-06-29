// GridLeads Review Scraper — MV3 service worker.
// On Start it repeatedly: asks the DB for the next business with no reviews
// (most-recent first), opens it on Google Maps, has the content script scrape up
// to the 100 newest reviews, posts them to the DB (which also marks the business
// done so it's skipped next time), and moves on. All state is persisted so the
// run survives the service worker being killed; an alarm watchdog recovers from
// dropped navigation/scrape events.

const SYNC_BASE = 'https://gridleads-wheat.vercel.app';
const SKEY = 'glr_state';            // run state (single object)
const HB_ALARM = 'glr_hb';           // watchdog alarm

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ── state ──────────────────────────────────────────────────────────────────
const BLANK = {
  active: false, tabId: null, stage: 'idle', ts: 0,
  current: null,                      // { project, dedupKey, name, cid, placeId, mapsUrl }
  done: 0, reviews: 0, errors: 0, lastError: '', message: 'Idle', startedAt: 0,
};
async function getState() { const o = await chrome.storage.local.get(SKEY); return Object.assign({}, BLANK, o[SKEY] || {}); }
async function setState(s) { await chrome.storage.local.set({ [SKEY]: s }); refreshBadge(s); return s; }
async function patch(p) { const s = await getState(); return setState(Object.assign(s, p)); }

function refreshBadge(s) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: s.active ? '#6366f1' : '#3a3f52' });
    chrome.action.setBadgeText({ text: s.active ? String(s.done || 0) : '' });
  } catch {}
}

// ── DB calls ────────────────────────────────────────────────────────────────
async function fetchNext() {
  const r = await fetch(SYNC_BASE + '/api/reviews/next', { method: 'GET' });
  if (!r.ok) throw new Error('next HTTP ' + r.status);
  return r.json();
}
async function postReviews(body) {
  const r = await fetch(SYNC_BASE + '/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('save HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// ── tab handling ─────────────────────────────────────────────────────────────
function placeUrl(b) {
  const base = (b.mapsUrl && /maps\?cid=/.test(b.mapsUrl)) ? b.mapsUrl : ('https://www.google.com/maps?cid=' + b.cid);
  return base + (base.includes('hl=') ? '' : (base.includes('?') ? '&' : '?') + 'hl=en');
}
async function getTab(tabId) { if (tabId == null) return null; try { return await chrome.tabs.get(tabId); } catch { return null; } }

// Navigate the working tab to a business (creating the tab if needed).
async function navigateTo(business) {
  const s = await getState();
  let tab = await getTab(s.tabId);
  const url = placeUrl(business);
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    try { const t = await chrome.tabs.get(tab.id); if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } catch {}
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  await patch({ tabId: tab.id, current: business, stage: 'navigating', ts: now(), message: 'Opening ' + (business.name || business.dedupKey) + '…' });
}

async function startContent(tabId) {
  for (let i = 0; i < 6; i++) {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'scrapeReviews' }).catch(() => { void chrome.runtime.lastError; return undefined; });
    if (res && res.ok) return true;
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] }); } catch {}
    await sleep(1200);
  }
  return false;
}

// ── the pump ──────────────────────────────────────────────────────────────
async function driveNext() {
  const s = await getState();
  if (!s.active) return;
  let res;
  try { res = await fetchNext(); }
  catch (e) { await patch({ stage: 'retry', ts: now(), lastError: String(e.message || e), message: 'Network error — retrying…' }); return; }
  if (!res || !res.ok) { await patch({ stage: 'retry', ts: now(), lastError: (res && res.error) || 'next failed', message: 'Server error — retrying…' }); return; }
  if (res.done) { await finishRun('✓ All businesses done — nothing left to scrape.'); return; }
  await navigateTo(res.business);
}

async function finishRun(message) {
  await patch({ active: false, stage: 'idle', current: null, message: message || 'Stopped.' });
  try { await chrome.alarms.clear(HB_ALARM); } catch {}
}

// content finished (or failed) → save + advance
async function onReviewsScraped(msg, tid) {
  const s = await getState();
  if (!s.active || tid !== s.tabId || !s.current) return; // stale
  const cur = s.current;
  const reviews = Array.isArray(msg.reviews) ? msg.reviews : [];
  try {
    await postReviews({ project: cur.project, dedupKey: cur.dedupKey, cid: cur.cid || '', placeId: cur.placeId || '', name: cur.name || '', reviews, error: msg.error || '' });
  } catch (e) {
    // couldn't save — record but still advance so we don't loop forever
    await patch({ errors: s.errors + 1, lastError: 'save: ' + String(e.message || e) });
  }
  const s2 = await getState();
  await patch({
    done: s2.done + 1,
    reviews: s2.reviews + reviews.length,
    errors: s2.errors + (msg.error ? 1 : 0),
    lastError: msg.error || s2.lastError,
    message: `Saved ${reviews.length} review${reviews.length === 1 ? '' : 's'} for ${cur.name || cur.dedupKey}`,
    stage: 'init', ts: now(),
  });
  await driveNext();
}

// ── events ───────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  (async () => {
    const s = await getState();
    if (!s.active || tabId !== s.tabId || s.stage !== 'navigating') return;
    const url = (tab && tab.url) || '';
    if (url.includes('consent.google.com')) return; // consent.js dismisses it → another 'complete' will follow
    if (!/^https:\/\/www\.google\.com\/maps/.test(url)) return;
    await patch({ stage: 'scraping', ts: now(), message: 'Scraping reviews…' });
    await sleep(2500); // let Maps render the place panel
    const ok = await startContent(tabId);
    if (!ok) { // couldn't inject/start — mark this one failed and move on
      const cur = (await getState()).current;
      if (cur) { try { await postReviews({ project: cur.project, dedupKey: cur.dedupKey, cid: cur.cid || '', name: cur.name || '', reviews: [], error: 'could not start scraper' }); } catch {} }
      await patch({ errors: (await getState()).errors + 1, stage: 'init', ts: now() });
      await driveNext();
    }
  })();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tid = sender && sender.tab && sender.tab.id;
    switch (msg && msg.type) {
      case 'reviewsScraped': await onReviewsScraped(msg, tid); sendResponse({ ok: true }); break;
      case 'reviewStart': {
        const s = await getState();
        if (s.active) { sendResponse({ ok: true, already: true }); break; }
        await setState(Object.assign({}, BLANK, { active: true, startedAt: now(), ts: now(), stage: 'init', message: 'Starting…' }));
        try { await chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch {}
        driveNext();
        sendResponse({ ok: true });
        break;
      }
      case 'reviewStop': await finishRun('Stopped.'); sendResponse({ ok: true }); break;
      case 'reviewStatus': { const s = await getState(); sendResponse({ ok: true, ...s }); break; }
      default: sendResponse({ ok: false });
    }
  })();
  return true; // keep the channel open for the async sendResponse
});

// ── watchdog: recover dropped events after the SW is killed/revived ─────────
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HB_ALARM) watchdog(); });
async function watchdog() {
  const s = await getState();
  if (!s.active) { try { await chrome.alarms.clear(HB_ALARM); } catch {} return; }
  const age = now() - (s.ts || 0);
  if (s.stage === 'retry' && age > 15000) { await driveNext(); return; }
  if (s.stage === 'init' && age > 15000) { await driveNext(); return; }
  if (s.stage === 'navigating' && age > 60000) { // nav/complete missed → re-navigate current
    if (s.current) await navigateTo(s.current); else await driveNext();
    return;
  }
  if (s.stage === 'scraping' && age > 240000) { // 4 min — scrape stuck, skip this business
    const cur = s.current;
    if (cur) { try { await postReviews({ project: cur.project, dedupKey: cur.dedupKey, cid: cur.cid || '', name: cur.name || '', reviews: [], error: 'scrape timeout' }); } catch {} }
    await patch({ errors: s.errors + 1, lastError: 'scrape timeout', stage: 'init', ts: now() });
    await driveNext();
  }
}

chrome.runtime.onInstalled.addListener(() => refreshBadge(BLANK));
chrome.runtime.onStartup.addListener(async () => refreshBadge(await getState()));
