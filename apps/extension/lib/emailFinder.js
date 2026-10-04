// GridLeads email finder.
// Google Maps never returns an email address, so the only reliable source is the
// business's own website. For one website this fetches the homepage and — only
// when the homepage has no usable address — up to a few contact/about/imprint
// pages, extracts every address it can see (mailto:, plain text, Cloudflare
// "email protection", "name [at] domain [dot] com"), drops the junk (asset
// names, tracking DSNs, template placeholders, the web agency's address) and
// ranks what is left.
// Attaches to `self` so the background service worker can importScripts it.
(function (root) {
  const FETCH_TIMEOUT = 9000;     // per page
  const SITE_BUDGET = 26000;      // per website, all pages together
  const MAX_BYTES = 700 * 1024;   // read at most this much of a page
  const MAX_EXTRA_PAGES = 3;      // contact/about pages tried after the homepage

  // Hosts that are not the business's own site: nothing to crawl there.
  const SOCIAL = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com',
    'youtu.be', 'linkedin.com', 'pinterest.com', 'wa.me', 'whatsapp.com', 't.me', 'google.com', 'goo.gl', 'g.page',
    'business.site', 'yelp.com', 'tripadvisor.com', 'booking.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
    'opentable.com', 'foursquare.com', 'yellowpages.com', 'nextdoor.com', 'thumbtack.com', 'angi.com', 'houzz.com'];

  const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'gmx.net',
    'web.de', 't-online.de', 'mail.com', 'zoho.com', 'yandex.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net',
    'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net', 'freemail.hu', 'citromail.hu', 'indamail.hu', 't-online.hu',
    'yahoo.co.uk', 'btinternet.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'libero.it', 'hotmail.co.uk', 'hotmail.fr']);

  // Domains that only ever show up as noise in page source.
  const JUNK_DOMAIN = /(^|\.)(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|example\.(com|org|net)|domain\.com|yourdomain\.com|email\.com|mysite\.com|yoursite\.com|website\.com|company\.com|mail\.com\.invalid|schema\.org|w3\.org|googleapis\.com|gstatic\.com|google\.com|cloudflare\.com|jsdelivr\.net|unpkg\.com|github\.com|wordpress\.(org|com)|wix\.com|squarespace\.com|shopify\.com|weebly\.com|godaddy\.com|mailchimp\.com|sentry\.wixpress\.com|ingest\.sentry\.io|latofonts\.com|fontawesome\.com|typekit\.com|apple\.com|microsoft\.com|adobe\.com)$/i;
  const JUNK_LOCAL = /^(your|you|name|email|e-mail|mail|user|username|someone|somebody|example|test|firstname|lastname|first\.last|john\.doe|jane\.doe|johndoe|janedoe|youremail|your-email|your\.email|yourname|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|null|none|xxx+|aaa+|u003e.*|x22.*)$/i;
  const ASSET_TLD = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|css|js|mjs|json|map|woff2?|ttf|otf|eot|mp4|webm|mov|pdf|zip|php|html?|aspx?)$/i;
  const GENERIC_LOCAL = /^(info|contact|hello|hi|office|sales|admin|mail|booking|bookings|reservations?|enquir(y|ies)|inquir(y|ies)|support|service|team|help|kontakt|iroda|ertekesites|recepcio|foglalas)$/i;

  // Real addresses, but never the person who buys: useless for outreach.
  const NON_SALES_LOCAL = /^(press|media|pr|investors?|investor-?relations|ir|careers?|jobs?|employment|recruit(ing|ment)?|hr|humanresources|privacy|legal|dmca|compliance|accessibility|ada|webmaster|hostmaster|security|billing|accounts?payable|ap|unsubscribe|newsletter|gdpr|dpo|dataprotection|adatvedelem|allas|karrier)$/i;

  const CONTACT_WORDS = ['contact', 'kontakt', 'kapcsolat', 'elerhetoseg', 'contatti', 'contacto', 'contato', 'get-in-touch', 'reach-us',
    'impressum', 'imprint', 'about', 'uber-uns', 'ueber-uns', 'rolunk', 'chi-siamo', 'quienes-somos', 'a-propos', 'team', 'support', 'location', 'visit'];

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
  function isSocialHost(host) { return SOCIAL.some((d) => host === d || host.endsWith('.' + d)); }

  // "example.co.uk" → "example.co.uk"; "shop.example.com" → "example.com".
  function baseDomain(host) {
    const p = String(host || '').split('.');
    if (p.length <= 2) return p.join('.');
    const sld = p[p.length - 2];
    const three = p[p.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu|or|ne)$/.test(sld);
    return p.slice(three ? -3 : -2).join('.');
  }

  // Normalise a stored website into a crawlable URL; '' if there is nothing to crawl.
  function normalizeSite(website) {
    let s = String(website || '').trim();
    if (!s) return '';
    // Maps sometimes hands back its own redirect wrapper: /url?q=<real site>&…
    const m = s.match(/[?&]q=(https?[^&]+)/i);
    if (/^(https?:\/\/)?(www\.)?google\.[a-z.]+\/url\?/i.test(s) && m) { try { s = decodeURIComponent(m[1]); } catch { /* keep */ } }
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try { const u = new URL(s); if (!u.hostname.includes('.')) return ''; return u.href; } catch { return ''; }
  }
  function crawlable(website) {
    const url = normalizeSite(website);
    if (!url) return false;
    return !isSocialHost(hostOf(url));
  }

  // ---------- extraction ----------
  function decodeEntities(s) {
    return s
      .replace(/&#(\d{2,4});/g, (_, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-f]{2,4});/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&commat;/gi, '@').replace(/&period;/gi, '.').replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ')
      .replace(/\\u0040/gi, '@').replace(/\\u002e/gi, '.').replace(/%40/g, '@');
  }

  // Cloudflare "email protection": first byte is the XOR key for the rest.
  function decodeCf(hex) {
    try {
      const key = parseInt(hex.slice(0, 2), 16);
      let out = '';
      for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
      return out;
    } catch { return ''; }
  }

  const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
  // "name [at] domain [dot] com" / "name (kukac) domain (pont) hu"
  const OBF_RE = /([a-z0-9][a-z0-9._%+-]{0,63})\s*[\[\(\{]\s*(?:at|kukac)\s*[\]\)\}]\s*([a-z0-9-]+(?:\s*(?:[\[\(\{]\s*(?:dot|pont)\s*[\]\)\}]|\.)\s*[a-z0-9-]+)+)/gi;

  function cleanEmail(raw) {
    let e = String(raw || '').trim().toLowerCase().replace(/^mailto:/, '').split('?')[0].replace(/^[.\-_]+|[.\-_]+$/g, '');
    if (e.length < 6 || e.length > 80) return '';
    const at = e.lastIndexOf('@');
    if (at < 1) return '';
    const local = e.slice(0, at), domain = e.slice(at + 1);
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(domain)) return '';
    if (!/^[a-z0-9][a-z0-9._%+-]*$/.test(local) || local.includes('..')) return '';
    if (ASSET_TLD.test(domain) || JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) return '';
    if (/^[a-f0-9]{16,}$/.test(local)) return ''; // tracking / DSN hashes
    if (/\d{2,}x\d{2,}/.test(local)) return '';   // image-size fragments
    return local + '@' + domain;
  }

  // → Map<email, {mailto:boolean, count:number}>
  function extractEmails(html) {
    const found = new Map();
    const add = (raw, mailto) => {
      const e = cleanEmail(raw);
      if (!e) return;
      const cur = found.get(e) || { mailto: false, count: 0 };
      cur.count++; if (mailto) cur.mailto = true;
      found.set(e, cur);
    };
    const src = decodeEntities(String(html || ''));

    let m;
    const mailtoRe = /mailto:([^"'\s<>]+)/gi;
    while ((m = mailtoRe.exec(src))) { let v = m[1]; try { v = decodeURIComponent(v); } catch { /* raw */ } add(v, true); }
    const cfRe = /(?:data-cfemail="|email-protection#)([0-9a-f]{6,200})/gi;
    while ((m = cfRe.exec(src))) add(decodeCf(m[1]), true);

    // tags → spaces so neighbouring text nodes never fuse into one fake address
    const text = src.replace(/<[^>]+>/g, ' ');
    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(text))) add(m[0], false);
    OBF_RE.lastIndex = 0;
    while ((m = OBF_RE.exec(text))) {
      const domain = m[2].replace(/\s*[\[\(\{]\s*(?:dot|pont)\s*[\]\)\}]\s*/gi, '.').replace(/\s+/g, '');
      add(m[1] + '@' + domain, false);
    }
    return found;
  }

  // Rank the candidates for one site; best first. Addresses on a foreign,
  // non-freemail domain that were not an explicit mailto: link are dropped —
  // those are almost always the web designer or a template leftover.
  function rankEmails(found, siteHost) {
    const siteBase = baseDomain(siteHost);
    const out = [];
    for (const [email, info] of found) {
      const domain = email.slice(email.indexOf('@') + 1);
      const local = email.slice(0, email.indexOf('@'));
      const own = !!siteBase && baseDomain(domain) === siteBase;
      const free = FREEMAIL.has(domain);
      if (!own && !free && !info.mailto) continue;
      if (NON_SALES_LOCAL.test(local.replace(/[.\-_]/g, ''))) continue;
      // own domain beats a freemail address beats a foreign mailto: link
      const tier = own ? 3 : free ? 2 : 1;
      let score = 0;
      if (info.mailto) score += 50;
      if (GENERIC_LOCAL.test(local)) score += 15;
      score += Math.min(10, info.count * 2);
      out.push({ email, tier, score });
    }
    out.sort((a, b) => b.tier - a.tier || b.score - a.score || a.email.length - b.email.length);
    return out.map((x) => x.email);
  }

  function extractPhone(html) {
    const m = /href\s*=\s*["']tel:([^"']{6,24})["']/i.exec(String(html || ''));
    if (!m) return '';
    let v = m[1]; try { v = decodeURIComponent(v); } catch { /* raw */ }
    v = v.replace(/[^\d+()\-.\s]/g, '').trim();
    return v.replace(/\D/g, '').length >= 7 ? v : '';
  }

  // Same-site links that look like a contact/about page, most promising first.
  function contactLinks(html, pageUrl) {
    const base = hostOf(pageUrl);
    const seen = new Set(); const hits = [];
    const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && hits.length < 40) {
      const href = m[1].trim();
      if (/^(#|mailto:|tel:|javascript:|sms:|whatsapp:)/i.test(href)) continue;
      let u; try { u = new URL(href, pageUrl); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || hostOf(u.href) !== base) continue;
      if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
      const hay = (u.pathname + ' ' + m[2].replace(/<[^>]+>/g, ' ')).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_]+/g, '-');
      const rank = CONTACT_WORDS.findIndex((w) => hay.includes(w));
      if (rank < 0) continue;
      u.hash = '';
      if (seen.has(u.href) || u.href === pageUrl) continue;
      seen.add(u.href);
      hits.push({ url: u.href, rank });
    }
    hits.sort((a, b) => a.rank - b.rank);
    return hits.map((h) => h.url);
  }

  // ---------- fetching ----------
  async function fetchPage(url, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        signal: ctl.signal, credentials: 'omit', redirect: 'follow', cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status, url: res.url || url };
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && !/html|xml|text\/plain/.test(type)) return { ok: false, error: 'not HTML (' + type.split(';')[0] + ')', url: res.url || url };
      let html = '';
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder('utf-8');
        let bytes = 0;
        while (bytes < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          html += dec.decode(value, { stream: true });
        }
        try { reader.cancel(); } catch { /* */ }
      } else {
        html = (await res.text()).slice(0, MAX_BYTES);
      }
      return { ok: true, html, url: res.url || url };
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      return { ok: false, error: aborted ? 'timeout' : 'unreachable', url };
    } finally { clearTimeout(timer); }
  }

  // Look one website up. Never throws.
  // → { status:'found'|'none'|'error'|'social'|'no_site', email, emails[], source, pages, error, phone, ms }
  async function findForSite(website) {
    const t0 = Date.now();
    const done = (o) => Object.assign({ email: '', emails: [], source: '', pages: 0, error: '', phone: '', ms: Date.now() - t0 }, o);
    const start = normalizeSite(website);
    if (!start) return done({ status: 'no_site' });
    if (isSocialHost(hostOf(start))) return done({ status: 'social' });

    let home = await fetchPage(start);
    // plain-http sites that only answer on https (or the reverse)
    if (!home.ok && home.error !== 'timeout') {
      const alt = start.startsWith('http://') ? start.replace(/^http:/, 'https:') : start.replace(/^https:/, 'http:');
      const second = await fetchPage(alt);
      if (second.ok) home = second;
    }
    if (!home.ok) return done({ status: 'error', error: home.error, pages: 1 });

    const siteHost = hostOf(home.url) || hostOf(start);
    if (isSocialHost(siteHost)) return done({ status: 'social', pages: 1 }); // redirected to a social profile
    let pages = 1;
    let phone = extractPhone(home.html);
    let emails = rankEmails(extractEmails(home.html), siteHost);
    let source = home.url;

    if (!emails.length) {
      let links = contactLinks(home.html, home.url);
      if (!links.length) { try { links = [new URL('/contact', home.url).href, new URL('/contact-us', home.url).href]; } catch { /* */ } }
      for (const link of links.slice(0, MAX_EXTRA_PAGES)) {
        if (Date.now() - t0 > SITE_BUDGET) break;
        const pg = await fetchPage(link);
        pages++;
        if (!pg.ok) continue;
        if (!phone) phone = extractPhone(pg.html);
        emails = rankEmails(extractEmails(pg.html), siteHost);
        if (emails.length) { source = pg.url; break; }
      }
    }
    if (!emails.length) return done({ status: 'none', pages, phone });
    return done({ status: 'found', email: emails[0], emails: emails.slice(0, 5), source, pages, phone });
  }

  // ---------- shared, cached, concurrency-limited lookup ----------
  // Chains / franchises share one website across many leads → cache per URL.
  const cache = new Map();
  const CACHE_MAX = 4000;
  let active = 0;
  const waiters = [];
  let limit = 10;

  async function lookup(website) {
    const key = normalizeSite(website);
    if (key && cache.has(key)) return Object.assign({ cached: true }, cache.get(key));
    if (active >= limit) await new Promise((r) => waiters.push(r));
    active++;
    try {
      const res = await findForSite(website);
      if (key && res.status !== 'error') {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(key, res);
      }
      return res;
    } finally {
      active--;
      const next = waiters.shift();
      if (next) next();
    }
  }
  function setLimit(n) { limit = Math.max(1, Math.min(24, Number(n) || 10)); }

  root.GridLeadsEmail = { lookup, findForSite, extractEmails, rankEmails, cleanEmail, contactLinks, normalizeSite, crawlable, hostOf, setLimit, wait };
})(typeof self !== 'undefined' ? self : this);
