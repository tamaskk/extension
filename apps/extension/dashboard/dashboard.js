// GridLeads dashboard — project-aware. Reads projects + records from the
// background service worker and renders the LeadsMap-style table.
const PKEY = 'gridleads_projects';
const $ = (id) => document.getElementById(id);
const NO_SITE = new Set(['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING']);

let projects = [];       // [{query,name,createdAt,folderId,total,noWebsite,hot,email}]
let folders = [];        // [{id,name,createdAt,collapsed}]
let selected = new Set();// queries selected via the sidebar checkboxes
let lastChecked = null;  // last toggled project query (anchor for shift+click range)
let activeProject = null; // query string, or null = All
let rows = [];           // records for the active selection
const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : 1);
let filter = 'all';
let term = '';
let sortKey = 'opportunityScore';
let sortDir = -1; // 1 = ascending, -1 = descending

// Field types so the comparator knows how to order each column.
const SORTABLE = {
  checked: 'has', name: 'str', category: 'str', rating: 'num', reviewCount: 'num',
  phone: 'has', email: 'has', websiteStatus: 'str',
  opportunityScore: 'num', leadScore: 'num', leadTemperature: 'temp', address: 'str',
};
const TEMP_ORDER = { COLD: 0, WARM: 1, HOT: 2 };

function compare(a, b) {
  const type = SORTABLE[sortKey] || 'str';
  let av = a[sortKey], bv = b[sortKey];
  if (type === 'num') return ((av || 0) - (bv || 0)) * sortDir;
  if (type === 'temp') return ((TEMP_ORDER[av] || 0) - (TEMP_ORDER[bv] || 0)) * sortDir;
  if (type === 'has') {
    const an = av ? 1 : 0, bn = bv ? 1 : 0;
    if (an !== bn) return (an - bn) * sortDir;
    return String(av || '').localeCompare(String(bv || '')) * sortDir;
  }
  return String(av || '').localeCompare(String(bv || '')) * sortDir;
}

const msg = (m) => chrome.runtime.sendMessage(m);

async function loadProjects() {
  projects = (await msg({ type: 'getProjects' })) || [];
  folders = (await msg({ type: 'getFolders' })) || [];
  renderSidebar();
  await loadRecords();
}

async function loadRecords() {
  rows = (await msg({ type: 'getRecords', query: activeProject || undefined })) || [];
  render();
}

function projectItemHTML(p) {
  return `
    <div class="navitem proj ${activeProject === p.query ? 'active' : ''}" data-q="${encodeURIComponent(p.query)}">
      <input type="checkbox" class="proj-check" data-q="${encodeURIComponent(p.query)}" ${selected.has(p.query) ? 'checked' : ''}>
      <span class="ni-name" title="${escAttr(p.name)}">${esc(p.name)}</span>
      <span class="ni-right">
        <span class="badge ${p.noWebsite ? 'accent' : ''}">${p.total}</span>
        <span class="edit" data-edit="${encodeURIComponent(p.query)}" title="Rename">✎</span>
        <span class="del" data-del="${encodeURIComponent(p.query)}" title="Delete">✕</span>
      </span>
    </div>`;
}

function folderHeaderHTML(f, count) {
  return `
    <div class="folder" data-fid="${f.id}">
      <span class="caret">${f.collapsed ? '▸' : '▾'}</span>
      <span class="fname" title="${escAttr(f.name)}">📁 ${esc(f.name)}</span>
      <span class="ni-right">
        <span class="badge">${count}</span>
        <span class="fsync" data-fsync="${f.id}" title="Sync folder to web">⟳</span>
        <span class="fexport" data-fexport="${f.id}" title="Export folder (JSON)">⤓</span>
        <span class="fedit" data-fedit="${f.id}" title="Rename folder">✎</span>
        <span class="fdel" data-fdel="${f.id}" title="Delete folder">✕</span>
      </span>
    </div>`;
}

function renderSidebar() {
  const total = projects.reduce((s, p) => s + p.total, 0);
  const html = [`
    <div class="navitem all ${activeProject === null ? 'active' : ''}" data-q="__all__">
      <span class="ni-name">All leads</span><span class="badge">${total}</span>
    </div>`];

  const byId = {};
  folders.forEach((f) => { byId[f.id] = f; });
  const grouped = {};
  const ungrouped = [];
  projects.forEach((p) => {
    if (p.folderId && byId[p.folderId]) (grouped[p.folderId] = grouped[p.folderId] || []).push(p);
    else ungrouped.push(p);
  });

  folders.slice().sort(byCreated).forEach((f) => {
    const fp = (grouped[f.id] || []).sort(byCreated);
    const count = fp.reduce((s, p) => s + p.total, 0);
    html.push(folderHeaderHTML(f, count));
    if (!f.collapsed) fp.forEach((p) => html.push(projectItemHTML(p)));
  });
  ungrouped.sort(byCreated).forEach((p) => html.push(projectItemHTML(p)));

  $('projects').innerHTML = html.join('');
  wireSidebar();
  updateBulkBar();

  const title = activeProject === null ? 'All leads'
    : (projects.find((p) => p.query === activeProject)?.name || activeProject);
  $('title').textContent = title;
}

