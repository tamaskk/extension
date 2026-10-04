// GridLeads background service worker (MV3).
// Captures Google Maps /search protobuf responses, parses businesses reliably
// (incl. WEBSITE), scores them, and stores them grouped into PROJECTS (one per
// search query). Also builds CSV exports.

importScripts('../lib/scoring.js', '../lib/mapsParser.js', '../lib/emailFinder.js', '../lib/activityLog.js');
const glog = (e) => self.GridLeadsLog.add(e);

const PKEY = 'gridleads_projects'; // { [query]: { query, name, createdAt, folderId?, records: {dedupKey: rec} } }
const FKEY = 'gridleads_folders';  // { [id]: { id, name, createdAt, collapsed } }
// Must mirror scoring.js WEBSITELESS (the "no real website" statuses).
const NO_SITE = new Set(['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION']);

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

// Serialize every read-modify-write of the projects store (PKEY). Without this,
// concurrent captures from N parallel windows (chrome.webRequest.onCompleted is
// fire-and-forget) both read the same snapshot and the second setProjects()
// silently overwrites the first one's newly added leads. Same pattern as
// lockBatch, but for PKEY. EVERY getProjects->setProjects sequence must run
// inside lockProjects (never nest — it is a non-reentrant promise-chain mutex).
let _projLock = Promise.resolve();
function lockProjects(fn) { const p = _projLock.then(() => fn()); _projLock = p.then(() => {}, () => {}); return p; }

async function getFolders() { const o = await chrome.storage.local.get(FKEY); return o[FKEY] || {}; }
async function setFolders(f) { await chrome.storage.local.set({ [FKEY]: f }); }
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function ensureProject(query, population) {
  return lockProjects(async () => {
    const p = await getProjects();
    let changed = false;
    if (!p[query]) {
      p[query] = { query, name: query || 'Untitled search', createdAt: new Date().toISOString(), records: {} };
      changed = true;
      glog({ type: 'project.create', project: query, title: `New project: ${query}` });
    }
    if (population != null && population !== '' && p[query].population !== population) { p[query].population = population; changed = true; }
    if (changed) await setProjects(p);
  });
}

// Fields Maps can change between two scrapes of the same business — a re-scrape
// that alters one of these is recorded in the Changelog as old → new.
const TRACKED = ['name', 'category', 'rating', 'reviewCount', 'phone', 'website', 'websiteStatus', 'address'];
// Fields the scraper never produces (Maps has no email): a re-scrape must carry
// them over from the stored record instead of blanking them.
const KEEP = ['email', 'emails', 'emailSource', 'emailStatus', 'emailCheckedAt', 'emailError'];

// → { added, updated, todo:[{key,name,website}] }  (todo = needs an email lookup)
async function addRecords(query, records) {
  if (!records.length) return { added: 0, updated: 0, todo: [] };
  return lockProjects(async () => {
    const p = await getProjects();
    if (!p[query]) p[query] = { query, name: query || 'Untitled search', createdAt: new Date().toISOString(), records: {} };
    let added = 0, updated = 0;
    const fresh = [], changes = [], todo = [];
    for (const r of records) {
      const key = r.dedupKey || r.placeId || r.name;
      const existing = p[query].records[key];
      const scored = Object.assign({}, r, self.GridLeadsScoring.score(r));
      if (existing) {
        if (existing.checked) scored.checked = true; // preserve manual "Checked"
        for (const f of KEEP) if (existing[f] !== undefined && existing[f] !== '') scored[f] = existing[f];
        if (!scored.phone && existing.phone) scored.phone = existing.phone; // a phone found on the website
        if (existing.scrapedAt) scored.firstSeenAt = existing.firstSeenAt || existing.scrapedAt;
        const diff = {};
        for (const f of TRACKED) {
          const a = existing[f] == null ? '' : existing[f], b = scored[f] == null ? '' : scored[f];
          if (a !== b) diff[f] = [a, b];
        }
        if (Object.keys(diff).length) { updated++; changes.push({ key, name: scored.name, diff }); }
      } else {
        added++;
        fresh.push({ key, name: scored.name, category: scored.category, website: scored.website, phone: scored.phone, websiteStatus: scored.websiteStatus });
      }
      if (scored.websiteStatus === 'HAS_WEBSITE' && !scored.email && !scored.emailCheckedAt) todo.push({ key, name: scored.name, website: scored.website });
      p[query].records[key] = scored;
    }
    await setProjects(p);
    if (added) glog({ type: 'leads.capture', project: query, n: added, title: `+${added} new lead${added === 1 ? '' : 's'}`, data: { leads: fresh, total: Object.keys(p[query].records).length } });
    if (updated) glog({ type: 'leads.change', project: query, n: updated, title: `${updated} lead${updated === 1 ? '' : 's'} changed on re-scrape`, data: { changes } });
    return { added, updated, todo };
  });
}

// ---------- email lookup (Maps has no email → read it off the business website) ----------
const EKEY = 'gridleads_auto_email'; // false = don't look emails up while scraping (default: on)
async function getAutoEmail() { const o = await chrome.storage.local.get(EKEY); return o[EKEY] !== false; }

