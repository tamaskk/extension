// GridLeads background service worker (MV3).
// Captures Google Maps /search protobuf responses, parses businesses reliably
// (incl. WEBSITE), scores them, and stores them grouped into PROJECTS (one per
// search query). Also builds CSV exports.

importScripts('../lib/scoring.js', '../lib/mapsParser.js');

const PKEY = 'gridleads_projects'; // { [query]: { query, name, createdAt, folderId?, records: {dedupKey: rec} } }
const FKEY = 'gridleads_folders';  // { [id]: { id, name, createdAt, collapsed } }
const NO_SITE = new Set(['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING']);

let activeQuery = '';        // project shown in the popup / counted on the badge
let sessionFound = 0;        // records added since the last scrapeStart
const seenUrls = new Set();  // dedup the /search URLs we re-fetch
const tabQuery = {};         // tabId -> current search query (reported by content)

// ---------- storage helpers ----------
async function getProjects() {
  const o = await chrome.storage.local.get(PKEY);
  return o[PKEY] || {};
}
async function setProjects(p) { await chrome.storage.local.set({ [PKEY]: p }); }
async function getFolders() { const o = await chrome.storage.local.get(FKEY); return o[FKEY] || {}; }
async function setFolders(f) { await chrome.storage.local.set({ [FKEY]: f }); }
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function ensureProject(query, population) {
  const p = await getProjects();
  let changed = false;
  if (!p[query]) {
    p[query] = { query, name: query || 'Untitled search', createdAt: new Date().toISOString(), records: {} };
    changed = true;
  }
  if (population != null && population !== '' && p[query].population !== population) { p[query].population = population; changed = true; }
  if (changed) await setProjects(p);
}

async function addRecords(query, records) {
  if (!records.length) return 0;
  const p = await getProjects();
  if (!p[query]) p[query] = { query, name: query || 'Untitled search', createdAt: new Date().toISOString(), records: {} };
  let added = 0;
  for (const r of records) {
    const key = r.dedupKey || r.placeId || r.name;
    const existing = p[query].records[key];
    const scored = Object.assign({}, r, self.GridLeadsScoring.score(r));
    if (existing && existing.checked) scored.checked = true; // preserve manual "Checked"
    if (!existing) added++;
    p[query].records[key] = scored;
  }
  await setProjects(p);
  return added;
}

function projectStats(proj) {
  const rows = proj ? Object.values(proj.records) : [];
  return {
    total: rows.length,
    noWebsite: rows.filter((r) => NO_SITE.has(r.websiteStatus)).length,
    hot: rows.filter((r) => r.leadTemperature === 'HOT').length,
    email: rows.filter((r) => r.email).length,
  };
}

async function refreshBadge() {
  const p = await getProjects();
  const proj = activeQuery ? p[activeQuery] : null;
  const n = proj ? Object.keys(proj.records).length : 0;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366F1' });
}

// ---------- network capture (the reliable data source) ----------
// ALWAYS ON: Maps fires a /search RPC for the first page (when you search) and
// for every page as you scroll. We re-fetch each one to read its protobuf body.
function parseQ(url) {
  try { return (new URL(url).searchParams.get('q') || '').trim(); } catch { return ''; }
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const url = details.url;
    if (!/\/search\?/.test(url)) return;       // only the maps data RPC
    if (!/[?&]pb=/.test(url)) return;          // ...which always carries pb=
    if (seenUrls.has(url)) return;             // avoid re-capturing (and our own re-fetch)
    seenUrls.add(url);
    captureSearch(url, details.tabId);
  },
  { urls: ['https://www.google.com/*'] },
);

async function captureSearch(url, tabId) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    const text = await res.text();
    const records = self.GridLeadsParser.parseSearchResponse(text);
    if (!records.length) {
      console.log('[GridLeads] /search captured but 0 parsed. diag=', self.__gridleadsDebug, 'len=', text.length);
      return;
    }
    const q = tabQuery[tabId] || parseQ(url) || activeQuery || 'Google Maps leads';
    if (!activeQuery) activeQuery = q;
    const added = await addRecords(q, records);
    sessionFound += added;
    await refreshBadge();
    console.log(`[GridLeads] captured ${records.length} (+${added} new) -> "${q}"`);
  } catch (e) {
    console.log('[GridLeads] capture error:', e && e.message);
  }
}