function wireSidebar() {
  $('projects').querySelectorAll('.navitem').forEach((b) => {
    b.addEventListener('click', (e) => {
      if (e.target.closest('.proj-check, .edit, .del')) return;
      const q = b.dataset.q;
      activeProject = q === '__all__' ? null : decodeURIComponent(q);
      renderSidebar();
      loadRecords();
    });
  });
  $('projects').querySelectorAll('.proj-check').forEach((c) => {
    c.addEventListener('click', (e) => {
      e.stopPropagation(); // don't open the project
      const q = decodeURIComponent(c.dataset.q);
      const target = c.checked; // new state after the click toggled it

      if (e.shiftKey && lastChecked) {
        // select/deselect the whole range between the anchor and this one (DOM order)
        const checks = [...$('projects').querySelectorAll('.proj-check')];
        const a = checks.findIndex((x) => decodeURIComponent(x.dataset.q) === lastChecked);
        const b = checks.indexOf(c);
        if (a !== -1 && b !== -1) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          for (let i = lo; i <= hi; i++) {
            checks[i].checked = target;
            const qq = decodeURIComponent(checks[i].dataset.q);
            if (target) selected.add(qq); else selected.delete(qq);
          }
        }
      } else if (target) {
        selected.add(q);
      } else {
        selected.delete(q);
      }
      lastChecked = q;
      updateBulkBar();
    });
  });
  $('projects').querySelectorAll('.edit').forEach((ed) => {
    ed.addEventListener('click', async (e) => {
      e.stopPropagation();
      const q = decodeURIComponent(ed.dataset.edit);
      const proj = projects.find((p) => p.query === q);
      const next = prompt('Rename project:', proj ? proj.name : q);
      if (next && next.trim()) { await msg({ type: 'renameProject', query: q, name: next.trim() }); await loadProjects(); }
    });
  });
  $('projects').querySelectorAll('.del').forEach((d) => {
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      const q = decodeURIComponent(d.dataset.del);
      if (!confirm(`Delete project "${q}" and all its leads?`)) return;
      await msg({ type: 'deleteProject', query: q });
      selected.delete(q);
      if (activeProject === q) activeProject = null;
      await loadProjects();
    });
  });
  $('projects').querySelectorAll('.fexport').forEach((ex) => {
    ex.addEventListener('click', (e) => {
      e.stopPropagation();
      exportJsonFile({ folderId: ex.dataset.fexport });
    });
  });
  $('projects').querySelectorAll('.fsync').forEach((sy) => {
    sy.addEventListener('click', (e) => {
      e.stopPropagation();
      syncBundle({ folderId: sy.dataset.fsync });
    });
  });
  $('projects').querySelectorAll('.folder').forEach((fh) => {
    fh.addEventListener('click', async (e) => {
      if (e.target.closest('.fedit, .fdel, .fexport, .fsync')) return;
      const id = fh.dataset.fid;
      const f = folders.find((x) => x.id === id);
      await msg({ type: 'setFolderCollapsed', id, collapsed: !(f && f.collapsed) });
      await loadProjects();
    });
  });
  $('projects').querySelectorAll('.fedit').forEach((ed) => {
    ed.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = ed.dataset.fedit;
      const f = folders.find((x) => x.id === id);
      const next = prompt('Rename folder:', f ? f.name : '');
      if (next && next.trim()) { await msg({ type: 'renameFolder', id, name: next.trim() }); await loadProjects(); }
    });
  });
  $('projects').querySelectorAll('.fdel').forEach((d) => {
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = d.dataset.fdel;
      if (!confirm('Delete this folder? Its projects move back to ungrouped (leads kept).')) return;
      await msg({ type: 'deleteFolder', id });
      await loadProjects();
    });
  });
}

function updateBulkBar() {
  const n = selected.size;
  $('bulkbar').classList.toggle('hidden', n === 0);
  $('bulkcount').textContent = n;
  const opts = ['<option value="">Move to…</option>', '<option value="__root__">↥ Ungrouped (root)</option>']
    .concat(folders.slice().sort(byCreated).map((f) => `<option value="${f.id}">📁 ${esc(f.name)}</option>`));
  $('moveTo').innerHTML = opts.join('');
}

function statusChip(s) {
  const map = {
    HAS_WEBSITE: ['green', 'Has site'], NO_WEBSITE: ['red', 'No website'],
    FACEBOOK_ONLY: ['blue', 'Facebook only'], INSTAGRAM_ONLY: ['pink', 'Instagram only'],
    BROKEN: ['amber', 'Broken'], DOMAIN_EXPIRED: ['amber', 'Expired'],
    DOMAIN_PARKED: ['amber', 'Parked'], UNDER_CONSTRUCTION: ['amber', 'Under constr.'],
    NOT_WORKING: ['amber', 'Not working'], REDIRECTS: ['amber', 'Redirects'],
  };
  const [cls, label] = map[s] || ['gray', s || '—'];
  return `<span class="chip ${cls}">${label}</span>`;
}
function esc(v) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