// Write lookup results onto the stored leads. Never overwrites an existing
// email/phone. Marks every checked lead (emailCheckedAt/emailStatus) so the
// next audit skips it. → the results that matched a stored lead, each with
// `saved` (did the email actually land).
async function applyEmailResults(query, results) {
  if (!results || !results.length) return [];
  return lockProjects(async () => {
    const p = await getProjects();
    const proj = p[query];
    if (!proj) return [];
    const at = new Date().toISOString();
    const applied = [];
    for (const r of results) {
      const rec = proj.records[r.key];
      if (!rec) continue;
      rec.emailCheckedAt = at;
      rec.emailStatus = r.status;
      if (r.status === 'error') rec.emailError = r.error || ''; else delete rec.emailError;
      let saved = false;
      if (r.status === 'found' && r.email && !rec.email) { rec.email = r.email; rec.emails = r.emails || [r.email]; rec.emailSource = r.source || ''; saved = true; }
      if (r.phone && !rec.phone) rec.phone = r.phone;
      applied.push(Object.assign({}, r, { name: r.name || rec.name, saved }));
    }
    if (applied.length) await setProjects(p);
    return applied;
  });
}

// Background queue used while scraping. In-memory on purpose: if the service
// worker dies the unchecked leads simply stay unchecked, and the Email audit
// page picks them up later.
const emailJobs = [];             // [{ project, key, name, website }]
const emailQueued = new Set();    // project|key — never look the same lead up twice
const emailPending = {};          // project -> jobs queued or in flight
const emailBuf = {};              // project -> results waiting to be written
let emailRunning = 0;
let emailFlushTimer = null;
const EMAIL_WORKERS = 10;
const EMAIL_FLUSH_MS = 3000;      // batch the writes: each one rewrites the whole lead store

function enqueueEmails(project, todo) {
  for (const t of todo || []) {
    const id = project + '|' + t.key;
    if (emailQueued.has(id)) continue;
    emailQueued.add(id);
    emailJobs.push({ project, key: t.key, name: t.name, website: t.website });
    emailPending[project] = (emailPending[project] || 0) + 1;
  }
  pumpEmails();
}
function pumpEmails() {
  while (emailRunning < EMAIL_WORKERS && emailJobs.length) {
    const job = emailJobs.shift();
    emailRunning++;
    self.GridLeadsEmail.lookup(job.website).then((res) => {
      (emailBuf[job.project] = emailBuf[job.project] || []).push(Object.assign({ key: job.key, name: job.name, website: job.website }, res));
    }).catch(() => {}).finally(() => {
      emailRunning--;
      emailQueued.delete(job.project + '|' + job.key);
      emailPending[job.project] = Math.max(0, (emailPending[job.project] || 1) - 1);
      if (!emailFlushTimer) emailFlushTimer = setTimeout(flushEmails, EMAIL_FLUSH_MS);
      pumpEmails();
    });
  }
}
async function flushEmails(only) {
  if (!only && emailFlushTimer) { clearTimeout(emailFlushTimer); emailFlushTimer = null; }
  for (const project of (only ? [only] : Object.keys(emailBuf))) {
    const batch = emailBuf[project];
    if (!batch || !batch.length) continue;
    delete emailBuf[project];
    try {
      const applied = await applyEmailResults(project, batch);
      await self.GridLeadsLog.logEmailResults(project, applied, 'scrape', 'browser');
    } catch (e) { console.warn('[GridLeads] email write failed:', e && e.message); }
  }
}
// Wait (bounded) until every queued lookup for a project has finished and been
// written, so a stream-mode sync uploads the leads WITH their emails.
async function emailIdle(project, capMs = 90000) {
  const t0 = Date.now();
  let tick = 0;
  while ((emailPending[project] || 0) > 0 && Date.now() - t0 < capMs) {
    await wait(400);
    if (++tick % 12 === 0) { try { await chrome.storage.local.get(EKEY); } catch { /* */ } } // extension-API call keeps the SW alive
  }
  // out of time → drop what is still queued for this project (the audit re-checks it later)
  if ((emailPending[project] || 0) > 0) {
    for (let i = emailJobs.length - 1; i >= 0; i--) if (emailJobs[i].project === project) { emailQueued.delete(project + '|' + emailJobs[i].key); emailJobs.splice(i, 1); }
    emailPending[project] = 0;
  }
  await flushEmails(project);
}

