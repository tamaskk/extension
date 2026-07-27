// Bridge between the GridLeads dashboard page and the review-scraper extension.
// The page posts {__glr:'scrapeOne', business} on window; we forward it to the
// background (which opens a lone window, scrapes that ONE business, saves and
// closes), then relay the ack and the final result back via window.postMessage.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__glr !== 'scrapeOne') return;
  const key = e.data.business && e.data.business.dedupKey;
  try {
    chrome.runtime.sendMessage({ type: 'glrScrapeOne', business: e.data.business }, (res) => {
      void chrome.runtime.lastError;
      window.postMessage({ __glr: 'ack', ok: !!(res && res.ok), error: (res && res.error) || '', dedupKey: key }, '*');
    });
  } catch {
    window.postMessage({ __glr: 'ack', ok: false, error: 'extension unavailable', dedupKey: key }, '*');
  }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'glrOneDone') {
    window.postMessage({ __glr: 'done', dedupKey: msg.dedupKey, count: msg.count || 0, error: msg.error || '' }, '*');
    sendResponse({ ok: true });
  }
});
