// GridLeads Changelog — reads the activity log (lib/activityLog.js, IndexedDB)
// and shows it newest first, grouped by day, with filters and per-event details.
const $ = (id) => document.getElementById(id);
const Log = self.GridLeadsLog;
const PAGE = 200;
const fmt = (n) => Number(n || 0).toLocaleString();
function esc(v) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let group = '';
let range = 'today';
let events = [];
let nextBeforeId = null;
const open = new Set(); // expanded event ids

// type → [chip colour, label]
const KIND = {
  'leads.capture': ['green', 'New leads'], 'leads.change': ['amber', 'Changed'], 'leads.delete': ['red', 'Deleted'],
  'email.found': ['green', 'Email found'], 'email.none': ['gray', 'No email'], 'email.error': ['amber', 'Site failed'],
  'audit.start': ['blue', 'Audit'], 'audit.project': ['blue', 'Audit'], 'audit.done': ['blue', 'Audit'],
  'sync.stream': ['blue', 'DB sync'], 'sync.manual': ['blue', 'DB sync'], 'sync.error': ['red', 'Sync failed'],
  'project.create': ['pink', 'Project'], 'project.rename': ['pink', 'Project'], 'project.move': ['pink', 'Project'],
  'project.delete': ['red', 'Project'], 'project.import': ['pink', 'Import'], 'project.folder': ['pink', 'Folder'],
  'batch.enqueue': ['gray', 'Batch'], 'batch.start': ['gray', 'Batch'], 'batch.done': ['gray', 'Batch'], 'batch.stop': ['gray', 'Batch'],
  'settings.change': ['gray', 'Setting'],
};

// ---------- time window ----------
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
function windowMs() {
  const f = $('from').value, t = $('to').value;
  if (f || t) return { from: f ? dayStart(f + 'T00:00') : null, to: t ? dayStart(t + 'T00:00') + 86399999 : null };
  if (range === 'all') return { from: null, to: null };
  const days = range === 'today' ? 0 : Number(range) - 1;
  return { from: dayStart(Date.now()) - days * 86400000, to: null };
}
function filters() {
  const w = windowMs();
  return {
    group, from: w.from, to: w.to,
    project: $('project').value.trim(), text: $('text').value.trim(),
    exclude: $('hideMiss').checked ? ['email.none'] : [],
  };
}