// Completeness report for the Email audit page: what is missing, how much, where.
function auditRow(proj) {
  const row = { query: proj.query, name: proj.name, total: 0, email: 0, todo: 0, checkedNone: 0, checkedError: 0, noSite: 0, noPhone: 0, noAddress: 0, noCategory: 0, noRating: 0 };
  for (const r of Object.values(proj.records || {})) {
    row.total++;
    if (!r.phone) row.noPhone++;
    if (!r.address) row.noAddress++;
    if (!r.category) row.noCategory++;
    if (r.rating == null || r.rating === '') row.noRating++;
    if (r.email) { row.email++; continue; }
    if (r.websiteStatus !== 'HAS_WEBSITE' || !self.GridLeadsEmail.crawlable(r.website)) row.noSite++;
    else if (!r.emailCheckedAt) row.todo++;
    else if (r.emailStatus === 'error') row.checkedError++;
    else row.checkedNone++;
  }
  return row;
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

// In-flight captureSearch re-fetches per tab. Stream mode uses this to drain
// before sync+delete so the last page's capture never races the delete.
const inFlightCaptures = {};   // tabId -> count
let zeroParseStreak = 0;       // consecutive /search responses that parsed to 0 places

// Resolve the search a worker tab is currently on, from PERSISTED batch state.
// In-memory tabQuery/activeQuery die with the service worker; after an SW restart
// this keeps captures attributed to the right project instead of the fallback bucket.
async function queryForTab(tabId) {
  if (tabId == null) return '';
  try {
    const b = await getBatch();
    if (!b || !Array.isArray(b.workers)) return '';
    const w = b.workers.find((x) => x.tabId === tabId);
    if (!w || !w.batchId) return '';
    const bt = b.queue.find((x) => x.id === w.batchId);
    if (!bt) return '';
    const it = bt.items[bt.itemIndex];
    return (it && it.query) || '';
  } catch { return ''; }
}

async function captureSearch(url, tabId) {
  inFlightCaptures[tabId] = (inFlightCaptures[tabId] || 0) + 1;
  try {
    const res = await fetch(url, { credentials: 'include' });
    const text = await res.text();
    const records = self.GridLeadsParser.parseSearchResponse(text);
    if (!records.length) {
      zeroParseStreak++;
      console.warn('[GridLeads] /search captured but 0 parsed (' + zeroParseStreak + ' in a row). diag=', self.__gridleadsDebug, 'len=', text.length);
      // Surface a persistent parser blackout (Google likely changed the response
      // shape) so an overnight run doesn't "succeed" with zero data unnoticed.
      if (zeroParseStreak >= 5) {
        try { chrome.action.setBadgeText({ text: '!' }); chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); } catch { /* */ }
        try { chrome.action.setTitle({ title: `GridLeads: parser returned 0 leads for the last ${zeroParseStreak} pages — Google may have changed format.` }); } catch { /* */ }
      }
      return;
    }
    if (zeroParseStreak >= 5) { try { chrome.action.setTitle({ title: 'GridLeads' }); } catch { /* */ } }
    zeroParseStreak = 0; // recovered
    const q = tabQuery[tabId] || (await queryForTab(tabId)) || parseQ(url) || activeQuery || 'Google Maps leads';
    if (!activeQuery) activeQuery = q;
    const { added, todo } = await addRecords(q, records);
    sessionFound += added;
    await refreshBadge();
    if (todo.length && await getAutoEmail()) enqueueEmails(q, todo);
    console.log(`[GridLeads] captured ${records.length} (+${added} new) -> "${q}"`);
  } catch (e) {
    console.log('[GridLeads] capture error:', e && e.message);
  } finally {
    inFlightCaptures[tabId] = Math.max(0, (inFlightCaptures[tabId] || 1) - 1);
  }
}

// Wait until a tab has no in-flight capture re-fetches (bounded). Runs BEFORE
// stream sync+delete, while tabQuery[tabId] still points at the finished search,
// so any last-page capture lands in the right project before it is synced away.
async function drainCaptures(tabId, capMs = 5000) {
  const t0 = Date.now();
  while ((inFlightCaptures[tabId] || 0) > 0 && Date.now() - t0 < capMs) await wait(150);
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
const SYNC_BASE = 'https://gridleads-wheat.vercel.app'; // deployed web app
const SYNC_CHUNK = 500;            // leads per request (well under Vercel's 4.5MB body limit)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBatchMode() { const o = await chrome.storage.local.get(SKEY); return o[SKEY] === 'stream' ? 'stream' : 'local'; }

// POST one sync chunk to the web app. Gzipped (~5-8× smaller) — the raw JSON
// uploads were burning Vercel's Fast Origin Transfer quota.
async function postSync(body) {
  const json = JSON.stringify(body);
  let payload = json;
  let headers = { 'Content-Type': 'application/json' };
  try {
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      payload = await new Response(stream).blob();
      headers = { 'Content-Type': 'application/octet-stream', 'x-gl-gzip': '1' };
    }
  } catch { payload = json; headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch(SYNC_BASE + '/api/sync', { method: 'POST', headers, body: payload });
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
  const changed = await lockProjects(async () => {
    const projects = await getProjects();
    let ch = false;
    for (const q of queries) if (projects[q]) { delete projects[q]; ch = true; }
    if (ch) await setProjects(projects);
    return ch;
  });
  if (changed) await refreshBadge();
}

// Stream mode: as soon as a single search finishes, push it to the DB, then drop
// it from local storage so the browser cache stays bounded (parallel-safe — each
// finished project is independent).
async function streamSyncItem(query) {
  if (!query) return;
  let n = 0, emails = 0;
  try {
    const p = (await getProjects())[query];
    if (p) { const rows = Object.values(p.records || {}); n = rows.length; emails = rows.filter((r) => r.email).length; }
    await syncProjectsToDb([query]);
  } catch (e) {
    console.warn('[GridLeads] DB sync failed, keeping local copy:', e && e.message);
    glog({ type: 'sync.error', project: query, title: `Stream sync failed — kept in browser (${(e && e.message) || 'error'})`, data: { leads: n } });
    return;
  }
  await deleteLocalProjects([query]);
  glog({ type: 'sync.stream', project: query, n, title: `Synced to database: ${n} lead${n === 1 ? '' : 's'} (${emails} with email), freed from browser`, data: { leads: n, emails } });
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const win = await chrome.windows.create({ url: 'https://www.google.com/maps', type: 'normal', focused: idx === 0, left, top, width: w, height: h });
      let tabId = (win && win.tabs && win.tabs[0]) ? win.tabs[0].id : null;
      if (tabId == null && win && win.id != null) { try { const ts = await chrome.tabs.query({ windowId: win.id }); if (ts && ts[0]) tabId = ts[0].id; } catch { /* */ } }
      if (tabId != null) return { windowId: win.id, tabId };
    } catch (e) { console.warn('[GridLeads] window create failed (attempt ' + (attempt + 1) + '):', e && e.message); }
    await wait(700);
  }
  return null;
}