// ---------- downloads (built on the page, not the SW: no data:-URL size limit) ----------
function slugify(s) { return String(s || 'export').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export'; }
function downloadBlob(content, mime, hint, ext) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gridleads-${slugify(hint)}-${stamp}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
async function exportJsonFile(opts, hintFallback) {
  const res = await msg(Object.assign({ type: 'exportJson' }, opts));
  if (res && res.ok && res.bundle) downloadBlob(JSON.stringify(res.bundle, null, 2), 'application/json', res.hint || hintFallback, 'json');
}

// ---------- sync to the web app (MongoDB) ----------
const SYNC_BASE = 'https://gridleads-wheat.vercel.app'; // deployed web app (use http://localhost:3000 for local dev)
const SYNC_CHUNK = 500; // leads per request — stays well under Vercel's 4.5MB body limit

async function postSync(payload) {
  const r = await fetch(SYNC_BASE + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 413 ? ' (chunk too large)' : ''));
  return r.json();
}

// ----- live sync progress toast -----
let syncToast = null;
function showSync(html, kind) {
  if (!syncToast) { syncToast = document.createElement('div'); syncToast.className = 'sync-toast'; document.body.appendChild(syncToast); }
  syncToast.className = 'sync-toast' + (kind ? ' ' + kind : '');
  syncToast.innerHTML = html;
  syncToast.style.display = 'block';
}
function hideSync(delay) { if (syncToast) setTimeout(() => { if (syncToast) syncToast.style.display = 'none'; }, delay || 0); }
const fmt = (n) => n.toLocaleString();

// Sync in chunks so a big project never exceeds the serverless body limit,
// with a live progress panel: which request we're on and how many are left.
async function syncBundle(opts) {
  const res = await msg(Object.assign({ type: 'exportJson' }, opts));
  if (!res || !res.ok || !res.bundle) return;
  const folders = res.bundle.folders || {};
  const projects = Object.values(res.bundle.projects || {});

  // totals up front, so we can show "request X/Y · Z left"
  let totalLeads = 0, totalReqs = 0;
  for (const p of projects) { const n = Object.keys(p.records || {}).length; totalLeads += n; totalReqs += n ? Math.ceil(n / SYNC_CHUNK) : 1; }
  if (Object.keys(folders).length) totalReqs += 1;

  let doneReqs = 0, doneLeads = 0, projCount = 0, leadCount = 0, skipped = 0;
  const render = () => {
    const pct = totalReqs ? Math.round((doneReqs / totalReqs) * 100) : 100;
    showSync(`<b>⤴ Syncing to web…</b><div class="st-bar"><div class="st-fill" style="width:${pct}%"></div></div>`
      + `request <b>${doneReqs}/${totalReqs}</b> · <b>${totalReqs - doneReqs}</b> left<br>`
      + `${fmt(doneLeads)} / ${fmt(totalLeads)} leads`);
  };
  render();

  try {
    if (Object.keys(folders).length) { await postSync({ gridleads: 1, folders, projects: {} }); doneReqs++; render(); }
    let sentFolders = Object.keys(folders).length > 0;
    for (const p of projects) {
      const meta = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId };
      const entries = Object.entries(p.records || {});
      if (!entries.length) {
        await postSync({ gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: {} } } });
        sentFolders = true; doneReqs++; projCount++; render(); continue;
      }
      for (let i = 0; i < entries.length; i += SYNC_CHUNK) {
        const slice = entries.slice(i, i + SYNC_CHUNK);
        const j = await postSync({ gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: Object.fromEntries(slice) } } });
        sentFolders = true; doneReqs++; doneLeads += slice.length;
        if (j) { leadCount += (j.added || 0) + (j.updated || 0); skipped += (j.skippedDuplicates || 0); }
        render();
      }
      projCount++;
    }
    showSync(`<b>✓ Sync complete</b><br>${projCount} project(s) · ${fmt(leadCount)} lead(s)${skipped ? ` · ${fmt(skipped)} dupes skipped` : ''}`, 'ok');
    hideSync(6000);
  } catch (e) {
    showSync(`<b>❌ Sync failed</b><br>${e.message} (at request ${doneReqs}/${totalReqs})<br>Is ${SYNC_BASE} reachable & MongoDB allowing Vercel?`, 'err');
    hideSync(10000);
  }
}
const CSV_COLUMNS = [
  ['name', 'Business'], ['category', 'Category'], ['rating', 'Rating'], ['reviewCount', 'Reviews'],
  ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['websiteStatus', 'Website Status'],
  ['leadScore', 'Lead Score'], ['leadTemperature', 'Temperature'], ['opportunityScore', 'Opportunity Score'],
  ['topPitch', 'Top Pitch'], ['address', 'Address'], ['lat', 'Lat'], ['lng', 'Lng'], ['mapsUrl', 'Maps URL'],
];
function csvEscape(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function buildCsv(list) {
  const header = CSV_COLUMNS.map((c) => c[1]).join(',');
  const body = list.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c[0]])).join(',')).join('\n');
  return header + '\n' + body;
}