// ---------- details ----------
const kv = (pairs) => `<table>${pairs.filter((p) => p && p[1] !== undefined && p[1] !== '' && p[1] !== null).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;
const link = (u) => (/^https?:\/\//i.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u || ''));
const show = (v) => (v === '' || v == null ? '<span class="muted">(empty)</span>' : esc(v));

function detailHTML(e) {
  const d = e.data || {};
  if (e.type === 'leads.capture') {
    const rows = (d.leads || []).map((l) => `<tr><td>${esc(l.name)}</td><td class="muted">${esc(l.category || '')}</td><td>${esc(l.phone || '')}</td><td>${l.website ? link(l.website) : `<span class="muted">${esc(l.websiteStatus || 'no website')}</span>`}</td></tr>`).join('');
    return `<div class="muted">Project now holds ${fmt(d.total)} lead(s). New in this capture:</div><table>${rows}</table>`;
  }
  if (e.type === 'leads.change') {
    return (d.changes || []).map((c) => `<div><b>${esc(c.name)}</b>${Object.entries(c.diff || {}).map(([f, [a, b]]) => `<div>&nbsp;&nbsp;<span class="k muted">${esc(f)}:</span> <span class="old">${show(a)}</span> → <span class="new">${show(b)}</span></div>`).join('')}</div>`).join('');
  }
  if (e.type === 'email.found') {
    return kv([
      ['Business', esc(d.name)], ['Email', `<b>${esc(d.email)}</b>`],
      (d.emails || []).length > 1 ? ['Also on the site', esc(d.emails.slice(1).join(', '))] : null,
      ['Read from', link(d.source)], ['Website', link(d.website)], d.phone ? ['Phone on site', esc(d.phone)] : null,
      ['Found by', d.via === 'audit' ? 'Email audit' : 'while scraping'], ['Stored in', esc(d.where)],
      d.saved === false ? ['Note', 'not saved — the lead already had an email, or it was gone by then'] : null,
      ['Pages opened', d.pages], ['Took', d.ms != null ? d.ms + ' ms' : ''],
    ]);
  }
  if (e.type === 'email.none' || e.type === 'email.error') {
    return kv([['Business', esc(d.name)], ['Website', link(d.website)], ['Result', esc(d.error || d.status || '')],
      ['Checked by', d.via === 'audit' ? 'Email audit' : 'while scraping'], ['Stored in', esc(d.where)], ['Pages opened', d.pages]]);
  }
  if (e.type === 'batch.enqueue') return (d.searches || []).map((q) => `<div>${esc(q)}</div>`).join('');
  // everything else: plain key/value dump
  const pairs = Object.entries(d).map(([k, v]) => [k, esc(typeof v === 'object' ? JSON.stringify(v) : v)]);
  return pairs.length ? kv(pairs) : '';
}
const hasDetail = (e) => !!(e.data && Object.keys(e.data).length);

// ---------- rendering ----------
function render() {
  $('empty').classList.toggle('hidden', events.length > 0);
  let html = '', lastDay = '';
  for (const e of events) {
    const dt = new Date(e.ts);
    const day = dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (day !== lastDay) { html += `<div class="day">${esc(day)}</div>`; lastDay = day; }
    const [cls, label] = KIND[e.type] || ['gray', e.type];
    const detail = open.has(e.id) && hasDetail(e) ? `<div class="ev-detail">${detailHTML(e)}</div>` : '';
    html += `<div class="ev ${hasDetail(e) ? 'has-detail' : ''}" data-id="${e.id}">
      <span class="ev-time">${dt.toLocaleTimeString(undefined, { hour12: false })}</span>
      <span><span class="chip ${cls}">${esc(label)}</span></span>
      <span class="ev-title">${esc(e.title || e.type)}${e.project ? `<span class="ev-proj" data-proj="${esc(e.project)}">📁 ${esc(e.project)}</span>` : ''}</span>
      ${detail}
    </div>`;
  }
  $('list').innerHTML = html;
  $('more').classList.toggle('hidden', nextBeforeId == null);
  $('count').textContent = events.length ? `${fmt(events.length)} event(s) shown` : '';
}

async function renderTiles() {
  const w = windowMs();
  const s = await Log.summary(w.from == null ? 0 : w.from, w.to);
  const n = (t) => (s[t] ? s[t].n : 0), ev = (t) => (s[t] ? s[t].events : 0);
  const checked = ev('email.found') + ev('email.none') + ev('email.error');
  const tiles = [
    [fmt(n('leads.capture')), 'New leads in', '', 'accent'],
    [fmt(n('leads.change')), 'Leads changed', 'on a re-scrape', 'warn'],
    [fmt(ev('email.found')), 'Emails found', checked ? `${((ev('email.found') / checked) * 100).toFixed(0)}% of checked sites` : '', 'ok'],
    [fmt(checked), 'Websites checked', `${fmt(ev('email.error'))} failed to load`, ''],
    [fmt(n('sync.stream') + n('sync.manual')), 'Leads synced to DB', ev('sync.error') ? `${fmt(ev('sync.error'))} sync error(s)` : '', ''],
    [fmt(n('leads.delete')), 'Leads deleted', '', n('leads.delete') ? 'bad' : ''],
  ];
  $('tiles').innerHTML = tiles.map(([num, label, sub, cls]) =>
    `<div class="tile"><div class="t-num ${cls}">${num}</div><div class="t-label">${label}</div>${sub ? `<div class="t-sub">${sub}</div>` : ''}</div>`).join('');
  $('logsize').textContent = `${fmt(await Log.count())} events stored (oldest are dropped past 150,000)`;
}

async function load(append) {
  const res = await Log.query(Object.assign(filters(), { limit: PAGE, beforeId: append ? nextBeforeId : undefined }));
  events = append ? events.concat(res.events) : res.events;
  nextBeforeId = res.nextBeforeId;
  render();
  if (!append) renderTiles();
}

// ---------- wiring ----------
document.querySelectorAll('.chipbtn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chipbtn').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); group = b.dataset.group; load(false);
}));
document.querySelectorAll('#range .seg-btn').forEach((b) => b.addEventListener('click', () => {
  range = b.dataset.range; $('from').value = ''; $('to').value = '';
  document.querySelectorAll('#range .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  load(false);
}));
['from', 'to'].forEach((id) => $(id).addEventListener('change', () => {
  document.querySelectorAll('#range .seg-btn').forEach((x) => x.classList.toggle('active', !$('from').value && !$('to').value && x.dataset.range === range));
  load(false);
}));
let timer = null;
['text', 'project'].forEach((id) => $(id).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(false), 250); }));
$('hideMiss').addEventListener('change', () => load(false));
$('more').addEventListener('click', () => load(true));

$('list').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const proj = e.target.closest('.ev-proj');
  if (proj) { $('project').value = proj.dataset.proj; load(false); return; }
  if (e.target.closest('.ev-detail')) return; // let text inside the details be selected
  const row = e.target.closest('.ev.has-detail');
  if (!row) return;
  const id = Number(row.dataset.id);
  if (open.has(id)) open.delete(id); else open.add(id);
  render();
});

// Export what the current filter matches (all pages, capped) as JSON.
$('exportBtn').addEventListener('click', async () => {
  const all = []; let before;
  for (let i = 0; i < 100; i++) {
    const res = await Log.query(Object.assign(filters(), { limit: 1000, beforeId: before }));
    all.push(...res.events);
    if (res.nextBeforeId == null) break;
    before = res.nextBeforeId;
  }
  const out = all.map((e) => Object.assign({ at: new Date(e.ts).toISOString() }, e));
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gridleads-changelog-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
});
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Delete the whole changelog? Leads and emails are not touched — only this history.')) return;
  await Log.clear(); open.clear(); load(false);
});

// Live: while enabled and nothing older is paged in, pull in whatever is new.
setInterval(async () => {
  if (!$('live').checked || document.hidden || events.length > PAGE) return;
  const res = await Log.query(Object.assign(filters(), { limit: PAGE }));
  const newest = res.events[0] && res.events[0].id, shown = events[0] && events[0].id;
  if (newest === shown) return;
  events = res.events; nextBeforeId = res.nextBeforeId;
  render(); renderTiles();
}, 3000);

load(false);
