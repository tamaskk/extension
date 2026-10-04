// GridLeads activity log — the data behind the Changelog page.
// Append-only event store in IndexedDB (shared by the service worker and every
// extension page, since they are one origin). Deliberately NOT chrome.storage:
// the lead store there is rewritten whole on every change, and a log that grows
// by thousands of rows a day must not ride along with that.
//
// Event: { id (auto), ts (ms), type, project?, title, n?, data? }
//   type is dotted — "leads.capture", "email.found", "audit.project", … — so the
//   Changelog can filter by the part before the dot.
// Attaches to `self` so the background service worker can importScripts it.
(function (root) {
  const DB_NAME = 'gridleads_log';
  const STORE = 'events';
  const MAX_EVENTS = 150000;   // prune back to (MAX - PRUNE_CHUNK) when exceeded
  const PRUNE_CHUNK = 25000;

  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const os = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('ts', 'ts');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  let sinceCheck = 0;
  async function prune(db) {
    const count = await new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); });
    if (count <= MAX_EVENTS) return;
    let left = count - (MAX_EVENTS - PRUNE_CHUNK);
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      const cur = tx.objectStore(STORE).openCursor(); // oldest first
      cur.onsuccess = () => { const c = cur.result; if (c && left > 0) { c.delete(); left--; c.continue(); } };
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  }

  // Never throws and never blocks the caller's real work on a logging failure.
  async function addMany(events) {
    const list = (events || []).filter(Boolean);
    if (!list.length) return;
    try {
      const db = await open();
      const now = Date.now();
      await new Promise((res) => {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        for (const e of list) os.add(Object.assign({ ts: now }, e));
        tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
      });
      sinceCheck += list.length;
      if (sinceCheck >= 2000) { sinceCheck = 0; await prune(db); }
    } catch (e) { console.warn('[GridLeads] log write failed:', e && e.message); }
  }
  function add(event) { return addMany([event]); }

  // Newest first. opts: { limit, beforeId, group, exclude, project, text, from, to }
  //   group   — the part of `type` before the dot ('' = everything)
  //   exclude — exact types to leave out
  //   project — substring match on the project
  //   text    — substring match anywhere in the event
  //   from/to — ms timestamps (inclusive)
  // → { events, nextBeforeId (null when the log is exhausted), scanned }
  async function query(opts) {
    const o = opts || {};
    const limit = Math.max(1, Math.min(1000, o.limit || 200));
    const group = (o.group || '').toLowerCase();
    const project = (o.project || '').toLowerCase();
    const text = (o.text || '').toLowerCase();
    const exclude = o.exclude && o.exclude.length ? new Set(o.exclude) : null;
    const db = await open();
    return new Promise((resolve) => {
      const events = [];
      let scanned = 0, lastId = null, more = false;
      const range = o.beforeId != null ? IDBKeyRange.upperBound(o.beforeId, true) : null;
      const tx = db.transaction(STORE);
      const cur = tx.objectStore(STORE).openCursor(range, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const e = c.value;
        scanned++;
        if (o.from != null && e.ts < o.from) return; // ids ascend with time → nothing older can match
        if (events.length >= limit) { more = true; return; }
        lastId = e.id;
        let ok = true;
        if (o.to != null && e.ts > o.to) ok = false;
        if (ok && group && String(e.type || '').split('.')[0] !== group) ok = false;
        if (ok && exclude && exclude.has(e.type)) ok = false;
        if (ok && project && !String(e.project || '').toLowerCase().includes(project)) ok = false;
        if (ok && text && !JSON.stringify(e).toLowerCase().includes(text)) ok = false;
        if (ok) events.push(e);
        c.continue();
      };
      const finish = () => resolve({ events, nextBeforeId: more ? lastId : null, scanned });
      tx.oncomplete = finish; tx.onerror = finish; tx.onabort = finish;
    });
  }

  // Totals per type for a time window (the Changelog's summary tiles).
  // → { [type]: { events, n } }  where n sums each event's `n` (leads, emails…)
  async function summary(from, to) {
    const db = await open();
    return new Promise((resolve) => {
      const out = {};
      const range = IDBKeyRange.bound(from, to == null ? Date.now() + 1e6 : to);
      const tx = db.transaction(STORE);
      const cur = tx.objectStore(STORE).index('ts').openCursor(range);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const e = c.value;
        const b = out[e.type] || (out[e.type] = { events: 0, n: 0 });
        b.events++; b.n += Number(e.n) || 0;
        c.continue();
      };
      const finish = () => resolve(out);
      tx.oncomplete = finish; tx.onerror = finish; tx.onabort = finish;
    });
  }

  async function count() {
    const db = await open();
    return new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); });
  }
  async function clear() {
    const db = await open();
    return new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = res; tx.onerror = res; });
  }

  // One event per checked business. `where` = 'browser' | 'database' (which copy
  // of the lead was updated), `via` = 'scrape' (found while scraping) | 'audit'.
  function logEmailResults(project, results, via, where) {
    const events = [];
    for (const r of results || []) {
      if (!r) continue;
      const base = { project, data: { key: r.key, name: r.name || '', website: r.website || '', via, where, pages: r.pages, ms: r.ms } };
      if (r.status === 'found') {
        base.type = 'email.found'; base.n = 1;
        base.title = `${r.name || r.key} → ${r.email}`;
        Object.assign(base.data, { email: r.email, emails: r.emails, source: r.source, saved: r.saved !== false });
        if (r.phone) base.data.phone = r.phone;
      } else if (r.status === 'error') {
        base.type = 'email.error';
        base.title = `${r.name || r.key} — site failed: ${r.error || 'error'}`;
        base.data.error = r.error || '';
      } else {
        base.type = 'email.none';
        base.title = `${r.name || r.key} — no email on site`;
        base.data.status = r.status;
      }
      events.push(base);
    }
    return addMany(events);
  }

  root.GridLeadsLog = { add, addMany, query, summary, count, clear, logEmailResults };
})(typeof self !== 'undefined' ? self : this);