// Open windows until the number of LIVE workers reaches the target (concurrency,
// capped by remaining work). Patient + retrying, so Chrome's burst-limit on rapid
// window.create calls (and a killed-then-revived SW) can't permanently cap us
// below the requested count. Called at start AND from the watchdog to top up.
let _opening = false;
// In-memory guard so a double-click (two batchStartQueue/batchStartAdopt messages)
// can't both pass the "already running?" pre-check and each reset workers=[] after
// the other already opened windows, orphaning them. Only user actions call these,
// all in this one SW, so an in-memory flag is sufficient (and is irrelevant across
// SW restarts, which never happen mid-start-click).
let _startingQueue = false;
async function topUpWorkers(reuseTabId) {
  if (_opening) return;
  _opening = true;
  try {
    let fails = 0;
    for (let guard = 0; guard < 16; guard++) {
      const b = await getBatch();
      if (!b || !b.active) break;
      const remaining = b.queue.filter((x) => x.status === 'pending' || x.status === 'running').length;
      const live = b.workers.filter((w) => w.stage !== 'done').length;
      const want = Math.min(b.concurrency || DEFAULT_CONCURRENCY, remaining);
      if (remaining === 0 || live >= want) break;
      if (fails >= 3) break; // give up for now; the watchdog will retry the rest in ~30s
      const idx = b.workers.length;
      let windowId = null, tabId = null, created = false;
      if (idx === 0 && await isMapsTab(reuseTabId)) {
        tabId = reuseTabId; try { const t = await chrome.tabs.get(tabId); windowId = t.windowId; } catch { /* */ }
      } else {
        const win = await openWorkerWindow(idx, want);
        if (win) { windowId = win.windowId; tabId = win.tabId; created = true; }
      }
      if (tabId == null) { fails++; await wait(1000); continue; } // create denied → let the burst-limit reset; watchdog retries later
      fails = 0;
      const wid = idx;
      await lockBatch(async () => { const bb = await getBatch(); if (!bb || !bb.active) return; bb.workers.push({ id: wid, windowId, tabId, created, batchId: null, stage: 'init', ts: tsNow() }); await setBatch(bb); });
      driveWorker(wid); // start this window scraping right away
      await wait(800);  // gap before opening the next
    }
  } finally { _opening = false; }
}

