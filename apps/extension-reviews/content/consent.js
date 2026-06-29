// Auto-dismiss the Google consent interstitial (EEA/UK) so Maps can load.
// Clicking "Reject all" still lets review data load, with fewer cookies.
(function () {
  function clickConsent() {
    const btn =
      document.querySelector('button[aria-label*="Reject all" i], button[aria-label*="Accept all" i]') ||
      [...document.querySelectorAll('form[action*="consent"] button, button, input[type="submit"]')]
        .find((b) => /(reject all|accept all|i agree|elfogad|elutas)/i.test(b.textContent || b.value || ''));
    if (btn) { try { btn.click(); } catch {} return true; }
    return false;
  }
  if (!clickConsent()) {
    let n = 0;
    const t = setInterval(() => { if (clickConsent() || ++n > 20) clearInterval(t); }, 400);
  }
})();