// ---------- batch automation (event-driven + persisted, survives SW restarts) ----------
// MV3 service workers are terminated when idle, so a long in-memory loop dies
// mid-batch. Instead we keep the queue in storage and progress via events:
// navigate → tab "complete" event starts the content scraper → "scrapeDone"
// message advances to the next query. A repeating alarm acts as a watchdog so a
// stalled step (or a killed-then-revived SW) recovers automatically.
// State holds a QUEUE of batches; each batch is a group of searches. They run
// one after another (a batch waits for the previous to finish, then starts);
// a finished batch is removed from the queue. queue[0] is the running batch.
const BKEY = 'gridleads_batch';   // v2: { v, active, mode, concurrency, streamSynced, queue:[{id,label,items,status,itemIndex,workerId}], workers:[{id,windowId,tabId,created,batchId,stage,ts}] }
const HB_ALARM = 'gl_batch_hb';
const SKEY = 'gridleads_batch_mode'; // 'local' (keep all in browser) | 'stream' (sync each batch to DB, free storage)
const CKEY = 'gridleads_concurrency'; // how many batches (windows) run in parallel, 1..10
const SYNC_BASE = 'https://gridleads-wheat.vercel.app'; // deployed web app
const SYNC_CHUNK = 500;            // leads per request (well under Vercel's 4.5MB body limit)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBatchMode() { const o = await chrome.storage.local.get(SKEY); return o[SKEY] === 'stream' ? 'stream' : 'local'; }
async function getConcurrency() { const o = await chrome.storage.local.get(CKEY); const n = parseInt(o[CKEY], 10); return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : DEFAULT_CONCURRENCY; }

// POST one sync chunk to the web app.
async function postSync(body) {
  const r = await fetch(SYNC_BASE + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('sync HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// Push the given project queries (with their leads) to the DB, chunked. Throws on failure.
async function syncProjectsToDb(queries) {
  const projects = await getProjects();
  const folders = await getFolders();
  let sentFolders = false;
  for (const q of queries) {
    const p = projects[q];
    if (!p) continue;
    const meta = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId || null, population: p.population };
    const entries = Object.entries(p.records || {});
    if (!entries.length) {
      await postSync({ gridleads: 1, folders: sentFolders ? {} : folders, projects: { [q]: { ...meta, records: {} } } });
      sentFolders = true;
    } else {
      for (let i = 0; i < entries.length; i += SYNC_CHUNK) {
        const chunk = Object.fromEntries(entries.slice(i, i + SYNC_CHUNK));
        await postSync({ gridleads: 1, folders: sentFolders ? {} : folders, projects: { [q]: { ...meta, records: chunk } } });
        sentFolders = true;
      }
    }
  }
  return true;
}

// Remove the given projects from local browser storage (after they're safely in the DB).
async function deleteLocalProjects(queries) {
  if (!queries || !queries.length) return;
  const projects = await getProjects();
  let changed = false;
  for (const q of queries) if (projects[q]) { delete projects[q]; changed = true; }
  if (changed) { await setProjects(projects); await refreshBadge(); }
}

// Stream mode: as soon as a single search finishes, push it to the DB, then drop
// it from local storage so the browser cache stays bounded (parallel-safe — each
// finished project is independent).
async function streamSyncItem(query) {
  if (!query) return;
  try { await syncProjectsToDb([query]); }
  catch (e) { console.warn('[GridLeads] DB sync failed, keeping local copy:', e && e.message); return; }
  await deleteLocalProjects([query]);
}

function buildSearchUrl(query) {
  return 'https://www.google.com/maps/search/' + encodeURIComponent(query).replace(/%20/g, '+');
}
function batchId() { return 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function buildItems(prefix, middles, suffix, populations) {
  const seen = new Set(); const items = [];
  (middles || []).forEach((raw, idx) => {
    const m = (raw || '').trim();
    if (!m) return;
    const q = [(prefix || '').trim(), m, (suffix || '').trim()].filter(Boolean).join(' ').trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      const it = { query: q, area: m, url: buildSearchUrl(q) };
      const pop = populations && populations[idx];
      if (pop != null && pop !== '') it.population = pop;
      items.push(it);
    }
  });
  return items;
}
// ── multi-window parallel engine (v2) ──────────────────────────────────────
// Each WORKER owns its own window+tab and processes ONE batch (city) at a time.
// When a worker finishes its batch it claims the next PENDING batch; when none
// remain it closes its window. The run ends when every worker is done.
const ENGINE_V = 2;
const DEFAULT_CONCURRENCY = 5;       // how many windows scrape in parallel (#2)
const NAV_SETTLE = 2200;             // after a tab loads, before scraping (original)
const DONE_SETTLE = 1200;            // after scrapeDone, before advancing (original)
const tsNow = () => Date.now();

async function getBatch() {
  const o = await chrome.storage.local.get(BKEY);
  const b = o[BKEY] || null;
  // drop any state from an older engine version so callers never crash
  if (b && (b.v !== ENGINE_V || !Array.isArray(b.queue) || !Array.isArray(b.workers))) { await chrome.storage.local.remove(BKEY); return null; }
  return b;
}
async function setBatch(b) { if (b) await chrome.storage.local.set({ [BKEY]: b }); else await chrome.storage.local.remove(BKEY); }

// Serialize read-modify-write of the batch state so parallel workers (all running
// in this one service worker) never clobber each other's updates.
let _batchLock = Promise.resolve();
function lockBatch(fn) { const p = _batchLock.then(() => fn()); _batchLock = p.then(() => {}, () => {}); return p; }

async function isMapsTab(id) {
  if (id == null) return false;
  try { const t = await chrome.tabs.get(id); return !!(t && typeof t.url === 'string' && t.url.startsWith('https://www.google.com/maps')); } catch { return false; }
}

async function startContent(tabId) {
  for (let i = 0; i < 6; i++) {
    const r = await new Promise((resolve) => {
      try { chrome.tabs.sendMessage(tabId, { action: 'start' }, (res) => { void chrome.runtime.lastError; resolve(res); }); }
      catch { resolve(undefined); }
    });
    if (r && r.ok) return true;
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] }); } catch { /* */ }
    await wait(1200);
  }
  return false;
}