function matches(r) {
  if (filter === 'nowebsite' && !NO_SITE.has(r.websiteStatus)) return false;
  if (filter === 'haswebsite' && r.websiteStatus !== 'HAS_WEBSITE') return false;
  if (filter === 'hot' && r.leadTemperature !== 'HOT') return false;
  if (filter === 'email' && !r.email) return false;
  if (term) {
    const hay = `${r.name} ${r.category} ${r.address} ${r.phone} ${r.email || ''}`.toLowerCase();
    if (!hay.includes(term)) return false;
  }
  return true;
}
function sortRows(list) {
  return list.sort(compare);
}

// Reflect the current sort on the clickable headers (▲ / ▼).
function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const arrow = th.dataset.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    th.dataset.label = th.dataset.label || th.textContent.replace(/[ ▲▼]+$/, '');
    th.textContent = th.dataset.label + arrow;
    th.classList.toggle('active', th.dataset.key === sortKey);
  });
}

function render() {
  const total = rows.length;
  const noweb = rows.filter((r) => NO_SITE.has(r.websiteStatus)).length;
  const hot = rows.filter((r) => r.leadTemperature === 'HOT').length;
  const email = rows.filter((r) => r.email).length;
  const avg = total ? Math.round(rows.reduce((s, r) => s + (r.opportunityScore || 0), 0) / total) : 0;
  $('w-total').textContent = total; $('w-noweb').textContent = noweb;
  $('w-hot').textContent = hot; $('w-email').textContent = email; $('w-avg').textContent = avg;

  const view = sortRows(rows.filter(matches));
  $('rowcount').textContent = view.length;
  $('empty').classList.toggle('hidden', total !== 0);
  updateSortIndicators();

  $('rows').innerHTML = view.map((r) => {
    const opp = r.opportunityScore || 0;
    const phone = r.phone ? esc(r.phone) : '<span class="muted">—</span>';
    const email2 = r.email ? esc(r.email) : '<span class="muted">—</span>';
    const maps = r.mapsUrl ? `<a class="mlink" href="${esc(r.mapsUrl)}" target="_blank">open ↗</a>` : '';
    const title = r.topPitch ? ` title="${escAttr(r.topPitch)}"` : '';
    const web = r.website ? `<a class="mlink" href="${esc(r.website)}" target="_blank">${statusChip(r.websiteStatus)}</a>` : statusChip(r.websiteStatus);
    const k = encodeURIComponent(r._key || r.dedupKey || '');
    const pj = encodeURIComponent(r._project || '');
    return `<tr${title}>
      <td class="cb"><input type="checkbox" class="selcheck"></td>
      <td class="cb"><input type="checkbox" class="rowcheck" data-k="${k}" data-p="${pj}" ${r.checked ? 'checked' : ''}></td>
      <td class="bizname" title="${escAttr(r.name)}">${esc(r.name)}</td>
      <td class="muted">${esc(r.category)}</td>
      <td>${r.rating ?? '—'}</td>
      <td class="muted">${r.reviewCount ?? '—'}</td>
      <td>${phone}</td>
      <td>${email2}</td>
      <td>${web}</td>
      <td><div class="opp"><div class="track"><div class="fill" style="width:${opp}%"></div></div><div class="val">${opp}</div></div></td>
      <td><span class="temp ${r.leadTemperature}">${r.leadTemperature || ''}</span></td>
      <td class="muted loc" title="${escAttr(r.address || '')}">${esc(r.address || '')}</td>
      <td>${maps}</td>
    </tr>`;
  }).join('');
}

// wiring
document.querySelectorAll('.chipbtn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.chipbtn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    filter = b.dataset.filter;
    render();
  });
});
$('search').addEventListener('input', (e) => { term = e.target.value.trim().toLowerCase(); render(); });

const DROPDOWN_SORT = {
  opportunity_desc: ['opportunityScore', -1], score_desc: ['leadScore', -1],
  rating_desc: ['rating', -1], rating_asc: ['rating', 1],
  reviews_desc: ['reviewCount', -1], name_asc: ['name', 1],
};
$('sort').addEventListener('change', (e) => {
  const m = DROPDOWN_SORT[e.target.value];
  if (m) { sortKey = m[0]; sortDir = m[1]; render(); }
});

// Click a column header to sort by it; click again to flip direction.
document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortDir *= -1;
    } else {
      sortKey = key;
      // numbers/score/temp default to descending (high→low); text to ascending
      sortDir = (SORTABLE[key] === 'num' || SORTABLE[key] === 'temp') ? -1 : 1;
    }
    render();
  });
});
$('refresh').addEventListener('click', loadProjects);

