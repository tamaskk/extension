// GridLeads Email audit — what is missing, how much, where; then fill it in.
// Two sources: the web app's database (where stream-mode scrapes end up) and the
// projects still stored in this browser. The page drives the queue; every
// website fetch runs in the background service worker ('emailLookup').
const SYNC_BASE = 'https://gridleads-wheat.vercel.app'; // deployed web app (use http://localhost:3000 for local dev)
const PAGE = 100;        // projects per page (database source)
const SAVE_EVERY = 20;   // write results back in batches of this many leads
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString();
function esc(v) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Safe message to the background (never rejects; undefined if the SW was restarting).
function bg(message) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res); }); }
    catch { resolve(undefined); }
  });
}

let source = localStorage.getItem('gl_audit_src') === 'local' ? 'local' : 'db';
let rows = [];            // audit rows currently listed (in run order)
let totals = null;        // database: totals over ALL matching projects (not just the loaded page)
let more = false;         // database: more pages available
let selected = new Set(); // ticked project queries
let running = false;
let stopping = false;
const finished = new Set();
let runningQuery = '';

// ---------- data sources ----------
async function api(body) {
  const r = await fetch(SYNC_BASE + '/api/audit', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) { const e = new Error('Not logged in to the web app'); e.login = true; throw e; }
  if (r.status === 404) throw new Error('The web app has no /api/audit yet — deploy the current apps/web first');
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}