// Add a batch to the queue (pending). Started later from the popup.
async function enqueueBatch(batch) {
  return lockBatch(async () => {
    let b = await getBatch();
    if (!b) b = { v: ENGINE_V, active: false, mode: 'local', concurrency: DEFAULT_CONCURRENCY, streamSynced: 0, queue: [], workers: [] };
    b.queue.push({ id: batch.id, label: batch.label, items: batch.items, status: 'pending', itemIndex: 0, workerId: null });
    await setBatch(b);
    return true;
  });
}

// Open a worker window, tiled into a grid so they all stay visible (visible-but-
// unfocused windows throttle far less than fully hidden tabs).
async function openWorkerWindow(idx, count) {
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const W = 1440, H = 840;
  const w = Math.max(480, Math.floor(W / cols)), h = Math.max(400, Math.floor(H / rows));
  const left = (idx % cols) * w, top = Math.floor(idx / cols) * h;
  // retry — rapid window.create calls can be denied; also resolve the tab id via a
  // query when the created window doesn't return its tabs inline.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const win = await chrome.windows.create({ url: 'https://www.google.com/maps', type: 'normal', focused: idx === 0, left, top, width: w, height: h });
      let tabId = (win && win.tabs && win.tabs[0]) ? win.tabs[0].id : null;
      if (tabId == null && win && win.id != null) { try { const ts = await chrome.tabs.query({ windowId: win.id }); if (ts && ts[0]) tabId = ts[0].id; } catch { /* */ } }
      if (tabId != null) return { windowId: win.id, tabId };
    } catch (e) { console.warn('[GridLeads] window create failed (attempt ' + (attempt + 1) + '):', e && e.message); }
    await wait(600);
  }
  return null;
}

