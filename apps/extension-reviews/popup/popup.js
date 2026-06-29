// GridLeads Review Scraper popup — Start/Stop + live progress.
// All the work happens in the background service worker; the popup just toggles
// the run and polls reviewStatus once a second to mirror progress.

const $ = (id) => document.getElementById(id);

function bg(message) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res || null); }); }
    catch { resolve(null); }
  });
}

function setRunning(running) {
  $('start').disabled = running;
  $('stop').disabled = !running;
}

function render(s) {
  if (!s) return;
  setRunning(!!s.active);
  $('done').textContent = s.done || 0;
  $('reviews').textContent = s.reviews || 0;
  $('errors').textContent = s.errors || 0;
  $('current').textContent = s.current ? (s.current.name || s.current.dedupKey) : (s.active ? 'Finding next…' : '—');
  $('status').textContent = s.message || (s.active ? 'Working…' : 'Idle');
  // a soft, indeterminate-ish bar: fill grows with businesses done this session (caps at 100%)
  $('bar').style.width = Math.min(100, ((s.done || 0) % 100)) + '%';
}

let timer = null;
async function poll() { render(await bg({ type: 'reviewStatus' })); }

document.addEventListener('DOMContentLoaded', () => {
  $('start').addEventListener('click', async () => { setRunning(true); $('status').textContent = 'Starting…'; await bg({ type: 'reviewStart' }); poll(); });
  $('stop').addEventListener('click', async () => { setRunning(false); await bg({ type: 'reviewStop' }); poll(); });
  poll();
  timer = setInterval(poll, 1000);
});
window.addEventListener('unload', () => { if (timer) clearInterval(timer); });