const SRC = {
  db: {
    async list(skip) {
      const j = await api({ action: 'list', q: $('q').value.trim(), limit: PAGE, skip });
      return { rows: j.rows, totals: j.totals, more: j.more };
    },
    async queue(query, retry) { return (await api({ action: 'queue', project: query, retry })).rows; },
    // → { applied (results incl. `saved`), row (fresh counts) }
    async save(query, results) {
      const j = await api({ action: 'results', project: query, results });
      const saved = new Set(j.saved || []);
      return { applied: results.map((r) => Object.assign({}, r, { saved: saved.has(r.key) })), row: j.row };
    },
    where: 'database',
  },
  local: {
    async list() {
      const res = await bg({ type: 'auditLocal' });
      const term = $('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let list = ((res && res.rows) || []).filter((r) => term.every((w) => (r.query + ' ' + r.name).toLowerCase().includes(w)));
      list.sort((a, b) => b.todo - a.todo || String(a.query).localeCompare(String(b.query)));
      return { rows: list, totals: null, more: false };
    },
    async queue(query, retry) {
      const res = await bg({ type: 'emailQueueLocal', query, retry });
      return ((res && res.rows) || []).sort((a, b) => (b.score || 0) - (a.score || 0));
    },
    async save(query, results) {
      const res = await bg({ type: 'applyEmailResults', query, results });
      const all = await bg({ type: 'auditLocal' });
      return { applied: (res && res.applied) || [], row: ((all && all.rows) || []).find((r) => r.query === query) };
    },
    where: 'browser',
  },
};

// ---------- rendering ----------
const cell = (n, cls) => `<td class="num ${n ? (cls || '') : 'zero'}">${fmt(n)}</td>`;

function renderTiles() {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const tiles = [];
  if (source === 'db' && totals) {
    const pct = totals.total ? ((totals.email / totals.total) * 100).toFixed(totals.email / totals.total < 0.01 ? 3 : 1) : '0';
    tiles.push(
      [fmt(totals.projects), 'Projects', $('q').value.trim() ? 'matching the filter' : 'in the database', ''],
      [fmt(totals.total), 'Leads', '', ''],
      [fmt(totals.email), 'With email', pct + '% of all leads', 'ok'],
      [fmt(totals.todo), 'To check', 'have a website, no email yet', 'accent'],
      [fmt(totals.noWebsite), 'No website', 'nothing to crawl', 'bad'],
      [fmt(sum('checkedNone')), 'Checked · none', `in the ${rows.length} listed projects`, 'warn'],
      [fmt(sum('noPhone')), 'No phone', `in the ${rows.length} listed projects`, ''],
    );
  } else {
    const total = sum('total'), email = sum('email');
    tiles.push(
      [fmt(rows.length), 'Projects', 'in this browser', ''],
      [fmt(total), 'Leads', '', ''],
      [fmt(email), 'With email', (total ? ((email / total) * 100).toFixed(1) : '0') + '% of all leads', 'ok'],
      [fmt(sum('todo')), 'To check', 'have a website, no email yet', 'accent'],
      [fmt(sum('checkedNone')), 'Checked · none', 'site read, no email on it', 'warn'],
      [fmt(sum('checkedError')), 'Site failed', 'blocked / down / timeout', 'warn'],
      [fmt(sum('noSite')), 'No website', 'nothing to crawl', 'bad'],
      [fmt(sum('noPhone')), 'No phone', '', ''],
    );
  }
  $('tiles').innerHTML = tiles.map(([num, label, sub, cls]) =>
    `<div class="tile"><div class="t-num ${cls}">${num}</div><div class="t-label">${label}</div>${sub ? `<div class="t-sub">${sub}</div>` : ''}</div>`).join('');
}

function rowHTML(r) {
  const q = encodeURIComponent(r.query);
  const pct = r.total ? Math.round((r.email / r.total) * 100) : 0;
  const gaps = [r.noAddress ? `address ${fmt(r.noAddress)}` : '', r.noCategory ? `category ${fmt(r.noCategory)}` : '', r.noRating ? `rating ${fmt(r.noRating)}` : ''].filter(Boolean).join(' · ');
  const cls = [runningQuery === r.query ? 'running' : '', finished.has(r.query) ? 'finished' : ''].join(' ');
  return `<tr class="${cls}" data-q="${q}">
    <td class="cb"><input type="checkbox" class="pick" data-q="${q}" ${selected.has(r.query) ? 'checked' : ''}></td>
    <td class="pname" title="${esc(r.query)}">${esc(r.name || r.query)}</td>
    <td class="num">${fmt(r.total)}</td>
    <td class="num">${fmt(r.email)}<span class="mini-bar"><i style="width:${pct}%"></i></span></td>
    ${cell(r.todo, 'accent-txt')}${cell(r.checkedNone)}${cell(r.checkedError)}${cell(r.noSite)}${cell(r.noPhone)}
    <td class="muted">${gaps || '<span class="zero">—</span>'}</td>
    <td><button class="btn sm from" data-q="${q}" title="Start with this project, then continue down the list" ${running ? 'disabled' : ''}>▶ from here</button></td>
  </tr>`;
}

function render() {
  renderTiles();
  $('rows').innerHTML = rows.map(rowHTML).join('');
  const none = !rows.length;
  $('empty').classList.toggle('hidden', !none);
  if (none) $('empty').textContent = source === 'local'
    ? 'No projects in this browser. With "Stream to DB" on, finished searches live in the database — switch the source to ☁ Database.'
    : 'No projects match.';
  $('more').classList.toggle('hidden', !(source === 'db' && more));
  $('count').textContent = rows.length ? `${fmt(rows.length)} project(s) listed${source === 'db' && totals ? ` of ${fmt(totals.projects)}` : ''}` : '';
  updateStartHint();
}
function updateStartHint() {
  const n = selected.size;
  $('startHint').textContent = running ? '' : n ? `→ ${n} ticked project(s), in list order` : rows.length ? '→ all listed projects, top to bottom' : '';
  $('start').disabled = running || !rows.length;
  $('stop').disabled = !running;
}
function patchRow(fresh) {
  if (!fresh) return;
  const i = rows.findIndex((r) => r.query === fresh.query);
  if (i < 0) return;
  rows[i] = Object.assign({}, rows[i], fresh);
  const tr = [...$('rows').children].find((el) => decodeURIComponent(el.dataset.q) === fresh.query);
  if (tr) tr.outerHTML = rowHTML(rows[i]);
  renderTiles();
}
function markRow(query) {
  const tr = [...$('rows').children].find((el) => decodeURIComponent(el.dataset.q) === query);
  const r = rows.find((x) => x.query === query);
  if (tr && r) tr.outerHTML = rowHTML(r);
}

function showWarn(e) {
  const w = $('warn');
  if (!e) { w.classList.add('hidden'); return; }
  w.classList.remove('hidden');
  w.innerHTML = e.login
    ? `🔒 The database source needs your GridLeads web login. <a href="${SYNC_BASE}/login" target="_blank" rel="noopener">Log in here</a> in this browser, then press ⟳ Rescan.`
    : `⚠ ${esc(e.message || e)} — is ${esc(SYNC_BASE)} reachable?`;
}

async function load(append) {
  showWarn(null);
  if (!append) { $('rows').innerHTML = ''; $('empty').classList.remove('hidden'); $('empty').textContent = 'Scanning…'; }
  try {
    const res = await SRC[source].list(append ? rows.length : 0);
    // the server order shifts as projects get checked → never list one twice
    const have = new Set(append ? rows.map((r) => r.query) : []);
    rows = append ? rows.concat(res.rows.filter((r) => !have.has(r.query))) : res.rows;
    if (res.totals) totals = res.totals; else if (!append) totals = null;
    more = !!res.more;
    if (!append) { selected = new Set([...selected].filter((q) => rows.some((r) => r.query === q))); }
  } catch (e) {
    if (!append) { rows = []; totals = null; more = false; }
    showWarn(e);
  }
  render();
}

// ---------- the run ----------
const feed = [];
function pushFeed(r) {
  feed.unshift(r);
  if (feed.length > 150) feed.length = 150;
  $('feed').classList.remove('hidden');
  $('feed').innerHTML = feed.map((x) => {
    const host = (() => { try { return new URL(/^https?:/i.test(x.website) ? x.website : 'http://' + x.website).hostname.replace(/^www\./, ''); } catch { return x.website || ''; } })();
    const [icon, cls, txt] = x.status === 'found' ? ['✓', 'f-found', x.email]
      : x.status === 'error' ? ['⚠', 'f-err', x.error || 'site failed']
      : ['–', 'f-none', x.status === 'social' ? 'social profile, not a website' : 'no email on site'];
    return `<div class="feed-row"><span class="${cls}">${icon}</span><span title="${esc(x.name)}">${esc(x.name)}</span><span class="${cls}" title="${esc(txt)}">${esc(txt)}</span><span class="muted">${esc(host)}</span></div>`;
  }).join('');
}

const run = { projects: 0, projectIdx: 0, checked: 0, found: 0, none: 0, errors: 0, t0: 0 };
function setStatus(html, pct) { $('status').innerHTML = html; if (pct != null) $('pfill').style.width = Math.max(0, Math.min(100, pct)) + '%'; }

// Look up every open lead of one project. → false if the run must stop.
async function runProject(row, label) {
  const src = SRC[source];
  const retry = $('retry').checked;
  const conc = Number($('conc').value) || 8;
  const t0 = Date.now();
  if (!retry && !row.todo) return true; // nothing open here — don't spend a request on it
  runningQuery = row.query; markRow(row.query);
  setStatus(`${label} <b>${esc(row.name || row.query)}</b> — loading the leads to check…`);

  let queue;
  try { queue = await src.queue(row.query, retry); }
  catch (e) { showWarn(e); runningQuery = ''; markRow(row.query); return false; }

  const st = { done: 0, found: 0, none: 0, errors: 0, total: queue.length };
  const paint = () => setStatus(
    `${label} <b>${esc(row.name || row.query)}</b> — ${st.done}/${st.total} sites · <b>${st.found}</b> email(s) found · ${st.none} none · ${st.errors} failed\n`
    + `This run: ${fmt(run.checked)} sites checked · <b>${fmt(run.found)}</b> emails found · ${Math.round((Date.now() - run.t0) / 1000)}s`,
    st.total ? (st.done / st.total) * 100 : 100);
  paint();

  let buf = [];
  let saving = Promise.resolve();
  let saveError = null;
  const flush = () => {
    const batch = buf; buf = [];
    if (!batch.length) return saving;
    saving = saving.then(async () => {
      try {
        const out = await src.save(row.query, batch);
        await self.GridLeadsLog.logEmailResults(row.query, out.applied, 'audit', src.where);
        patchRow(out.row);
      } catch (e) { saveError = e; }
    });
    return saving;
  };

  let idx = 0;
  const worker = async () => {
    while (!stopping && !saveError && idx < queue.length) {
      const job = queue[idx++];
      const res = await bg({ type: 'emailLookup', website: job.website, limit: conc });
      if (!res || !res.status) continue; // service worker restarted mid-lookup → leave the lead unchecked
      const r = Object.assign({ key: job.key, name: job.name, website: job.website }, res);
      buf.push(r);
      st.done++; run.checked++;
      if (r.status === 'found') { st.found++; run.found++; } else if (r.status === 'error') { st.errors++; run.errors++; } else { st.none++; run.none++; }
      pushFeed(r); paint();
      if (buf.length >= SAVE_EVERY) flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, queue.length || 1) }, worker));
  await flush();
  await saving;

  runningQuery = '';
  if (!saveError && !stopping) finished.add(row.query);
  markRow(row.query);
  await self.GridLeadsLog.add({
    type: 'audit.project', project: row.query, n: st.found,
    title: `Email audit: ${st.done} site(s) checked → ${st.found} email(s) found, ${st.none} none, ${st.errors} failed${stopping && st.done < st.total ? ' (stopped)' : ''}`,
    data: { source: src.where, queued: st.total, checked: st.done, found: st.found, none: st.none, errors: st.errors, seconds: Math.round((Date.now() - t0) / 1000), retry },
  });
  if (saveError) { showWarn(saveError); return false; }
  return !stopping;
}