// Start processing the queue with N parallel windows (one batch each).
async function startQueue(reuseTabId) {
  const b0 = await getBatch();
  if (!b0 || !b0.queue.length) return { ok: false, error: 'empty' };
  if (b0.active) return { ok: true };

  const conc = await lockBatch(async () => {
    const b = await getBatch(); if (!b) return 0;
    b.active = true; b.mode = await getBatchMode(); b.streamSynced = b.streamSynced || 0;
    b.concurrency = await getConcurrency(); // how many windows run in parallel (1..10)
    for (const x of b.queue) if (x.status === 'running') { x.status = 'pending'; x.workerId = null; } // recover stale
    b.workers = [];
    const pending = b.queue.filter((x) => x.status === 'pending').length;
    if (!pending) { await setBatch(null); return 0; }
    await setBatch(b);
    return Math.min(b.concurrency || DEFAULT_CONCURRENCY, pending);
  });
  if (!conc) return { ok: false, error: 'empty' };
  try { chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch { /* */ }

  // Phase 1 — open the windows ONE AT A TIME with a gap between them, so Chrome
  // doesn't deny rapid window.create calls. We don't start scraping yet, so window
  // creation isn't competing with navigation/capture work.
  const specs = [];
  let attempts = 0;
  while (specs.length < conc && attempts < conc * 5) {
    attempts++;
    let windowId = null, tabId = null, created = false;
    if (specs.length === 0 && await isMapsTab(reuseTabId)) {
      tabId = reuseTabId; try { const t = await chrome.tabs.get(tabId); windowId = t.windowId; } catch { /* */ }
    } else {
      const win = await openWorkerWindow(specs.length, conc);
      if (win) { windowId = win.windowId; tabId = win.tabId; created = true; }
    }
    if (tabId == null) { await wait(700); continue; }
    specs.push({ windowId, tabId, created });
    if (!(await getBatch())?.active) break; // stopped mid-open
    await wait(900); // give this window time to open before opening the next
  }
  // Phase 2 — register all workers, then start them scraping.
  await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return;
    b.workers = specs.map((s, i) => ({ id: i, windowId: s.windowId, tabId: s.tabId, created: s.created, batchId: null, stage: 'init', ts: tsNow() }));
    await setBatch(b);
  });
  for (let i = 0; i < specs.length; i++) driveWorker(i);
  const fin = await getBatch();
  if (fin && fin.active && (!fin.workers || !fin.workers.length)) { await stopAllBatches(); return { ok: false, error: 'no-window' }; }
  return { ok: true };
}

// Give a worker its next item; all state changes happen inside the lock, the slow
// navigation/window ops happen after it's released.
async function driveWorker(workerId) {
  const action = await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return { stop: true };
    const w = b.workers.find((x) => x.id === workerId); if (!w) return { stop: true };
    let bt = w.batchId ? b.queue.find((x) => x.id === w.batchId) : null;
    if (bt && bt.itemIndex >= bt.items.length) { bt.status = 'done'; w.batchId = null; bt = null; } // batch finished
    if (!bt) {
      bt = b.queue.find((x) => x.status === 'pending'); // claim the next un-started batch
      if (!bt) { // nothing left for this worker
        w.batchId = null; w.stage = 'done'; w.ts = tsNow();
        const allDone = b.workers.every((x) => x.stage === 'done') && !b.queue.some((x) => x.status === 'pending' || x.status === 'running');
        await setBatch(b);
        return { done: true, allDone, created: w.created, windowId: w.windowId };
      }
      bt.status = 'running'; bt.workerId = workerId; if (typeof bt.itemIndex !== 'number') bt.itemIndex = 0; w.batchId = bt.id;
    }
    const it = bt.items[bt.itemIndex];
    w.stage = 'navigating'; w.ts = tsNow();
    if (w.tabId != null) tabQuery[w.tabId] = it.query;
    activeQuery = it.query;
    await setBatch(b);
    return { nav: true, tabId: w.tabId, url: it.url, query: it.query, population: it.population };
  });
  if (!action || action.stop) return;
  if (action.done) {
    if (action.created && action.windowId != null) { try { await chrome.windows.remove(action.windowId); } catch { /* */ } }
    if (action.allDone) await finishBatch();
    return;
  }
  if (action.nav) {
    await ensureProject(action.query, action.population);
    await refreshBadge();
    try { await chrome.tabs.update(action.tabId, { url: action.url }); } catch { /* tab gone → watchdog recovers/skips */ }
    // → tabs.onUpdated(complete) starts the scraper for this tab
  }
}

async function onBatchTabComplete(tabId, url) {
  // ignore the bare "/maps" load a freshly-opened worker window does first — only
  // act once the actual search results page has loaded.
  if (url && !/\/maps\/search/.test(url)) return;
  let go = false;
  await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return;
    const w = b.workers.find((x) => x.tabId === tabId); if (!w || w.stage !== 'navigating') return;
    w.stage = 'scraping'; w.ts = tsNow(); await setBatch(b); go = true;
  });
  if (!go) return;
  await wait(NAV_SETTLE);
  await startContent(tabId);
}

// A worker's content script finished → advance its batch by one item.
async function advanceWorker(tabId) {
  const info = await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return null;
    const w = b.workers.find((x) => x.tabId === tabId); if (!w || w.stage !== 'scraping') return null;
    const bt = w.batchId ? b.queue.find((x) => x.id === w.batchId) : null;
    let justDone = null;
    if (bt) { const it = bt.items[bt.itemIndex]; justDone = it ? it.query : null; bt.itemIndex += 1; }
    w.stage = 'init'; w.ts = tsNow();
    await setBatch(b);
    return { workerId: w.id, justDone, mode: b.mode };
  });
  if (!info) return;
  if (info.mode === 'stream' && info.justDone) {
    await streamSyncItem(info.justDone);
    await lockBatch(async () => { const b = await getBatch(); if (b) { b.streamSynced = (b.streamSynced || 0) + 1; await setBatch(b); } });
  }
  driveWorker(info.workerId);
}