// folder + bulk-action controls
$('newFolder').addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (name && name.trim()) { await msg({ type: 'createFolder', name: name.trim() }); await loadProjects(); }
});
$('bulkClear').addEventListener('click', () => { selected.clear(); renderSidebar(); });
$('exportJson').addEventListener('click', () => exportJsonFile(activeProject ? { queries: [activeProject] } : {}, activeProject || 'all'));
$('exportAll').addEventListener('click', () => exportJsonFile({}, 'all'));
$('bulkExport').addEventListener('click', () => { if (selected.size) exportJsonFile({ queries: [...selected] }, `${selected.size}-projects`); });
$('syncAll').addEventListener('click', () => { if (confirm('Sync ALL projects to the web app? This uploads every lead.')) syncBundle({}); });
$('bulkSync').addEventListener('click', () => { if (selected.size) syncBundle({ queries: [...selected] }); });
// ---------- import modal ----------
async function doImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { $('importResult').textContent = '❌ Invalid JSON — check the file/text.'; return; }
  $('importResult').textContent = 'Importing…';
  const res = await msg({ type: 'importJson', data });
  if (res && res.ok) {
    $('importResult').textContent = `✓ Imported ${res.addedProjects} new project(s), ${res.mergedRecords} new lead(s) merged.`;
    await loadProjects();
  } else {
    $('importResult').textContent = '❌ Not a valid GridLeads export (need a { projects: … } JSON).';
  }
}
$('importBtn').addEventListener('click', () => {
  $('importText').value = '';
  $('importResult').textContent = '';
  $('importOverlay').classList.remove('hidden');
});
$('importClose').addEventListener('click', () => $('importOverlay').classList.add('hidden'));
$('importOverlay').addEventListener('click', (e) => { if (e.target === $('importOverlay')) $('importOverlay').classList.add('hidden'); });
$('importChoose').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { await doImport(await file.text()); } catch { $('importResult').textContent = '❌ Could not read the file.'; }
  e.target.value = '';
});
$('importGo').addEventListener('click', () => {
  const text = $('importText').value.trim();
  if (!text) { $('importResult').textContent = 'Paste JSON or choose a file first.'; return; }
  doImport(text);
});
$('moveTo').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (!v || !selected.size) { e.target.value = ''; return; }
  await msg({ type: 'moveProjects', queries: [...selected], folderId: v === '__root__' ? null : v });
  selected.clear();
  await loadProjects();
});
$('bulkRename').addEventListener('click', async () => {
  if (!selected.size) return;
  const name = prompt(`Rename ${selected.size} selected project(s) to:`);
  if (name && name.trim()) { await msg({ type: 'renameProjects', queries: [...selected], name: name.trim() }); selected.clear(); await loadProjects(); }
});
$('bulkDelete').addEventListener('click', async () => {
  if (!selected.size) return;
  if (!confirm(`Delete ${selected.size} selected project(s) and all their leads?`)) return;
  await msg({ type: 'deleteProjects', queries: [...selected] });
  selected.clear();
  await loadProjects();
});
$('export').addEventListener('click', async () => {
  const list = (await msg({ type: 'getRecords', query: activeProject || undefined })) || [];
  let out = filter === 'nowebsite' ? list.filter((r) => NO_SITE.has(r.websiteStatus)) : list;
  out = out.sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0));
  downloadBlob(buildCsv(out), 'text/csv;charset=utf-8', activeProject || 'all', 'csv');
});
$('selall').addEventListener('change', (e) => {
  document.querySelectorAll('#rows .selcheck').forEach((c) => { c.checked = e.target.checked; });
});

// Persist the "Checked" column per business (saved in the project store).
$('rows').addEventListener('change', async (e) => {
  const cb = e.target.closest('.rowcheck');
  if (!cb) return;
  const key = decodeURIComponent(cb.dataset.k);
  const proj = decodeURIComponent(cb.dataset.p);
  await msg({ type: 'setChecked', query: proj, key, checked: cb.checked });
  const rec = rows.find((r) => r._key === key && r._project === proj);
  if (rec) rec.checked = cb.checked; // keep in-memory in sync (no re-render, row stays put)
});

// ---------- duplicates finder ----------
// Identity: prefer Google ids (cid/placeId); fall back to normalized name+coords.
function dupeIdentity(r) {
  if (r.cid) return 'cid:' + r.cid;
  if (r.placeId) return 'pid:' + r.placeId;
  const lat = typeof r.lat === 'number' ? r.lat.toFixed(4) : '';
  const lng = typeof r.lng === 'number' ? r.lng.toFixed(4) : '';
  return 'nm:' + String(r.name || '').toLowerCase().trim() + '|' + lat + '|' + lng;
}

function projectDisplayName(query) {
  const p = projects.find((x) => x.query === query);
  return p ? p.name : query;
}

async function openDupes() {
  $('dupeOverlay').classList.remove('hidden');
  $('dupeBody').innerHTML = '<div class="dupe-empty">Scanning…</div>';
  $('dupeCount').textContent = '…';
  // the background computes the groups (small payload, scales to 30k+ leads)
  const dupes = (await msg({ type: 'getDuplicates' })) || [];
  renderDupes(dupes);
  lastDupeIdx = null; // list rebuilt → reset the shift+click anchor
  updateDupeSelCount();
}

