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
const BKEY = 'gridleads_batch';   // { tabId, active, stage, ts, itemIndex, mode, pendingDeleteQueries, streamSynced, queue:[{id,label,items}] }
const HB_ALARM = 'gl_batch_hb';
const SKEY = 'gridleads_batch_mode'; // 'local' (keep all in browser) | 'stream' (sync each batch to DB, free storage)
const SYNC_BASE = 'https://gridleads-wheat.vercel.app'; // deployed web app
const SYNC_CHUNK = 500;            // leads per request (well under Vercel's 4.5MB body limit)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBatchMode() { const o = await chrome.storage.local.get(SKEY); return o[SKEY] === 'stream' ? 'stream' : 'local'; }

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

// Stream mode: as soon as a single search (project) finishes, push it to the DB,
// then delete the PREVIOUS synced project from the browser. Works for any batch
// size — incl. one giant State batch — so storage stays bounded and the DB fills
// up incrementally instead of only at the very end.
async function streamSyncItem(query) {
  if (!query) return;
  try { await syncProjectsToDb([query]); }
  catch (e) { console.warn('[GridLeads] DB sync failed, keeping local copy:', e && e.message); return; }
  const b = await getBatch();
  if (!b) return; // queue already finished — leave the last project locally
  await deleteLocalProjects((b.pendingDeleteQueries || []).filter((q) => q !== query));
  b.pendingDeleteQueries = [query]; // prune this one once the next project syncs
  b.streamSynced = (b.streamSynced || 0) + 1;
  await setBatch(b);
}