async function onScrapeDoneBatch(tabId) {
  if (tabId == null) return;
  await wait(DONE_SETTLE); // let the last captures land
  await advanceWorker(tabId);
}

async function finishBatch() {
  await setBatch(null);
  seenUrls.clear();
  try { chrome.alarms.clear(HB_ALARM); } catch { /* */ }
  await refreshBadge();
}

// Stop everything: tell every worker's content to stop, close the windows we
// opened, and clear the run.
async function stopAllBatches() {
  const b = await getBatch();
  if (b && Array.isArray(b.workers)) {
    for (const w of b.workers) {
      if (w.tabId != null) { try { chrome.tabs.sendMessage(w.tabId, { action: 'stop' }, () => { void chrome.runtime.lastError; }); } catch { /* */ } }
      if (w.created && w.windowId != null) { try { await chrome.windows.remove(w.windowId); } catch { /* */ } }
    }
  }
  await setBatch(null);
  seenUrls.clear();
  try { chrome.alarms.clear(HB_ALARM); } catch { /* */ }
  await refreshBadge();
}

// Watchdog: recover any worker whose step stalled (missed event or revived SW).
async function batchWatchdog() {
  const b = await getBatch();
  if (!b || !b.active) { try { chrome.alarms.clear(HB_ALARM); } catch { /* */ } return; }
  const now = tsNow();
  for (const w of b.workers) {
    const age = now - (w.ts || 0);
    if (w.stage === 'navigating' && age > 45000) driveWorker(w.id);          // nav/complete missed → re-issue
    else if (w.stage === 'scraping' && age > 240000) advanceWorker(w.tabId); // scrape stuck >4min → skip item
    else if (w.stage === 'init' && age > 20000) driveWorker(w.id);           // missed advance → re-drive
  }
}

// persistent listeners (re-registered automatically when the SW restarts)
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') onBatchTabComplete(tabId, tab && tab.url); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HB_ALARM) batchWatchdog(); });

// ---------- CSV export ----------
const COLUMNS = [
  ['name', 'Business'], ['category', 'Category'], ['rating', 'Rating'], ['reviewCount', 'Reviews'],
  ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['websiteStatus', 'Website Status'],
  ['leadScore', 'Lead Score'], ['leadTemperature', 'Temperature'], ['opportunityScore', 'Opportunity Score'],
  ['topPitch', 'Top Pitch'], ['address', 'Address'], ['lat', 'Lat'], ['lng', 'Lng'], ['mapsUrl', 'Maps URL'],
];
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function buildCsv({ query, onlyNoWebsite } = {}) {
  const p = await getProjects();
  let rows = (query && p[query]) ? Object.values(p[query].records)
    : Object.values(p).flatMap((proj) => Object.values(proj.records));
  if (onlyNoWebsite) rows = rows.filter((r) => NO_SITE.has(r.websiteStatus));
  rows.sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0));
  const header = COLUMNS.map((c) => c[1]).join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvEscape(r[c[0]])).join(',')).join('\n');
  return { csv: header + '\n' + body, count: rows.length };
}

