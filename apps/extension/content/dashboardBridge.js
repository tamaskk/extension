// Runs on the GridLeads dashboard page only. It lets the dashboard's Coverage
// tab put searches into this extension's batch queue and start the queue, so a
// missing run can be queued from the table instead of through a JSON file.
//
// A page cannot talk to the extension directly; this script passes on exactly
// these message types and nothing else, so the page cannot reach the rest of
// the background's commands (deleting data, changing settings). Three of them
// change something (queue a batch, start the queue in one of its ways); the other two only read
// the queue's state, for the Coverage tab's debug log.

const ALLOWED = new Set(['batchEnqueue', 'batchStartQueue', 'batchStartAdopt', 'batchStatus', 'batchQueue']);
const MAX_SEARCHES = 3000; // the largest reference list (a US state) is about 1300 places
const text = (v, max) => String(v == null ? '' : v).slice(0, max);

function answer(id, body) {
  window.postMessage({ source: 'gridleads-extension', id, ...body }, location.origin);
}

window.addEventListener('message', (event) => {
  // only this page itself, never a frame or another window
  if (event.source !== window || event.origin !== location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== 'gridleads-dashboard' || typeof msg.id !== 'string') return;
  if (msg.type === 'ping') { answer(msg.id, { ok: true, version: chrome.runtime.getManifest().version }); return; }
  if (!ALLOWED.has(msg.type)) { answer(msg.id, { ok: false, error: 'not-allowed' }); return; }

  const out = { type: msg.type };
  // start in a tab of this window instead of new windows
  if (msg.type === 'batchStartQueue' && msg.inTab === true) out.inTab = true;
  // how many windows work side by side; the background caps it
  if (msg.type === 'batchStartQueue' && Number.isInteger(msg.windows) && msg.windows >= 1 && msg.windows <= 8) out.windows = msg.windows;
  if (msg.type === 'batchEnqueue') {
    const middles = (Array.isArray(msg.middles) ? msg.middles : []).slice(0, MAX_SEARCHES).map((m) => text(m, 120)).filter(Boolean);
    out.prefix = text(msg.prefix, 60);
    out.suffix = text(msg.suffix, 80);
    out.middles = middles;
    out.label = text(msg.label, 160);
    if (!out.prefix.trim() || !out.suffix.trim() || !middles.length) { answer(msg.id, { ok: false, error: 'no-items' }); return; }
  }
  try {
    chrome.runtime.sendMessage(out, (res) => {
      // lastError is set when the extension was reloaded while this page stayed open
      if (chrome.runtime.lastError) { answer(msg.id, { ok: false, error: 'extension-reloaded' }); return; }
      if (!res || typeof res !== 'object') { answer(msg.id, { ok: false, error: 'no-response' }); return; }
      // the two read-only commands carry no `ok`; the queue view drops its search lists, thousands of rows the page does not need
      if (msg.type === 'batchQueue') { answer(msg.id, { ok: true, active: !!res.active, workers: res.workers || 0, queue: (res.queue || []).map((b) => ({ label: b.label, count: b.count, status: b.status, doneInBatch: b.doneInBatch, currentQuery: b.currentQuery })) }); return; }
      if (msg.type === 'batchStatus') { answer(msg.id, { ok: true, ...res }); return; }
      answer(msg.id, res);
    });
  } catch (e) {
    answer(msg.id, { ok: false, error: 'extension-reloaded' });
  }
});
