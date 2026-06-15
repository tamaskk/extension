// GridLeads popup controller.
const $ = (id) => document.getElementById(id);

// Safe message to the background: callback form + reading lastError fully
// suppresses "Could not establish connection. Receiving end does not exist."
// (which happens while the service worker is starting up). Never rejects.
function bg(message) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res); }); }
    catch { resolve(null); }
  });
}
let pollTimer = null;
let activeQuery = '';
let contentQuery = '';

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Find a Google Maps tab by URL (prefers the active one). Robust for batch.
async function mapsTabId() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.google.com/maps/*' });
    const pick = tabs.find((t) => t.active) || tabs[0];
    if (pick) return pick.id;
  } catch { /* */ }
  const t = await activeTab();
  return t && onMaps(t) ? t.id : null;
}
function onMaps(tab) {
  return tab && tab.url && tab.url.startsWith('https://www.google.com/maps');
}

// Callback form + reading lastError is the only way to fully suppress the
// "Could not establish connection. Receiving end does not exist." console error
// when the target tab has no content script. Resolves undefined in that case.
function safeTabSend(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        void chrome.runtime.lastError; // read it → marks the error as handled
        resolve(res);
      });
    } catch {
      resolve(undefined);
    }
  });
}

// Send to the content script; if it isn't loaded (tab opened before the
// extension was (re)loaded), inject it and retry. Never throws.
async function tabSend(tabId, message) {
  let res = await safeTabSend(tabId, message);
  if (res !== undefined) return res;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
  } catch {
    return null;
  }
  res = await safeTabSend(tabId, message);
  return res === undefined ? null : res;
}
function setRunning(running) {
  $('start').disabled = running;
  $('stop').disabled = !running;
}

async function refreshStats() {
  const s = await bg({ type: 'getStats', query: contentQuery || undefined });
  if (s) {
    $('total').textContent = s.total || 0;
    $('noweb').textContent = s.noWebsite || 0;
    $('hot').textContent = s.hot || 0;
    $('email').textContent = s.email || 0;
    activeQuery = s.query || '';
    if (activeQuery) {
      $('project').textContent = '📁 ' + activeQuery;
      $('project').classList.remove('hidden');
    }
  }
}

// Live batch-queue display: which batch is running and where we are.
async function refreshQueue() {
  try {
    const st = await bg({ type: 'batchQueue' });
    const q = (st && st.queue) || [];
    if (!q.length) {
      $('qsInfo').textContent = 'No batches queued';
      $('qsStart').classList.add('hidden');
      $('qsStop').classList.add('hidden');
      return;
    }
    const totalSearches = q.reduce((s, b) => s + (b.count || 0), 0);
    if (st.active) {
      const cur = q[0];
      const more = q.length > 1 ? ` · ${q.length - 1} more queued` : '';
      $('qsInfo').textContent = `▶ Batch 1/${q.length}: ${cur.label}\n${cur.doneInBatch}/${cur.count} done · now: ${cur.currentQuery || '…'}${more}`;
      $('qsStart').classList.add('hidden');
      $('qsStop').classList.remove('hidden');
    } else {
      $('qsInfo').textContent = `${q.length} batch(es) queued · ${totalSearches} searches total`;
      $('qsStart').classList.remove('hidden');
      $('qsStop').classList.add('hidden');
    }
  } catch { /* never let the queue display block the popup */ }
}

async function pollContent() {
  const tab = await activeTab();
  if (onMaps(tab)) {
    const res = await safeTabSend(tab.id, { action: 'status' });
    if (res) {
      contentQuery = res.query || contentQuery;
      setRunning(res.running);
      const s = await bg({ type: 'getStats', query: contentQuery || undefined });
      const total = (s && s.total) || 0;
      $('status').textContent = res.running
        ? (res.note || `Scraping… ${total} collected`)
        : (total ? `Idle · ${total} in this project` : 'Idle');
      $('bar').style.width = Math.min(100, total) + '%';
    }
  }
  await refreshStats();
  await refreshQueue();
}