// list = the rows to process in order; follow = keep loading further database
// pages when the list runs out (only for "all" / "from here" runs).
async function startRun(list, follow) {
  if (running || !list.length) return;
  running = true; stopping = false;
  Object.assign(run, { projects: 0, checked: 0, found: 0, none: 0, errors: 0, t0: Date.now() });
  feed.length = 0; $('feed').innerHTML = '';
  render();
  const src = SRC[source];
  await self.GridLeadsLog.add({ type: 'audit.start', title: `Email audit started (${src.where}) — from “${list[0].query}”`, data: { source: src.where, projects: follow && source === 'db' ? 'all following' : list.length, retry: $('retry').checked, parallel: Number($('conc').value) } });

  let queue = list.slice();
  let ok = true;
  const paging = follow && source === 'db';
  while (ok && !stopping) {
    for (let i = 0; i < queue.length && ok && !stopping; i++) {
      if (!$('retry').checked && !queue[i].todo) continue; // nothing open in this project
      run.projects++;
      ok = await runProject(queue[i], `Project ${run.projects}${paging ? '' : '/' + list.length}:`);
    }
    if (!ok || stopping || !paging) break;
    // Next page. Checked projects drop to the bottom of the server's order, so
    // the next open ones are at the TOP again: re-ask from 0 and skip what is
    // already listed; only page deeper if a whole page was already seen.
    const seen = new Set(rows.map((r) => r.query));
    let next = [], skip = 0, exhausted = false;
    try {
      for (let guard = 0; guard < 50 && !next.length && !exhausted; guard++) {
        const res = await SRC.db.list(skip);
        if (res.totals) totals = res.totals;
        next = res.rows.filter((r) => !seen.has(r.query));
        if (!$('retry').checked && res.rows.length && res.rows.every((r) => !r.todo)) { next = []; exhausted = true; } // sorted by open work → nothing left
        if (!res.more) exhausted = true;
        skip += PAGE;
      }
    } catch (e) { showWarn(e); break; }
    if (!next.length) break;
    rows = rows.concat(next);
    render();
    queue = next;
  }

  running = false;
  // the database totals tiles cover ALL matching projects → re-read them after the run
  if (source === 'db') { try { const res = await SRC.db.list(0); if (res.totals) totals = res.totals; } catch { /* keep the old numbers */ } }
  const secs = Math.round((Date.now() - run.t0) / 1000);
  const summary = `${fmt(run.projects)} project(s) · ${fmt(run.checked)} sites checked · ${fmt(run.found)} emails found · ${fmt(run.none)} none · ${fmt(run.errors)} failed · ${secs}s`;
  await self.GridLeadsLog.add({ type: 'audit.done', n: run.found, title: `Email audit ${stopping ? 'stopped' : 'finished'} — ${summary}`, data: { source: src.where, projects: run.projects, checked: run.checked, found: run.found, none: run.none, errors: run.errors, seconds: secs } });
  setStatus(`<b>${stopping ? 'Stopped' : 'Done'}.</b> ${summary}\nEvery result is listed in the Changelog.`, 100);
  stopping = false;
  render();
}