// ---------- messaging ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tid = sender && sender.tab && sender.tab.id;
    switch (msg.type) {
      case 'setTabQuery': {
        if (tid != null && msg.query) { tabQuery[tid] = msg.query; await ensureProject(msg.query); }
        sendResponse({ ok: true });
        break;
      }
      case 'scrapeStart': {
        activeQuery = (msg.query || '').trim() || `search-${new Date().toISOString().slice(0, 16)}`;
        if (tid != null) tabQuery[tid] = activeQuery;
        sessionFound = 0;
        await ensureProject(activeQuery);
        await refreshBadge();
        sendResponse({ ok: true, query: activeQuery });
        break;
      }
      case 'scrapeStop':
        sendResponse({ ok: true, found: sessionFound });
        break;
      case 'scrapeDone':
        onScrapeDoneBatch(tid);
        sendResponse({ ok: true });
        break;
      // Enqueue a batch (a group of searches). Used by the popup "Run batch" and
      // the dashboard batch modal. They run one after another in the queue.
      case 'batchStart':
      case 'batchEnqueue': {
        const items = buildItems(msg.prefix, msg.middles, msg.suffix, msg.populations);
        if (!items.length) { sendResponse({ ok: false, error: 'no-items' }); break; }
        const label = msg.label || [
          (msg.prefix || '').trim(),
          '{' + (msg.middles || []).map((m) => (m || '').trim()).filter(Boolean).join(', ') + '}',
          (msg.suffix || '').trim(),
        ].filter((x) => x && x !== '{}').join(' ');
        await enqueueBatch({ id: batchId(), label, items });
        sendResponse({ ok: true, count: items.length, queued: true });
        break;
      }
      case 'batchStartQueue': {
        sendResponse(await startQueue(msg.tabId));
        break;
      }
      case 'getBatchMode': {
        sendResponse({ mode: await getBatchMode() });
        break;
      }
      case 'setBatchMode': {
        await chrome.storage.local.set({ [SKEY]: msg.mode === 'stream' ? 'stream' : 'local' });
        sendResponse({ ok: true });
        break;
      }
      case 'getConcurrency': {
        sendResponse({ concurrency: await getConcurrency() });
        break;
      }
      case 'setConcurrency': {
        const n = Math.max(1, Math.min(10, parseInt(msg.concurrency, 10) || DEFAULT_CONCURRENCY));
        await chrome.storage.local.set({ [CKEY]: n });
        sendResponse({ ok: true, concurrency: n });
        break;
      }
      // Current-batch progress (popup + on-page banner).
      case 'batchStatus': {
        const b = await getBatch();
        if (b && b.active && b.queue.length) {
          const running = (b.workers || []).filter((w) => w.batchId);
          const totalItems = b.queue.reduce((s, x) => s + x.items.length, 0);
          const doneItems = b.queue.reduce((s, x) => s + (x.status === 'done' ? x.items.length : (x.itemIndex || 0)), 0);
          const pendingBatches = b.queue.filter((x) => x.status === 'pending').length;
          let current = '', next = '', batchLabel = '';
          const w0 = running[0];
          if (w0) { const bt = b.queue.find((x) => x.id === w0.batchId); if (bt) { const it = bt.items[bt.itemIndex]; current = it ? it.query : ''; batchLabel = bt.label; const nx = bt.items[bt.itemIndex + 1]; next = nx ? nx.query : ''; } }
          sendResponse({
            active: true, stage: 'scraping', mode: b.mode || 'local', streamSynced: b.streamSynced || 0,
            workers: (b.workers || []).length, running: running.length,
            current, next, batchLabel, queuedBatches: pendingBatches,
            index: doneItems, total: totalItems,
          });
        } else { sendResponse({ active: false }); }
        break;
      }
      // Full queue view for the dashboard batch modal.
      case 'batchQueue': {
        const b = await getBatch();
        if (b && b.queue && b.queue.length) {
          sendResponse({
            active: !!b.active, mode: b.mode || 'local', streamSynced: b.streamSynced || 0,
            workers: (b.workers || []).length,
            queue: b.queue.map((bt) => ({
              id: bt.id, label: bt.label, count: bt.items.length,
              status: bt.status || 'pending',
              running: bt.status === 'running',
              currentQuery: (bt.status === 'running' && bt.items[bt.itemIndex]) ? bt.items[bt.itemIndex].query : '',
              doneInBatch: bt.itemIndex || 0,
              items: bt.items.map((it) => ({ q: it.query, a: it.area || it.query })),
            })),
          });
        } else { sendResponse({ active: false, queue: [] }); }
        break;
      }
      // Remove a batch by id. If it's running, stop its worker's content and free
      // the worker to claim the next pending batch.
      case 'batchRemove': {
        const toDrive = await lockBatch(async () => {
          const b = await getBatch(); if (!b || !b.queue) return null;
          const bt = b.queue.find((x) => x.id === msg.id); if (!bt) return null;
          let drive = null;
          if (bt.status === 'running') {
            const w = (b.workers || []).find((x) => x.id === bt.workerId);
            if (w) { if (w.tabId != null) { try { chrome.tabs.sendMessage(w.tabId, { action: 'stop' }, () => { void chrome.runtime.lastError; }); } catch { /* */ } } w.batchId = null; w.stage = 'init'; w.ts = tsNow(); drive = w.id; }
          }
          b.queue = b.queue.filter((x) => x.id !== msg.id);
          await setBatch(b);
          return drive;
        });
        if (toDrive != null) driveWorker(toDrive);
        sendResponse({ ok: true });
        break;
      }
      // Reorder the PENDING batches (which un-started one gets claimed next);
      // running/done batches keep their relative order.
      case 'batchReorderQueue': {
        await lockBatch(async () => {
          const b = await getBatch(); if (!b || !b.queue || !b.queue.length) return;
          const order = Array.isArray(msg.order) ? msg.order : [];
          const byId = new Map(b.queue.map((bt) => [bt.id, bt]));
          const out = [];
          for (const bt of b.queue) if (bt.status !== 'pending') { out.push(bt); byId.delete(bt.id); }
          for (const id of order) { const bt = byId.get(id); if (bt && bt.status === 'pending') { out.push(bt); byId.delete(id); } }
          for (const bt of byId.values()) out.push(bt);
          b.queue = out;
          await setBatch(b);
        });
        sendResponse({ ok: true });
        break;
      }
      case 'batchStop':
      case 'batchStopAll': {
        await stopAllBatches();
        sendResponse({ ok: true });
        break;
      }
      case 'getStats': {
        if (msg.query) activeQuery = msg.query;
        const p = await getProjects();
        const proj = activeQuery ? p[activeQuery] : null;
        sendResponse(Object.assign({ query: activeQuery, sessionFound }, projectStats(proj)));
        break;
      }
      case 'getProjects': {
        const p = await getProjects();
        sendResponse(Object.values(p).map((proj) =>
          Object.assign({ query: proj.query, name: proj.name, createdAt: proj.createdAt, folderId: proj.folderId || null }, projectStats(proj))));
        break;
      }
      case 'getFolders': {
        const f = await getFolders();
        sendResponse(Object.values(f));
        break;
      }
      case 'createFolder': {
        const f = await getFolders();
        const id = newId('f_');
        f[id] = { id, name: (msg.name || 'New folder').trim(), createdAt: new Date().toISOString(), collapsed: true };
        await setFolders(f);
        sendResponse({ ok: true, id });
        break;
      }
      case 'renameFolder': {
        const f = await getFolders();
        if (f[msg.id] && msg.name && msg.name.trim()) { f[msg.id].name = msg.name.trim(); await setFolders(f); }
        sendResponse({ ok: true });
        break;
      }
      case 'setFolderCollapsed': {
        const f = await getFolders();
        if (f[msg.id]) { f[msg.id].collapsed = !!msg.collapsed; await setFolders(f); }
        sendResponse({ ok: true });
        break;
      }
      case 'deleteFolder': {
        const f = await getFolders();
        delete f[msg.id];
        await setFolders(f);
        // its projects fall back to ungrouped (not deleted)
        const p = await getProjects();
        for (const proj of Object.values(p)) if (proj.folderId === msg.id) delete proj.folderId;
        await setProjects(p);
        sendResponse({ ok: true });
        break;
      }
      case 'moveProjects': {
        const p = await getProjects();
        for (const q of (msg.queries || [])) {
          if (p[q]) { if (msg.folderId) p[q].folderId = msg.folderId; else delete p[q].folderId; }
        }
        await setProjects(p);
        sendResponse({ ok: true });
        break;
      }
      case 'renameProjects': {
        const p = await getProjects();
        if (msg.name && msg.name.trim()) {
          for (const q of (msg.queries || [])) if (p[q]) p[q].name = msg.name.trim();
          await setProjects(p);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'deleteProjects': {
        const p = await getProjects();
        for (const q of (msg.queries || [])) { delete p[q]; if (activeQuery === q) activeQuery = ''; }
        await setProjects(p);
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      case 'getRecords': {
        const p = await getProjects();
        const collect = (proj) => Object.entries(proj.records).map(([k, r]) =>
          Object.assign({ _project: proj.query, _key: k }, r));
        sendResponse((msg.query && p[msg.query]) ? collect(p[msg.query])
          : Object.values(p).flatMap(collect));
        break;
      }
      case 'getDuplicates': {
        // Compute duplicate groups in the BACKGROUND so we don't ship every
        // record to the dashboard (huge at scale). Identity: cid → placeId → name+coords.
        const p = await getProjects();
        const groups = new Map();
        for (const proj of Object.values(p)) {
          for (const [k, r] of Object.entries(proj.records || {})) {
            const id = r.cid ? 'cid:' + r.cid
              : r.placeId ? 'pid:' + r.placeId
              : 'nm:' + String(r.name || '').toLowerCase().trim() + '|' + (typeof r.lat === 'number' ? r.lat.toFixed(4) : '') + '|' + (typeof r.lng === 'number' ? r.lng.toFixed(4) : '');
            let g = groups.get(id);
            if (!g) { g = []; groups.set(id, g); }
            g.push({ _project: proj.query, _key: k, name: r.name, category: r.category, rating: r.rating, reviewCount: r.reviewCount, checked: r.checked, address: r.address });
          }
        }
        const dupes = [...groups.values()].filter((g) => g.length > 1)
          .sort((a, b) => b.length - a.length || String(a[0].name || '').localeCompare(String(b[0].name || '')))
          .slice(0, 2000);
        sendResponse(dupes);
        break;
      }
      case 'deleteRecord': {
        const p = await getProjects();
        const proj = p[msg.query];
        if (proj && proj.records[msg.key]) {
          delete proj.records[msg.key];
          await setProjects(p);
          await refreshBadge();
        }
        sendResponse({ ok: true });
        break;
      }
      case 'deleteRecords': {
        // bulk: [{query, key}, ...] — single storage write
        const p = await getProjects();
        let n = 0;
        for (const it of (msg.items || [])) {
          const proj = p[it.query];
          if (proj && proj.records[it.key]) { delete proj.records[it.key]; n++; }
        }
        if (n) { await setProjects(p); await refreshBadge(); }
        sendResponse({ ok: true, deleted: n });
        break;
      }
      case 'setChecked': {
        const p = await getProjects();
        const proj = p[msg.query];
        if (proj && proj.records[msg.key]) {
          proj.records[msg.key].checked = !!msg.checked;
          await setProjects(p);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'export': {
        const { csv, count } = await buildCsv({ query: msg.query, onlyNoWebsite: msg.onlyNoWebsite });
        const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        await chrome.downloads.download({ url: dataUrl, filename: `gridleads-${stamp}.csv`, saveAs: true });
        sendResponse({ ok: true, count });
        break;
      }
      case 'renameProject': {
        const p = await getProjects();
        if (p[msg.query] && msg.name && msg.name.trim()) {
          p[msg.query].name = msg.name.trim();
          await setProjects(p);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'exportJson': {
        // Build the portable bundle and return it; the dashboard page does the
        // actual download via a Blob (no data:-URL size limit).
        const p = await getProjects();
        const f = await getFolders();
        let queries = msg.queries;
        if (msg.folderId) queries = Object.values(p).filter((pr) => pr.folderId === msg.folderId).map((pr) => pr.query);
        if (!queries || !queries.length) queries = Object.keys(p); // default: everything
        const outProjects = {};
        const folderIds = new Set();
        for (const q of queries) if (p[q]) { outProjects[q] = p[q]; if (p[q].folderId) folderIds.add(p[q].folderId); }
        const outFolders = {};
        for (const id of folderIds) if (f[id]) outFolders[id] = f[id];
        if (msg.folderId && f[msg.folderId]) outFolders[msg.folderId] = f[msg.folderId];
        const bundle = { gridleads: 1, exportedAt: new Date().toISOString(), folders: outFolders, projects: outProjects };
        const hint = msg.folderId && f[msg.folderId] ? f[msg.folderId].name
          : (queries.length === 1 ? queries[0] : `${queries.length}-projects`);
        sendResponse({ ok: true, bundle, hint });
        break;
      }
      case 'importJson': {
        // Merge an exported JSON back in (union of records; never deletes).
        const incoming = msg.data;
        if (!incoming || typeof incoming !== 'object' || !incoming.projects) { sendResponse({ ok: false, error: 'bad-file' }); break; }
        const p = await getProjects();
        const f = await getFolders();
        for (const [id, fol] of Object.entries(incoming.folders || {})) if (!f[id]) f[id] = fol;
        let addedProjects = 0, mergedRecords = 0;
        for (const [q, pr] of Object.entries(incoming.projects)) {
          if (!pr || typeof pr !== 'object') continue;
          if (!p[q]) { p[q] = pr; addedProjects++; mergedRecords += Object.keys(pr.records || {}).length; }
          else {
            const recs = { ...p[q].records };
            for (const [k, r] of Object.entries(pr.records || {})) if (!recs[k]) { recs[k] = r; mergedRecords++; }
            p[q] = { ...p[q], records: recs };
          }
        }
        await setFolders(f);
        await setProjects(p);
        await refreshBadge();
        sendResponse({ ok: true, addedProjects, mergedRecords });
        break;
      }
      case 'deleteProject': {
        const p = await getProjects();
        delete p[msg.query];
        if (activeQuery === msg.query) activeQuery = '';
        await setProjects(p);
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      case 'clearAll': {
        await setProjects({});
        activeQuery = '';
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // async
});