// Start processing the queue with N parallel windows (one batch each).
async function startQueue(reuseTabId) {
  if (_startingQueue) return { ok: true, already: true };
  _startingQueue = true;
  try {
    const b0 = await getBatch();
    if (!b0 || !b0.queue.length) return { ok: false, error: 'empty' };
    if (b0.active && Array.isArray(b0.workers) && b0.workers.some((w) => w.stage !== 'done')) return { ok: true }; // already running
    // (active but no live workers = a stale/broken run → fall through and (re)start it)

    const conc = await lockBatch(async () => {
      const b = await getBatch(); if (!b) return 0;
      b.active = true; b.mode = await getBatchMode(); b.streamSynced = b.streamSynced || 0;
      b.concurrency = DEFAULT_CONCURRENCY; // fixed number of parallel windows
      for (const x of b.queue) if (x.status === 'running') { x.status = 'pending'; x.workerId = null; } // recover stale
      b.workers = [];
      const pending = b.queue.filter((x) => x.status === 'pending').length;
      if (!pending) { await setBatch(null); return 0; }
      await setBatch(b);
      return Math.min(b.concurrency || DEFAULT_CONCURRENCY, pending);
    });
    if (!conc) return { ok: false, error: 'empty' };
    try { chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch { /* */ }

    // Open the windows (each starts scraping as soon as it opens). The watchdog
    // keeps topping up toward the target if Chrome throttled some creates.
    await topUpWorkers(reuseTabId);
    const fin = await getBatch();
    if (fin && fin.active && (!fin.workers || !fin.workers.length)) { await stopAllBatches(); return { ok: false, error: 'no-window' }; }
    return { ok: true };
  } finally { _startingQueue = false; }
}

// ── manual "adopt my open windows" mode ────────────────────────────────────
// Instead of fighting Chrome's windows.create throttle (which caps us at ~2 windows
// on constrained machines), the user opens their OWN Chrome windows and we claim
// every open Google Maps window — plus any blank/new-tab window, which we navigate
// to Maps — as a worker. The tab the user is actively looking at is never claimed.
// No windows.create is ever called, so there is nothing to throttle.
async function listAdoptableTabs() {
  let all = [];
  try { all = await chrome.tabs.query({}); } catch { return []; }
  let focusedActiveTabId = null;
  try { const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (act) focusedActiveTabId = act.id; } catch { /* */ }
  const byWin = {};
  for (const t of all) (byWin[t.windowId] = byWin[t.windowId] || []).push(t);
  const isMaps = (u) => typeof u === 'string' && u.startsWith('https://www.google.com/maps');
  const isBlank = (u) => !u || u === 'about:blank' || u.indexOf('chrome://newtab') === 0 || u.indexOf('chrome://new-tab-page') === 0;
  const out = [];
  for (const t of all) {
    if (t.id == null || t.windowId == null || t.id === focusedActiveTabId) continue; // never grab the tab you're looking at
    if (isMaps(t.url)) { out.push({ tabId: t.id, windowId: t.windowId, navigate: false }); continue; }
    // a blank / new-tab page that is the ONLY tab in its window = a fresh empty window
    if (isBlank(t.url || t.pendingUrl) && (byWin[t.windowId] || []).length === 1) out.push({ tabId: t.id, windowId: t.windowId, navigate: true });
  }
  return out;
}

// Push one adopted worker (created:false → we never close the user's window) and drive it.
async function adoptTab(tg) {
  const id = await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return null;
    if (b.workers.some((w) => w.tabId === tg.tabId && w.stage !== 'done')) return null; // already a live worker
    const nid = b.workers.length;
    b.workers.push({ id: nid, windowId: tg.windowId, tabId: tg.tabId, created: false, batchId: null, stage: 'init', ts: tsNow() });
    await setBatch(b);
    return nid;
  });
  if (id == null) return;
  if (tg.navigate) { try { await chrome.tabs.update(tg.tabId, { url: 'https://www.google.com/maps' }); } catch { /* */ } }
  driveWorker(id);
}

// Start the queue by adopting the user's already-open windows (no windows.create).
async function isLiveTab(id) { if (id == null) return false; try { await chrome.tabs.get(id); return true; } catch { return false; } }