async function init() {
  try {
    const tab = await activeTab();
    $('notMaps').classList.toggle('hidden', onMaps(tab));
    $('start').disabled = !onMaps(tab);
  } catch { /* never block listener wiring below */ }

  $('start').addEventListener('click', async () => {
    const t = await activeTab();
    if (!onMaps(t)) return;
    const res = await tabSend(t.id, { action: 'start' });
    if (res) {
      setRunning(true);
      $('status').textContent = 'Starting…';
    } else {
      $('status').textContent = 'Could not start — reload the Google Maps tab and try again.';
    }
  });

  $('stop').addEventListener('click', async () => {
    const t = await activeTab();
    if (onMaps(t)) await tabSend(t.id, { action: 'stop' });
    setRunning(false);
  });

  $('export').addEventListener('click', async () => {
    const res = await bg({
      type: 'export',
      query: activeQuery || undefined,
      onlyNoWebsite: $('onlyNoWeb').checked,
    });
    $('status').textContent = res && res.count ? `Exported ${res.count} rows` : 'Nothing to export';
  });

  $('openDash').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // ---- batch automation ----
  const middlesOf = () => $('bMiddle').value.split(',').map((s) => s.trim()).filter(Boolean);
  const buildQuery = (m) => [$('bPrefix').value.trim(), m, $('bSuffix').value.trim()].filter(Boolean).join(' ');
  function updatePreview() {
    const ms = middlesOf();
    if (!ms.length) { $('bPreview').textContent = ''; return; }
    const first = buildQuery(ms[0]).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    $('bPreview').innerHTML = `${ms.length} searches → e.g. <b>${first}</b>`;
  }
  const saveBatch = () => chrome.storage.local.set({ gridleads_batch: { p: $('bPrefix').value, m: $('bMiddle').value, s: $('bSuffix').value } });
  chrome.storage.local.get('gridleads_batch', (o) => {
    const b = o.gridleads_batch;
    if (b) { $('bPrefix').value = b.p || ''; $('bMiddle').value = b.m || ''; $('bSuffix').value = b.s || ''; updatePreview(); }
  });
  ['bPrefix', 'bMiddle', 'bSuffix'].forEach((id) => $(id).addEventListener('input', () => { updatePreview(); saveBatch(); }));

  // Add a batch to the queue (does NOT start it — Start runs the whole queue).
  $('bRun').addEventListener('click', async () => {
    const middles = middlesOf();
    if (!middles.length) { $('bStatus').textContent = 'Enter at least one comma-separated value.'; return; }
    const res = await bg({
      type: 'batchEnqueue', prefix: $('bPrefix').value, middles, suffix: $('bSuffix').value,
    });
    if (res && res.ok) { $('bMiddle').value = ''; updatePreview(); saveBatch(); $('bStatus').textContent = `＋ Added ${res.count} searches to the queue`; refreshQueue(); }
    else { $('bStatus').textContent = 'Could not add (no valid searches).'; }
  });

  // Load many batches from a JSON file: [{ city, areas:[...] }]. You only fill the
  // Prefix (e.g. "restaurants near"); each city becomes one batch, areas = searches.
  $('bLoadJson').addEventListener('click', () => $('bFile').click());
  $('bFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const prefix = $('bPrefix').value.trim();
    if (!prefix) { $('bStatus').textContent = '⚠ Fill the Prefix first (e.g. "restaurants near").'; return; }
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { $('bStatus').textContent = '⚠ Invalid JSON file.'; return; }
    if (!Array.isArray(data)) { $('bStatus').textContent = '⚠ JSON must be an array of { city, areas }.'; return; }

    let batches = 0, searches = 0;
    for (const entry of data) {
      const city = (entry && (entry.city || entry.suffix) || '').trim();
      const areas = Array.isArray(entry && entry.areas) ? entry.areas : [];
      const middles = areas.map((a) => String(a || '').trim()).filter(Boolean);
      if (!city || !middles.length) continue;
      const label = `${prefix} {${middles.length} areas} ${city}`;
      const res = await bg({ type: 'batchEnqueue', prefix, middles, suffix: city, label });
      if (res && res.ok) { batches++; searches += res.count || middles.length; }
    }
    if (batches) { $('bStatus').textContent = `⤴ Loaded ${batches} batch(es) · ${searches} searches total`; refreshQueue(); }
    else { $('bStatus').textContent = '⚠ No valid { city, areas } entries found.'; }
  });
  $('qsStart').addEventListener('click', async () => {
    const tabId = await mapsTabId();
    const res = await bg({ type: 'batchStartQueue', tabId });
    if (res && res.error === 'no-tab') $('qsInfo').textContent = 'Open a Google Maps tab first, then Start.';
    else if (res && res.error === 'empty') $('qsInfo').textContent = 'Queue is empty — add a batch first.';
    else refreshQueue();
  });
  $('qsStop').addEventListener('click', async () => {
    await bg({ type: 'batchStopAll' });
    refreshQueue();
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Clear ALL projects and leads?')) return;
    await bg({ type: 'clearAll' });
    await refreshStats();
    $('status').textContent = 'Cleared';
  });

  // start polling LAST, so a polling error can never block the buttons above
  await refreshStats().catch(() => {});
  await pollContent().catch(() => {});
  pollTimer = setInterval(() => pollContent().catch(() => {}), 1000);
}

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('unload', () => pollTimer && clearInterval(pollTimer));