// ---------- wiring ----------
$('start').addEventListener('click', () => {
  if (selected.size) startRun(rows.filter((r) => selected.has(r.query)), false);
  else startRun(rows, true);
});
$('stop').addEventListener('click', () => { if (running) { stopping = true; $('stop').disabled = true; setStatus($('status').innerHTML + '\nStopping after the sites in flight…'); } });
$('rows').addEventListener('click', (e) => {
  const from = e.target.closest('.from');
  if (from) { const q = decodeURIComponent(from.dataset.q); const i = rows.findIndex((r) => r.query === q); if (i >= 0) startRun(rows.slice(i), true); return; }
  const pick = e.target.closest('.pick');
  if (pick) { const q = decodeURIComponent(pick.dataset.q); if (pick.checked) selected.add(q); else selected.delete(q); updateStartHint(); }
});
$('selall').addEventListener('change', (e) => {
  selected = e.target.checked ? new Set(rows.map((r) => r.query)) : new Set();
  document.querySelectorAll('#rows .pick').forEach((c) => { c.checked = e.target.checked; });
  updateStartHint();
});
$('more').addEventListener('click', () => load(true));
$('rescan').addEventListener('click', () => { if (!running) { finished.clear(); load(false); } });
let qTimer = null;
$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { if (!running) load(false); }, 350); });

function applySource(s) {
  source = s === 'local' ? 'local' : 'db';
  localStorage.setItem('gl_audit_src', source);
  document.querySelectorAll('#src .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.src === source));
}
document.querySelectorAll('#src .seg-btn').forEach((b) => b.addEventListener('click', () => {
  if (running) return;
  applySource(b.dataset.src); selected.clear(); finished.clear(); load(false);
}));

$('conc').value = localStorage.getItem('gl_audit_conc') || '8';
$('conc').addEventListener('change', () => localStorage.setItem('gl_audit_conc', $('conc').value));
window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });

applySource(source);
load(false);