async function startQueueAdopt() {
  if (_startingQueue) return { ok: true, already: true };
  _startingQueue = true;
  try {
    const b0 = await getBatch();
    if (!b0 || !b0.queue.length) { console.warn('[GridLeads] adopt: no queue'); return { ok: false, error: 'empty' }; }
    const pending0 = b0.queue.filter((x) => x.status === 'pending' || x.status === 'running').length;
    if (!pending0) { console.warn('[GridLeads] adopt: queue has no pending batches (all done?)'); return { ok: false, error: 'empty' }; }
    // Already running? Only believe it if at least one worker's tab is actually alive.
    // A stale run (dead service worker / closed windows) left active:true behind → restart.
    if (b0.active && Array.isArray(b0.workers) && b0.workers.length) {
      let alive = 0;
      for (const w of b0.workers) { if (w.stage !== 'done' && await isLiveTab(w.tabId)) alive++; }
      if (alive > 0) { console.log('[GridLeads] adopt: already running with ' + alive + ' live worker(s)'); return { ok: true, already: true, adopted: alive }; }
      console.warn('[GridLeads] adopt: stale run detected (active but 0 live workers) → restarting');
    }
    const targets = await listAdoptableTabs();
    console.log('[GridLeads] adopt: found ' + targets.length + ' adoptable window(s), queue pending=' + pending0);
    if (!targets.length) return { ok: false, error: 'no-maps' };
    const mode = await getBatchMode();
    await lockBatch(async () => {
      const b = await getBatch(); if (!b) return;
      b.active = true; b.adopt = true; b.mode = mode; b.streamSynced = b.streamSynced || 0;
      b.concurrency = targets.length;
      for (const x of b.queue) if (x.status === 'running') { x.status = 'pending'; x.workerId = null; } // recover stale
      b.workers = [];
      await setBatch(b);
    });
    try { chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch { /* */ }
    console.log('[GridLeads] adopting ' + targets.length + ' open window(s)');
    for (const tg of targets) { await adoptTab(tg); await wait(300); } // small stagger between drives
    const fin = await getBatch();
    if (fin && fin.active && (!fin.workers || !fin.workers.length)) { await stopAllBatches(); return { ok: false, error: 'no-maps' }; }
    return { ok: true, adopted: (fin && fin.workers) ? fin.workers.length : 0 };
  } finally { _startingQueue = false; }
}

// Watchdog hook (adopt mode): pick up any window the user opens mid-run.
async function rescanAdopt() {
  if (_opening) return;
  _opening = true;
  try {
    const b = await getBatch();
    if (!b || !b.active || !b.adopt) return;
    if (b.queue.filter((x) => x.status === 'pending' || x.status === 'running').length === 0) return;
    const have = new Set(b.workers.map((w) => w.tabId)); // every known worker tab (incl. done) → no re-adopt churn / unbounded growth
    for (const tg of await listAdoptableTabs()) {
      if (have.has(tg.tabId)) continue;
      await adoptTab(tg);
      await wait(300);
    }
  } finally { _opening = false; }
}

// A worker's window/tab was closed by the user → end that worker and put its
// in-flight batch back in the queue (itemIndex kept, so another window resumes it).
async function onWorkerTabClosed(tabId) {
  await lockBatch(async () => {
    const b = await getBatch(); if (!b || !b.active) return;
    const w = b.workers.find((x) => x.tabId === tabId); if (!w || w.stage === 'done') return;
    if (w.batchId) { const bt = b.queue.find((x) => x.id === w.batchId); if (bt && bt.status === 'running') { bt.status = 'pending'; bt.workerId = null; } }
    w.stage = 'done'; w.batchId = null; w.ts = tsNow();
    await setBatch(b);
    console.log('[GridLeads] worker window closed → batch requeued (tab ' + tabId + ')');
  });
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
  const ok = await startContent(tabId);
  if (!ok) {
    // Content scraper never started (consent/interstitial page, injection blocked,
    // dead tab). Skip this item NOW (advanceWorker keeps any page-1 captures and
    // moves to the next search) instead of stalling ~4 min for the watchdog.
    console.warn('[GridLeads] startContent failed for tab ' + tabId + ' → skipping item');
    await advanceWorker(tabId);
  }
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
    await drainCaptures(tabId); // let the last page's capture land before sync+delete
    // Not awaited: the window moves on to its next search right away while this
    // finished project waits for its email lookups, then syncs and frees itself.
    (async () => {
      await emailIdle(info.justDone);
      await streamSyncItem(info.justDone);
      await lockBatch(async () => { const b = await getBatch(); if (b) { b.streamSynced = (b.streamSynced || 0) + 1; await setBatch(b); } });
    })().catch((e) => console.warn('[GridLeads] stream sync task failed:', e && e.message));
  }
  driveWorker(info.workerId);
}

async function onScrapeDoneBatch(tabId) {
  if (tabId == null) return;
  await wait(DONE_SETTLE); // let the last captures land
  await advanceWorker(tabId);
}

async function finishBatch() {
  glog({ type: 'batch.done', title: 'Batch run finished — queue empty' });
  await setBatch(null);
  seenUrls.clear();
  try { chrome.alarms.clear(HB_ALARM); } catch { /* */ }
  await refreshBadge();
}

// Stop everything: tell every worker's content to stop, close the windows we
// opened, and clear the run.
async function stopAllBatches() {
  const b = await getBatch();
  if (b && b.queue && b.queue.length) glog({ type: 'batch.stop', title: `Batch run stopped — ${b.queue.length} batch(es) cleared`, data: { batches: b.queue.map((x) => ({ label: x.label, done: x.itemIndex || 0, of: x.items.length })) } });
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
    if (w.stage === 'done') continue;
    // Reap a worker whose tab died (browser restart, or a tabs.onRemoved we
    // missed). Otherwise it counts as "live" forever: topUpWorkers won't open a
    // replacement (live >= want), and the stage checks below re-drive it into a
    // dead tab every tick → the whole run wedges. onWorkerTabClosed requeues its
    // in-flight batch item so a fresh/adopted window resumes it.
    if (!(await isLiveTab(w.tabId))) { await onWorkerTabClosed(w.tabId); continue; }
    const age = now - (w.ts || 0);
    if (w.stage === 'navigating' && age > 45000) driveWorker(w.id);          // nav/complete missed → re-issue
    else if (w.stage === 'scraping' && age > 240000) advanceWorker(w.tabId); // scrape stuck >4min → skip item
    else if (w.stage === 'init' && age > 20000) driveWorker(w.id);           // missed advance → re-drive
  }
  if (b.adopt) rescanAdopt(); // adopt-mode: pick up windows opened mid-run (never creates)
  else topUpWorkers();        // auto-create mode: open any windows Chrome throttled at start
}

// persistent listeners (re-registered automatically when the SW restarts)
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') onBatchTabComplete(tabId, tab && tab.url); });
chrome.tabs.onRemoved.addListener((tabId) => { onWorkerTabClosed(tabId); }); // adopted window closed → requeue its batch
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HB_ALARM) batchWatchdog(); });