// Advance past the current item; in stream mode sync the just-finished project to
// the DB + prune the previous one. Returns true if the queue continues.
async function finishItemAndMaybeBatch(b) {
  const cur = b.queue[0];
  const justDone = cur && cur.items[b.itemIndex] ? cur.items[b.itemIndex].query : null;
  b.itemIndex += 1;
  if (cur && b.itemIndex >= cur.items.length) { b.queue.shift(); b.itemIndex = 0; }
  b.stage = 'init'; b.ts = tsNow();
  await setBatch(b);
  if (b.mode === 'stream') await streamSyncItem(justDone);
  if (!b.queue.length) { await finishBatch(); return false; }
  return true;
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
async function getBatch() {
  const o = await chrome.storage.local.get(BKEY);
  const b = o[BKEY] || null;
  // discard any state from the old (pre-queue) engine so callers never crash on b.queue
  if (b && !Array.isArray(b.queue)) { await chrome.storage.local.remove(BKEY); return null; }
  return b;
}
async function setBatch(b) { if (b) await chrome.storage.local.set({ [BKEY]: b }); else await chrome.storage.local.remove(BKEY); }
const tsNow = () => Date.now();

async function resolveMapsTab(preferred) {
  const isMaps = (u) => typeof u === 'string' && u.startsWith('https://www.google.com/maps');
  // only trust `preferred` if it's actually a Maps tab (never the dashboard tab)
  if (preferred != null) {
    try { const t = await chrome.tabs.get(preferred); if (t && isMaps(t.url)) return preferred; } catch { /* */ }
  }
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.google.com/maps/*' });
    const pick = tabs.find((t) => t.active) || tabs[0];
    if (pick) return pick.id;
  } catch { /* */ }
  return null;
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

// Add a batch to the queue WITHOUT starting it (the user starts the queue from
// the popup). The Maps tab is resolved later, at start time.
async function enqueueBatch(batch, tabId) {
  let b = await getBatch();
  if (!b) b = { tabId: null, active: false, stage: 'init', ts: tsNow(), itemIndex: 0, queue: [] };
  const resolved = await resolveMapsTab(tabId);
  if (resolved != null) b.tabId = resolved;
  b.queue.push(batch);
  await setBatch(b);
  return true;
}

// Start processing the queue (from the popup). Resolves a Maps tab now.
async function startQueue(tabId) {
  const b = await getBatch();
  if (!b || !b.queue.length) return { ok: false, error: 'empty' };
  const tab = await resolveMapsTab(tabId != null ? tabId : b.tabId);
  if (tab == null) return { ok: false, error: 'no-tab' };
  b.tabId = tab;
  if (!b.active) {
    b.mode = await getBatchMode(); // fix the mode for the whole run
    if (!Array.isArray(b.pendingDeleteQueries)) b.pendingDeleteQueries = [];
    b.streamSynced = b.streamSynced || 0;
    b.active = true; b.stage = 'init'; b.ts = tsNow();
    await setBatch(b);
    try { chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch { /* */ }
    driveCurrent();
  } else {
    await setBatch(b);
  }
  return { ok: true };
}

async function driveCurrent() {
  const b = await getBatch();
  if (!b || !b.active) return;
  if (!b.queue.length) { await finishBatch(); return; }
  const cur = b.queue[0];
  if (b.itemIndex >= cur.items.length) { b.queue.shift(); b.itemIndex = 0; await setBatch(b); return driveCurrent(); }
  const it = cur.items[b.itemIndex];
  activeQuery = it.query;
  if (b.tabId != null) tabQuery[b.tabId] = it.query;
  seenUrls.clear();
  sessionFound = 0;
  await ensureProject(it.query, it.population);
  await refreshBadge();
  b.stage = 'navigating'; b.ts = tsNow(); await setBatch(b);
  // Bring the driven Maps tab to the FRONT so it actually scrapes (Chrome
  // throttles background tabs) and so the user watches the right tab.
  try {
    const t = await chrome.tabs.update(b.tabId, { url: it.url, active: true });
    if (t && t.windowId != null) { try { await chrome.windows.update(t.windowId, { focused: true }); } catch { /* */ } }
  } catch { /* */ }
  // → the tabs.onUpdated(complete) handler will start the scraper
}

async function onBatchTabComplete(tabId) {
  const b = await getBatch();
  if (!b || !b.active || b.tabId !== tabId || b.stage !== 'navigating') return;
  b.stage = 'scraping'; b.ts = tsNow(); await setBatch(b);
  await wait(2200); // let Maps render the results list
  await startContent(tabId);
}

async function onScrapeDoneBatch() {
  const b = await getBatch();
  if (!b || !b.active || b.stage !== 'scraping') return;
  await wait(1200); // let the last captures land
  if (await finishItemAndMaybeBatch(b)) driveCurrent();
}

async function finishBatch() {
  await setBatch(null);
  try { chrome.alarms.clear(HB_ALARM); } catch { /* */ }
  await refreshBadge();
}

async function batchWatchdog() {
  const b = await getBatch();
  if (!b || !b.active) { try { chrome.alarms.clear(HB_ALARM); } catch { /* */ } return; }
  const age = tsNow() - (b.ts || 0);
  if (b.stage === 'navigating' && age > 45000) { b.ts = tsNow(); await setBatch(b); driveCurrent(); }
  else if (b.stage === 'scraping' && age > 300000) { // scrape stuck >5min → skip on
    if (await finishItemAndMaybeBatch(b)) driveCurrent();
  }
}

// persistent listeners (re-registered automatically when the SW restarts)
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') onBatchTabComplete(tabId); });
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
        onScrapeDoneBatch();
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
        await enqueueBatch({ id: batchId(), label, items }, msg.tabId);
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
      // Current-batch progress (popup + on-page banner).
      case 'batchStatus': {
        const b = await getBatch();
        if (b && b.active && b.queue.length) {
          const cur = b.queue[0];
          const c = cur.items[b.itemIndex];
          const nxt = cur.items[b.itemIndex + 1];
          const remainingBatches = b.queue.length - 1;
          sendResponse({
            active: true, index: b.itemIndex, total: cur.items.length, stage: b.stage,
            current: c ? c.query : '', next: nxt ? nxt.query : '',
            batchLabel: cur.label, queuedBatches: remainingBatches,
            mode: b.mode || 'local', streamSynced: b.streamSynced || 0,
          });
        } else { sendResponse({ active: false }); }
        break;
      }
      // Full queue view for the dashboard batch modal.
      case 'batchQueue': {
        const b = await getBatch();
        if (b && b.queue && b.queue.length) {
          sendResponse({
            active: !!b.active, stage: b.stage, itemIndex: b.itemIndex,
            mode: b.mode || 'local', streamSynced: b.streamSynced || 0,
            queue: b.queue.map((bt, i) => ({
              id: bt.id, label: bt.label, count: bt.items.length,
              running: i === 0 && b.active,
              currentQuery: i === 0 ? (bt.items[b.itemIndex] ? bt.items[b.itemIndex].query : '') : '',
              doneInBatch: i === 0 ? b.itemIndex : 0,
              items: bt.items.map((it) => ({ q: it.query, a: it.area || it.query })),
            })),
          });
        } else { sendResponse({ active: false, queue: [] }); }
        break;
      }
      // Remove a batch from the queue by id (if it's the running one, advance).
      case 'batchRemove': {
        const b = await getBatch();
        if (b && b.queue) {
          const idx = b.queue.findIndex((x) => x.id === msg.id);
          if (idx === 0 && b.active) {
            // removing the currently-running batch → stop content + advance
            if (b.tabId != null) { try { chrome.tabs.sendMessage(b.tabId, { action: 'stop' }, () => { void chrome.runtime.lastError; }); } catch { /* */ } }
            b.queue.shift(); b.itemIndex = 0; b.stage = 'init'; b.ts = tsNow();
            await setBatch(b);
            if (!b.queue.length) await finishBatch(); else driveCurrent();
          } else if (idx >= 0) {
            // a queued (not-yet-running) batch — incl. index 0 when idle → just remove it
            b.queue.splice(idx, 1);
            if (!b.queue.length && !b.active) await setBatch(null);
            else await setBatch(b);
          }
        }
        sendResponse({ ok: true });
        break;
      }
      // Reorder the batches (cities) in the queue. The currently-running batch
      // always stays first (don't race the driver); the rest follow msg.order.
      case 'batchReorderQueue': {
        const b = await getBatch();
        if (b && b.queue && b.queue.length) {
          const order = Array.isArray(msg.order) ? msg.order : [];
          const byId = new Map(b.queue.map((bt) => [bt.id, bt]));
          const runningId = b.active ? b.queue[0].id : null;
          const next = [];
          if (runningId && byId.has(runningId)) { next.push(byId.get(runningId)); byId.delete(runningId); }
          for (const id of order) { if (id === runningId) continue; const bt = byId.get(id); if (bt) { next.push(bt); byId.delete(id); } }
          for (const bt of byId.values()) next.push(bt); // keep any not listed
          b.queue = next;
          await setBatch(b);
          sendResponse({ ok: true });
        } else { sendResponse({ ok: false }); }
        break;
      }
      case 'batchStop':
      case 'batchStopAll': {
        const b = await getBatch();
        const t = b && b.tabId;
        await setBatch(null);
        try { chrome.alarms.clear(HB_ALARM); } catch { /* */ }
        if (t != null) { try { chrome.tabs.sendMessage(t, { action: 'stop' }, () => { void chrome.runtime.lastError; }); } catch { /* */ } }
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