function renderDupes(dupes) {
  $('dupeCount').textContent = dupes.length;
  if (!dupes.length) {
    $('dupeBody').innerHTML = '<div class="dupe-empty">🎉 No duplicates found — every business appears in only one project.</div>';
    return;
  }
  $('dupeBody').innerHTML = dupes.map((g, gi) => {
    const first = g[0];
    const rows = g.map((r) => `
      <div class="dupe-row" data-g="${gi}">
        <input type="checkbox" class="dupe-check" data-p="${encodeURIComponent(r._project)}" data-k="${encodeURIComponent(r._key)}">
        <span class="dupe-proj" data-goto="${encodeURIComponent(r._project)}" title="Open project: ${escAttr(projectDisplayName(r._project))}">📁 ${esc(projectDisplayName(r._project))}</span>
        <span class="dupe-info">${esc(r.category || '')}${r.rating ? ` · ★ ${r.rating}` : ''}${r.reviewCount ? ` · ${r.reviewCount} reviews` : ''}${r.checked ? ' · ✓ checked' : ''}</span>
        <button class="dupe-del" data-p="${encodeURIComponent(r._project)}" data-k="${encodeURIComponent(r._key)}">Delete</button>
      </div>`).join('');
    return `
      <div class="dupe-group" data-g="${gi}">
        <div class="dupe-group-head">
          <span class="dupe-name">${esc(first.name)}</span>
          <span class="dupe-meta">${esc(first.address || '')} · in ${g.length} projects</span>
          <button class="dupe-fix" title="Keep the last copy, delete the rest">⚡ Fix it</button>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

$('dupes').addEventListener('click', openDupes);
$('dupeClose').addEventListener('click', () => $('dupeOverlay').classList.add('hidden'));
$('dupeOverlay').addEventListener('click', (e) => {
  if (e.target === $('dupeOverlay')) $('dupeOverlay').classList.add('hidden');
});

function updateDupeSelCount() {
  const n = $('dupeBody').querySelectorAll('.dupe-check:checked').length;
  $('dupeSelCount').textContent = n;
  $('dupeDeleteSel').classList.toggle('hidden', n === 0);
}

// shift+click range selection — same behaviour as the sidebar project list
let lastDupeIdx = null;
$('dupeBody').addEventListener('click', (e) => {
  const cb = e.target.closest('.dupe-check');
  if (!cb) return;
  const checks = [...$('dupeBody').querySelectorAll('.dupe-check')];
  const idx = checks.indexOf(cb);
  if (e.shiftKey && lastDupeIdx !== null && lastDupeIdx !== idx) {
    const target = cb.checked; // the clicked box's new state drives the range
    const lo = Math.min(lastDupeIdx, idx), hi = Math.max(lastDupeIdx, idx);
    for (let i = lo; i <= hi; i++) checks[i].checked = target;
  }
  lastDupeIdx = idx;
  updateDupeSelCount();
});

// bulk delete every checked copy (one storage write), then rebuild the list
$('dupeDeleteSel').addEventListener('click', async () => {
  const checks = [...$('dupeBody').querySelectorAll('.dupe-check:checked')];
  if (!checks.length) return;
  if (!confirm(`Delete ${checks.length} selected copies?`)) return;
  const items = checks.map((c) => ({ query: decodeURIComponent(c.dataset.p), key: decodeURIComponent(c.dataset.k) }));
  await msg({ type: 'deleteRecords', items });
  await loadProjects();
  await openDupes(); // rebuild groups from fresh data
  updateDupeSelCount();
});

// "Fix all" — apply the keep-last rule to EVERY group in one bulk operation
$('dupeFixAll').addEventListener('click', async () => {
  const groups = [...$('dupeBody').querySelectorAll('.dupe-group')];
  if (!groups.length) return;
  const items = [];
  for (const group of groups) {
    const rows = [...group.querySelectorAll('.dupe-row')];
    for (const row of rows.slice(0, -1)) { // keep the last copy of each group
      const d = row.querySelector('.dupe-del');
      items.push({ query: decodeURIComponent(d.dataset.p), key: decodeURIComponent(d.dataset.k) });
    }
  }
  if (!items.length) return;
  if (!confirm(`Fix all ${groups.length} groups? This deletes ${items.length} duplicate copies (the last copy of each business is kept).`)) return;
  const btn = $('dupeFixAll');
  btn.disabled = true;
  btn.textContent = '⚡ Fixing…';
  await msg({ type: 'deleteRecords', items });
  btn.disabled = false;
  btn.textContent = '⚡ Fix all';
  await loadProjects();
  await openDupes(); // rebuild — should show "no duplicates left"
});

// delete one copy: remove from its project, drop the row; if only one copy
// remains in the group, the whole group disappears (no longer a duplicate)
$('dupeBody').addEventListener('click', async (e) => {
  // "Fix it" → keep the LAST copy in the group, delete all the others
  const fix = e.target.closest('.dupe-fix');
  if (fix) {
    fix.disabled = true;
    const group = fix.closest('.dupe-group');
    const rows = [...group.querySelectorAll('.dupe-row')];
    const toDelete = rows.slice(0, -1); // everything except the last row
    const items = toDelete.map((row) => {
      const d = row.querySelector('.dupe-del');
      return { query: decodeURIComponent(d.dataset.p), key: decodeURIComponent(d.dataset.k) };
    });
    await msg({ type: 'deleteRecords', items });
    group.remove(); // only one copy left → no longer a duplicate
    $('dupeCount').textContent = String(Math.max(0, parseInt($('dupeCount').textContent, 10) - 1));
    if (!$('dupeBody').querySelector('.dupe-group')) {
      $('dupeBody').innerHTML = '<div class="dupe-empty">🎉 No duplicates left.</div>';
    }
    lastDupeIdx = null; // row indexes shifted → reset the shift+click anchor
    updateDupeSelCount();
    await loadProjects();
    return;
  }
  // click on the project name → navigate to that project
  const goto = e.target.closest('.dupe-proj');
  if (goto) {
    activeProject = decodeURIComponent(goto.dataset.goto);
    $('dupeOverlay').classList.add('hidden');
    renderSidebar();
    loadRecords();
    return;
  }
  const btn = e.target.closest('.dupe-del');
  if (!btn) return;
  btn.disabled = true;
  const proj = decodeURIComponent(btn.dataset.p);
  const key = decodeURIComponent(btn.dataset.k);
  await msg({ type: 'deleteRecord', query: proj, key });
  const row = btn.closest('.dupe-row');
  const group = btn.closest('.dupe-group');
  row.remove();
  const left = group.querySelectorAll('.dupe-row');
  if (left.length <= 1) {
    group.remove();
    $('dupeCount').textContent = String(Math.max(0, parseInt($('dupeCount').textContent, 10) - 1));
    if (!$('dupeBody').querySelector('.dupe-group')) {
      $('dupeBody').innerHTML = '<div class="dupe-empty">🎉 No duplicates left.</div>';
    }
  }
  await loadProjects(); // refresh sidebar counts + table behind the modal
});

// ---------- batch automation modal (queue of batches) ----------
let batchPoll = null;
const bdMiddles = () => $('bd_middle').value.split(',').map((s) => s.trim()).filter(Boolean);
const bdQuery = (m) => [$('bd_prefix').value.trim(), m, $('bd_suffix').value.trim()].filter(Boolean).join(' ');
function bdPreview() {
  const ms = bdMiddles();
  $('bd_preview').innerHTML = ms.length ? `${ms.length} searches → e.g. <b>${esc(bdQuery(ms[0]))}</b>` : '';
}
function bdSave() { chrome.storage.local.set({ gridleads_batch_fields: { p: $('bd_prefix').value, s: $('bd_suffix').value } }); }
['bd_prefix', 'bd_middle', 'bd_suffix'].forEach((id) => $(id).addEventListener('input', () => { bdPreview(); bdSave(); }));

const expandedBatches = new Set(); // batch ids currently expanded (areas shown) — closed by default
let queueDragging = false;         // true while a batch is being dragged
let lastQueueSig = '';             // skip poll-rebuilds when nothing changed
let dragItemEl = null;             // the .bq-item being dragged

async function renderQueue(force) {
  if (queueDragging) return; // never rebuild mid-drag
  const st = await msg({ type: 'batchQueue' });
  const q = (st && st.queue) || [];
  const sig = JSON.stringify(q.map((b) => [b.id, b.count, b.running, b.doneInBatch, expandedBatches.has(b.id)]));
  if (!force && sig === lastQueueSig) return; // nothing visible changed
  lastQueueSig = sig;

  $('bd_count').textContent = q.length ? `(${q.length})` : '';
  if (!q.length) { $('bd_queue').innerHTML = '<div class="bq-empty">Queue is empty. Add a batch above.</div>'; return; }

  $('bd_queue').innerHTML = q.map((bt) => {
    const open = expandedBatches.has(bt.id);
    const areas = (bt.items || []).map((it, i) => {
      const done = bt.running && i < bt.doneInBatch;
      const cur = bt.running && i === bt.doneInBatch;
      return `<div class="bq-area ${done ? 'done' : ''} ${cur ? 'cur' : ''}"><span class="bq-area-num">${i + 1}.</span><span class="bq-area-name">${esc(it.a)}</span></div>`;
    }).join('');
    return `
    <div class="bq-item ${bt.running ? 'running' : ''}" data-bid="${escAttr(bt.id)}">
      <div class="bq-main" data-toggle="${escAttr(bt.id)}" ${bt.running ? '' : 'draggable="true"'}>
        ${bt.running ? '<span class="bq-grip dim">▶</span>' : '<span class="bq-grip" title="Drag to reorder">⋮⋮</span>'}
        <span class="bq-caret">${open ? '▾' : '▸'}</span>
        <div class="bq-text">
          <div class="bq-label" title="${escAttr(bt.label)}">${esc(bt.label)}</div>
          <div class="bq-sub">${bt.running ? `running ${bt.doneInBatch}/${bt.count} · ${esc(bt.currentQuery || '')}` : `${bt.count} searches · queued`}</div>
        </div>
        <span class="bq-del" data-bid="${escAttr(bt.id)}" title="Remove from queue">✕</span>
      </div>
      <div class="bq-areas ${open ? '' : 'hidden'}">${areas}</div>
    </div>`;
  }).join('');

  // expand / collapse (click the header, but not the ✕)
  $('bd_queue').querySelectorAll('.bq-main').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target.classList.contains('bq-del')) return;
      const id = m.dataset.toggle;
      if (expandedBatches.has(id)) expandedBatches.delete(id); else expandedBatches.add(id);
      renderQueue(true);
    });
  });
  // remove batch
  $('bd_queue').querySelectorAll('.bq-del').forEach((d) => {
    d.addEventListener('click', async (e) => { e.stopPropagation(); await msg({ type: 'batchRemove', id: d.dataset.bid }); renderQueue(true); });
  });
  // drag-and-drop reorder of the batches (cities) themselves
  $('bd_queue').querySelectorAll('.bq-main[draggable="true"]').forEach((m) => {
    const item = m.closest('.bq-item');
    m.addEventListener('dragstart', (e) => { dragItemEl = item; queueDragging = true; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    m.addEventListener('dragend', async () => {
      if (!dragItemEl) return;
      dragItemEl.classList.remove('dragging');
      dragItemEl = null; queueDragging = false;
      const order = [...$('bd_queue').querySelectorAll('.bq-item')].map((n) => n.dataset.bid);
      await msg({ type: 'batchReorderQueue', order });
      lastQueueSig = ''; // DOM already correct; allow future polls to reconcile
    });
  });
  // reposition while dragging over other batches (running one stays pinned on top)
  $('bd_queue').querySelectorAll('.bq-item').forEach((item) => {
    item.addEventListener('dragover', (e) => {
      if (!dragItemEl || item === dragItemEl || item.classList.contains('running')) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      $('bd_queue').insertBefore(dragItemEl, after ? item.nextSibling : item);
    });
  });
}

$('batchBtn').addEventListener('click', () => {
  $('batchOverlay').classList.remove('hidden');
  chrome.storage.local.get('gridleads_batch_fields', (o) => { const f = o.gridleads_batch_fields; if (f) { $('bd_prefix').value = f.p || ''; $('bd_suffix').value = f.s || ''; } bdPreview(); });
  lastQueueSig = ''; renderQueue(true);
  if (batchPoll) clearInterval(batchPoll);
  batchPoll = setInterval(renderQueue, 1500);
});
function closeBatch() { $('batchOverlay').classList.add('hidden'); if (batchPoll) { clearInterval(batchPoll); batchPoll = null; } }
$('batchClose').addEventListener('click', closeBatch);
$('batchOverlay').addEventListener('click', (e) => { if (e.target === $('batchOverlay')) closeBatch(); });

$('bd_add').addEventListener('click', async () => {
  const middles = bdMiddles();
  if (!middles.length) { $('bd_preview').textContent = 'Enter at least one comma-separated value.'; return; }
  const res = await msg({ type: 'batchEnqueue', prefix: $('bd_prefix').value, middles, suffix: $('bd_suffix').value });
  if (res && res.ok) { $('bd_middle').value = ''; bdPreview(); renderQueue(); }
  else if (res && res.error === 'no-tab') { alert('No Google Maps tab found — open google.com/maps in a tab first.'); }
  else { $('bd_preview').textContent = 'Could not add this batch.'; }
});
// Load many batches from a JSON file: [{ city, areas:[...] }]. You only fill the
// Prefix (e.g. "restaurants near"); each city becomes one batch, areas = searches.
$('bd_loadJson').addEventListener('click', () => $('bd_file').click());
$('bd_file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-picking the same file
  if (!file) return;
  const prefix = $('bd_prefix').value.trim();
  if (!prefix) { $('bd_preview').textContent = '⚠ Fill the Prefix first (e.g. "restaurants near").'; return; }
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { $('bd_preview').textContent = '⚠ Invalid JSON file.'; return; }
  if (!Array.isArray(data)) { $('bd_preview').textContent = '⚠ JSON must be an array of { city, areas }.'; return; }

  let batches = 0, searches = 0;
  for (const entry of data) {
    const city = (entry && (entry.city || entry.suffix) || '').trim();
    const areas = Array.isArray(entry && entry.areas) ? entry.areas : [];
    const middles = areas.map((a) => String(a || '').trim()).filter(Boolean);
    if (!city || !middles.length) continue;
    const label = `${prefix} {${middles.length} areas} ${city}`;
    const res = await msg({ type: 'batchEnqueue', prefix, middles, suffix: city, label });
    if (res && res.ok) { batches++; searches += res.count || middles.length; }
  }
  if (batches) { $('bd_preview').textContent = `⤴ Loaded ${batches} batch(es) · ${searches} searches total`; renderQueue(); }
  else { $('bd_preview').textContent = '⚠ No valid { city, areas } entries found.'; }
});

$('batchStopAll').addEventListener('click', async () => {
  if (!confirm('Stop all batches and clear the queue?')) return;
  await msg({ type: 'batchStopAll' });
  renderQueue();
});

// resizable sidebar (persisted)
(function initResizer() {
  const MIN = 200, MAX = 560;
  const saved = parseInt(localStorage.getItem('gridleads_sw') || '', 10);
  if (saved >= MIN && saved <= MAX) document.documentElement.style.setProperty('--sw', saved + 'px');
  const handle = $('resizer');
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    dragging = true; handle.classList.add('dragging'); document.body.classList.add('resizing');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(MIN, Math.min(MAX, e.clientX));
    document.documentElement.style.setProperty('--sw', w + 'px');
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; handle.classList.remove('dragging'); document.body.classList.remove('resizing');
    const cur = getComputedStyle(document.documentElement).getPropertyValue('--sw').trim();
    const px = parseInt(cur, 10);
    if (px) localStorage.setItem('gridleads_sw', String(px));
  });
})();

// live-refresh while the scraper is collecting
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[PKEY]) loadProjects();
});

loadProjects();