// A browser restart or extension update drops the in-memory SW state, and an
// update also clears the HB_ALARM. If a batch was active, re-arm the watchdog and
// kick it once so the run recovers instead of freezing with no heartbeat.
async function resumeIfActive() {
  try {
    const b = await getBatch();
    if (b && b.active) {
      try { chrome.alarms.create(HB_ALARM, { periodInMinutes: 0.5 }); } catch { /* */ }
      batchWatchdog();
    }
  } catch { /* */ }
  try { await refreshBadge(); } catch { /* */ }
}
chrome.runtime.onStartup.addListener(resumeIfActive);
chrome.runtime.onInstalled.addListener(resumeIfActive);

// ---------- CSV export ----------
const COLUMNS = [
  ['name', 'Business'], ['category', 'Category'], ['rating', 'Rating'], ['reviewCount', 'Reviews'],
  ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['websiteStatus', 'Website Status'],
  ['leadScore', 'Lead Score'], ['leadTemperature', 'Temperature'], ['opportunityScore', 'Opportunity Score'],
  ['topPitch', 'Top Pitch'], ['address', 'Address'], ['lat', 'Lat'], ['lng', 'Lng'], ['mapsUrl', 'Maps URL'],
  ['emailSource', 'Email Source'],
];
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralize spreadsheet formula injection: a scraped business name/address that
  // starts with = + - @ (or tab/CR) would run as a live formula in Excel/Sheets.
  // Skip pure numbers so legitimate negative Lat/Lng values aren't turned into text.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
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
    try {
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
        glog({ type: 'batch.enqueue', n: items.length, title: `Batch queued: ${label} (${items.length} searches)`, data: { searches: items.map((it) => it.query) } });
        sendResponse({ ok: true, count: items.length, queued: true });
        break;
      }
      case 'batchStartQueue': {
        const r = await startQueue(msg.tabId);
        if (r && r.ok && !r.already) glog({ type: 'batch.start', title: 'Batch run started (auto-opened windows)' });
        sendResponse(r);
        break;
      }
      // Manual mode: claim the user's already-open windows as workers (no windows.create).
      case 'batchStartAdopt': {
        const r = await startQueueAdopt();
        if (r && r.ok && !r.already) glog({ type: 'batch.start', title: `Batch run started on ${r.adopted || 0} of your windows` });
        sendResponse(r);
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
      // ----- email lookup / audit -----
      case 'getAutoEmail': {
        sendResponse({ on: await getAutoEmail(), queued: emailJobs.length, running: emailRunning });
        break;
      }
      case 'setAutoEmail': {
        await chrome.storage.local.set({ [EKEY]: !!msg.on });
        glog({ type: 'settings.change', title: `Find emails while scraping: ${msg.on ? 'ON' : 'OFF'}` });
        sendResponse({ ok: true });
        break;
      }
      // Look one website up (the audit page drives its own queue through this, so
      // every fetch runs here in the service worker, sharing one cache + limiter).
      case 'emailLookup': {
        if (msg.limit) self.GridLeadsEmail.setLimit(msg.limit);
        sendResponse(await self.GridLeadsEmail.lookup(msg.website));
        break;
      }
      case 'auditLocal': {
        const p = await getProjects();
        sendResponse({ ok: true, rows: Object.values(p).map(auditRow) });
        break;
      }
      // Leads of one project that still need an email lookup (retry → also the
      // ones a previous run checked without success).
      case 'emailQueueLocal': {
        const p = await getProjects();
        const proj = p[msg.query];
        const rows = [];
        for (const [key, r] of Object.entries((proj && proj.records) || {})) {
          if (r.email || r.websiteStatus !== 'HAS_WEBSITE' || !self.GridLeadsEmail.crawlable(r.website)) continue;
          if (r.emailCheckedAt && !msg.retry) continue;
          rows.push({ key, name: r.name, website: r.website, score: r.opportunityScore || 0 });
        }
        sendResponse({ ok: true, rows });
        break;
      }
      case 'applyEmailResults': {
        sendResponse({ ok: true, applied: await applyEmailResults(msg.query, msg.results) });
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
        glog({ type: 'project.folder', title: `Folder created: ${f[id].name}` });
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
        if (f[msg.id]) glog({ type: 'project.folder', title: `Folder deleted: ${f[msg.id].name} (projects kept, ungrouped)` });
        delete f[msg.id];
        await setFolders(f);
        // its projects fall back to ungrouped (not deleted)
        await lockProjects(async () => {
          const p = await getProjects();
          for (const proj of Object.values(p)) if (proj.folderId === msg.id) delete proj.folderId;
          await setProjects(p);
        });
        sendResponse({ ok: true });
        break;
      }
      case 'moveProjects': {
        await lockProjects(async () => {
          const p = await getProjects();
          for (const q of (msg.queries || [])) {
            if (p[q]) { if (msg.folderId) p[q].folderId = msg.folderId; else delete p[q].folderId; }
          }
          await setProjects(p);
        });
        { const f = await getFolders(); const n = (msg.queries || []).length;
          glog({ type: 'project.move', n, title: `${n} project(s) moved to ${msg.folderId && f[msg.folderId] ? '📁 ' + f[msg.folderId].name : 'ungrouped'}`, data: { projects: msg.queries } }); }
        sendResponse({ ok: true });
        break;
      }
      case 'renameProjects': {
        await lockProjects(async () => {
          const p = await getProjects();
          if (msg.name && msg.name.trim()) {
            for (const q of (msg.queries || [])) if (p[q]) p[q].name = msg.name.trim();
            await setProjects(p);
            glog({ type: 'project.rename', n: (msg.queries || []).length, title: `${(msg.queries || []).length} project(s) renamed to "${msg.name.trim()}"`, data: { projects: msg.queries } });
          }
        });
        sendResponse({ ok: true });
        break;
      }
      case 'deleteProjects': {
        await lockProjects(async () => {
          const p = await getProjects();
          const gone = [];
          for (const q of (msg.queries || [])) { if (p[q]) gone.push({ project: q, leads: Object.keys(p[q].records || {}).length }); delete p[q]; if (activeQuery === q) activeQuery = ''; }
          await setProjects(p);
          if (gone.length) glog({ type: 'project.delete', n: gone.length, title: `${gone.length} project(s) deleted (${gone.reduce((s, g) => s + g.leads, 0)} leads)`, data: { projects: gone } });
        });
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
        const hit = await lockProjects(async () => {
          const p = await getProjects();
          const proj = p[msg.query];
          if (proj && proj.records[msg.key]) {
            glog({ type: 'leads.delete', project: msg.query, n: 1, title: `Lead deleted: ${proj.records[msg.key].name || msg.key}` });
            delete proj.records[msg.key]; await setProjects(p); return true;
          }
          return false;
        });
        if (hit) await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      case 'deleteRecords': {
        // bulk: [{query, key}, ...] — single storage write
        const n = await lockProjects(async () => {
          const p = await getProjects();
          let cnt = 0;
          const names = [];
          for (const it of (msg.items || [])) {
            const proj = p[it.query];
            if (proj && proj.records[it.key]) { names.push({ project: it.query, name: proj.records[it.key].name }); delete proj.records[it.key]; cnt++; }
          }
          if (cnt) { await setProjects(p); glog({ type: 'leads.delete', n: cnt, title: `${cnt} lead(s) deleted`, data: { leads: names.slice(0, 500) } }); }
          return cnt;
        });
        if (n) await refreshBadge();
        sendResponse({ ok: true, deleted: n });
        break;
      }
      case 'setChecked': {
        await lockProjects(async () => {
          const p = await getProjects();
          const proj = p[msg.query];
          if (proj && proj.records[msg.key]) {
            proj.records[msg.key].checked = !!msg.checked;
            await setProjects(p);
          }
        });
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
        await lockProjects(async () => {
          const p = await getProjects();
          if (p[msg.query] && msg.name && msg.name.trim()) {
            glog({ type: 'project.rename', project: msg.query, title: `Project renamed: "${p[msg.query].name}" → "${msg.name.trim()}"` });
            p[msg.query].name = msg.name.trim();
            await setProjects(p);
          }
        });
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
        const { addedProjects, mergedRecords } = await lockProjects(async () => {
          const p = await getProjects();
          const f = await getFolders();
          for (const [id, fol] of Object.entries(incoming.folders || {})) if (!f[id]) f[id] = fol;
          let added = 0, merged = 0;
          for (const [q, pr] of Object.entries(incoming.projects)) {
            if (!pr || typeof pr !== 'object') continue;
            if (!p[q]) { p[q] = pr; added++; merged += Object.keys(pr.records || {}).length; }
            else {
              const recs = { ...p[q].records };
              for (const [k, r] of Object.entries(pr.records || {})) if (!recs[k]) { recs[k] = r; merged++; }
              p[q] = { ...p[q], records: recs };
            }
          }
          await setFolders(f);
          await setProjects(p);
          return { addedProjects: added, mergedRecords: merged };
        });
        await refreshBadge();
        glog({ type: 'project.import', n: mergedRecords, title: `JSON import: ${addedProjects} new project(s), ${mergedRecords} lead(s) merged`, data: { projects: Object.keys(incoming.projects).slice(0, 500) } });
        sendResponse({ ok: true, addedProjects, mergedRecords });
        break;
      }
      case 'deleteProject': {
        await lockProjects(async () => {
          const p = await getProjects();
          if (p[msg.query]) glog({ type: 'project.delete', project: msg.query, n: 1, title: `Project deleted (${Object.keys(p[msg.query].records || {}).length} leads)` });
          delete p[msg.query];
          if (activeQuery === msg.query) activeQuery = '';
          await setProjects(p);
        });
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      case 'clearAll': {
        await lockProjects(async () => {
          const p = await getProjects();
          const n = Object.values(p).reduce((s, x) => s + Object.keys(x.records || {}).length, 0);
          glog({ type: 'project.delete', n: Object.keys(p).length, title: `Clear all: ${Object.keys(p).length} project(s), ${n} lead(s) removed from the browser` });
          await setProjects({});
        });
        activeQuery = '';
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
    }
    } catch (e) {
      console.error('[GridLeads] message handler threw for type=' + (msg && msg.type) + ':', e);
      try { sendResponse({ ok: false, error: (e && e.message) || String(e) }); } catch (_) { /* port already closed */ }
    }
  })();
  return true; // async
});
