'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { CoverageMatrixData, CoverageRow } from '@/lib/api';
import { DEFAULT_COVERAGE_TYPES, missingIn, typeKey } from '@/lib/coverageMatrix.mjs';

// Coverage tab: business types across the top, the regions of one country down
// the side, and in each cell how many reference places still have no project.
// A full run of a type over a region ends at 0.

const TYPES_KEY = 'gridleads_cov_types';
const MAX_TYPES = 300;
// the extension opens at most this many windows side by side (MAX_WINDOWS in its background.js)
const MAX_WINDOWS = 8;
const KIND_LABEL: Record<CoverageRow['kind'], string> = { state: 'States', city: 'Cities and their areas', cities: 'The country and its cities' };
const KIND_ORDER: CoverageRow['kind'][] = ['state', 'city', 'cities'];

// The columns are a per-browser convenience; without storage the default list is used.
// What is stored is the operator's own list and the defaults that existed when
// it was saved (`known`). A default type added to the code later is appended; one
// the operator removed stays removed.
const COLS_KEY = 'gridleads_cov_cols';
function storedTypes(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null') as { types?: unknown; known?: unknown } | null;
    if (saved && Array.isArray(saved.types) && saved.types.length) {
      const own = saved.types.map(String);
      const seen = new Set([...own.map(typeKey), ...(Array.isArray(saved.known) ? saved.known.map(String) : [])]);
      return [...own, ...DEFAULT_COVERAGE_TYPES.filter((t) => !seen.has(typeKey(t)))].slice(0, MAX_TYPES);
    }
    // the list as it was stored before `known` existed: every default it lacks is new to it
    const old = JSON.parse(localStorage.getItem(TYPES_KEY) || 'null');
    if (!Array.isArray(old) || !old.length) return DEFAULT_COVERAGE_TYPES;
    const own = old.map(String);
    const have = new Set(own.map(typeKey));
    return [...own, ...DEFAULT_COVERAGE_TYPES.filter((t) => !have.has(typeKey(t)))].slice(0, MAX_TYPES);
  } catch {
    return DEFAULT_COVERAGE_TYPES;
  }
}
function storeTypes(list: string[] | null) {
  try {
    localStorage.removeItem(TYPES_KEY);
    if (list) localStorage.setItem(COLS_KEY, JSON.stringify({ types: list, known: DEFAULT_COVERAGE_TYPES.map(typeKey) }));
    else localStorage.removeItem(COLS_KEY);
  } catch (e) {
    console.warn('coverage: could not store the columns', e);
  }
}

// one type per line or comma; a type repeated under another spelling is dropped
function parseTypes(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
    const k = typeKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 40));
  }
  return out.slice(0, MAX_TYPES);
}

// A cell with something missing is a button: clicking it picks that run for the extension's queue.
function Cell({ missing, total, picked, onPick }: { missing: number; total: number; picked: boolean; onPick: () => void }) {
  if (missing === 0) return <span className="chip green" title={`All ${total.toLocaleString()} done`}>✓</span>;
  const started = missing !== total;
  return (
    <button className={`chip ${started ? 'amber' : 'gray'} cov-cell${picked ? ' picked' : ''}`} aria-pressed={picked} onClick={onPick}
      title={`${started ? `${(total - missing).toLocaleString()} of ${total.toLocaleString()} done` : 'Not started'}. Click to pick this run for the extension.`}>
      {missing.toLocaleString()}
    </button>
  );
}

// The extension answers through its content script on this page
// (apps/extension/content/dashboardBridge.js). No answer in time means it is
// not installed in this browser, or was reloaded after the page was opened.
type ExtAnswer = { ok: boolean; error?: string; count?: number; already?: boolean; version?: string; active?: boolean; workers?: number; running?: number; current?: string;
  queue?: { label: string; count: number; status: string; doneInBatch: number; currentQuery: string }[] };
function askExtension(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<ExtAnswer> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const done = (r: ExtAnswer) => { clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(r); };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (d && d.source === 'gridleads-extension' && d.id === id) { const { source: _source, id: _id, ...rest } = d; done({ ...rest, ok: !!d.ok }); }
    };
    const timer = setTimeout(() => done({ ok: false, error: 'no-extension' }), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'gridleads-dashboard', id, type, ...payload }, location.origin);
  });
}
const EXT_ERROR: Record<string, string> = {
  'no-extension': 'The extension did not answer. It must be installed in this browser; reload it on chrome://extensions, then reload this page.',
  'extension-reloaded': 'The extension was reloaded. Reload this page and try again.',
  'no-items': 'Nothing to queue.',
  empty: 'The queue is empty.',
  'no-window': 'The extension could not open a window or a tab. Start the queue from its popup.',
  'no-maps': 'No open Google Maps window to use. Open one in another window (not this tab), then try again.',
};

export default function CoverageMatrix() {
  const [data, setData] = useState<CoverageMatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [country, setCountry] = useState('USA');
  const [types, setTypes] = useState<string[]>(DEFAULT_COVERAGE_TYPES);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [level, setLevel] = useState<CoverageRow['kind'] | ''>('');
  const [exporting, setExporting] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  // runs picked for the extension: "<row index>|<type>"
  const [picked, setPicked] = useState<string[]>([]);
  const [prefixes, setPrefixes] = useState<Record<string, string>>({}); // typed over the suggested prefix, by type
  const [queueing, setQueueing] = useState(false);
  const [queueMsg, setQueueMsg] = useState('');
  // every step of a queue / start, with the extension's raw answers: what to read when nothing starts
  const [debug, setDebug] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  // where "Queue and start" runs the searches
  const [runIn, setRunIn] = useState<'each' | 'tab' | 'adopt'>('each');
  const note = (line: string) => setDebug((d) => [...d.slice(-199), `${new Date().toLocaleTimeString()}  ${line}`]);

  useEffect(() => { setTypes(storedTypes()); }, []);

  const load = useCallback((fresh: boolean) => {
    setLoading(true);
    api.getCoverageMatrix(fresh)
      .then((r) => { if (r.ok) { setData(r); setError(''); } else setError(r.error || 'The coverage could not be loaded.'); })
      .catch(() => setError('The coverage could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(false); }, [load]);

  const present = data?.present;
  const countries = useMemo(() => [...new Set((data?.rows || []).map((r) => r.country))].sort(), [data]);
  // the levels this country has a reference list for; states first where there are any
  const kinds = useMemo(() => KIND_ORDER.filter((k) => (data?.rows || []).some((r) => r.country === country && r.kind === k)), [data, country]);
  const kind: CoverageRow['kind'] = level && kinds.includes(level) ? level : kinds[0] || 'city';
  // each row keeps its index in the payload: that is the key into `present`
  const rows = useMemo(() => {
    if (!data?.rows || !present) return [];
    return data.rows
      .map((r, i) => ({ ...r, i, missing: types.map((t) => missingIn(present, t, i, r.total)) }))
      .filter((r) => r.country === country && r.kind === kind);
  }, [data, present, types, country, kind]);
  const shown = onlyOpen ? rows.filter((r) => r.missing.some((m) => m > 0)) : rows;
  const known = useMemo(() => new Set((data?.types || []).map((t) => t.key)), [data]);
  const sums = types.map((_, c) => rows.reduce((n, r) => n + r.missing[c], 0));
  const cells = rows.length * types.length;
  const doneCells = rows.reduce((n, r) => n + r.missing.filter((m) => m === 0).length, 0);
  const startedCells = rows.reduce((n, r) => n + r.missing.filter((m) => m > 0 && m < r.total).length, 0);
  const columnKeys = new Set(types.map(typeKey));
  const otherTypes = (data?.types || []).filter((t) => !columnKeys.has(t.key)).slice(0, 60);

  // column changes made one at a time: remove, move, add
  const [addText, setAddText] = useState('');
  const [colSearch, setColSearch] = useState('');
  const removeType = (type: string) => {
    if (types.length <= 1) return; // the table needs a column
    saveTypes(types.filter((t) => t !== type));
    setPicked((cur) => cur.filter((k) => !k.endsWith(`|${type}`)));
  };
  const moveType = (type: string, by: number) => {
    const i = types.indexOf(type); const j = i + by;
    if (i < 0 || j < 0 || j >= types.length) return;
    const next = [...types];
    [next[i], next[j]] = [next[j], next[i]];
    saveTypes(next);
  };
  const addTypes = (text: string) => {
    const have = new Set(types.map(typeKey));
    const fresh = parseTypes(text).filter((t) => !have.has(typeKey(t)));
    if (fresh.length) saveTypes([...types, ...fresh].slice(0, MAX_TYPES));
    setAddText('');
  };
  const saveTypes = (list: string[]) => {
    setTypes(list.length ? list : DEFAULT_COVERAGE_TYPES);
    storeTypes(list.length ? list : null);
  };
  // The missing places of one column, as the extension's "Load batches from JSON"
  // reads them. The type itself is not in the file: it is the Prefix typed there.
  const exportColumn = async (type: string, how: 'copy' | 'download') => {
    setExporting(type); setExportMsg('');
    try {
      const r = await api.getCoverageMissing(type, country, kind);
      if (!r.ok || !r.batches) { setExportMsg(r.error || 'The list could not be built.'); return; }
      if (!r.batches.length) { setExportMsg(`Nothing is missing for ${type}.`); return; }
      const text = JSON.stringify(r.batches, null, 2);
      const what = `${type}: ${r.batches.length.toLocaleString()} ${r.batches.length === 1 ? 'batch' : 'batches'}, ${(r.searches || 0).toLocaleString()} searches`;
      if (how === 'copy') {
        await navigator.clipboard.writeText(text);
        setExportMsg(`Copied. ${what}.`);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `missing-${typeKey(type)}-${country.toLowerCase().replace(/\s+/g, '-')}-${kind}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setExportMsg(`Downloaded. ${what}.`);
      }
    } catch {
      setExportMsg(how === 'copy' ? 'Could not copy. Use the download instead.' : 'Network error. Nothing was downloaded.');
    } finally {
      setExporting('');
    }
  };
 // the picked runs, grouped: one prefix per type
  const pickedTypes = [...new Set(picked.map((k) => k.slice(k.indexOf('|') + 1)))].filter((t) => types.includes(t));
  // The prefix a type was scraped with so far ("bars near"), from the project queries; a type never run gets its own name.
  const prefixOf = (type: string) => prefixes[type] ?? `${(data?.types || []).find((t) => t.key === typeKey(type))?.label || type} near`;
  const togglePick = (rowIndex: number, type: string) => {
    const key = `${rowIndex}|${type}`;
    setQueueMsg('');
    setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };
  // Put the missing places of every picked run into the extension's queue, one
  // batch per region and type, and start the queue when asked.
  const queueRuns = async (start: boolean) => {
    if (!data?.rows || !picked.length) return;
    setQueueing(true); setQueueMsg('');
    note(`— ${start ? 'Queue and start' : 'Queue'}: ${picked.length} run(s), ${country}, ${kind} —`);
    try {
      const ping = await askExtension('ping', {}, 3000);
      note(ping.ok ? `extension answered, version ${ping.version || '?'}` : `extension did not answer (${ping.error}); is it installed in this browser and reloaded after the update?`);
      if (!ping.ok) { setQueueMsg(EXT_ERROR['no-extension']); setShowDebug(true); return; }
      let batches = 0; let searches = 0;
      for (const type of pickedTypes) {
        const prefix = prefixOf(type).trim();
        if (!prefix) { setQueueMsg(`Type a prefix for ${type}.`); return; }
        const regions = new Set(picked.filter((k) => k.endsWith(`|${type}`)).map((k) => data.rows![Number(k.slice(0, k.indexOf('|')))]?.region));
        const r = await api.getCoverageMissing(type, country, kind);
        note(`missing places of "${type}": ${r.ok ? `${(r.batches || []).length} region(s) with something missing` : `failed: ${r.error}`}`);
        if (!r.ok || !r.batches) { setQueueMsg(r.error || 'The missing places could not be listed.'); setShowDebug(true); return; }
        for (const region of regions) if (!r.batches.some((x) => x.city === region)) note(`  ${region}: nothing missing, skipped`);
        for (const b of r.batches.filter((x) => regions.has(x.city))) {
          const res = await askExtension('batchEnqueue', { prefix, middles: b.areas, suffix: b.city, label: `${prefix} {${b.areas.length} places} ${b.city}` }, 30_000);
          note(`  enqueue "${prefix} … ${b.city}" (${b.areas.length} places, first: "${prefix} ${b.areas[0]} ${b.city}") → ${JSON.stringify(res)}`);
          if (!res.ok) { setQueueMsg(`${EXT_ERROR[res.error || ''] || 'The extension refused the batch.'}${batches ? ` ${batches} ${batches === 1 ? 'batch was' : 'batches were'} queued before that.` : ''}`); setShowDebug(true); return; }
          batches += 1; searches += res.count || b.areas.length;
        }
      }
      if (!batches) { setQueueMsg('Nothing is missing in the picked runs any more. Refresh the table.'); return; }
      const queued = `${batches.toLocaleString()} ${batches === 1 ? 'batch' : 'batches'}, ${searches.toLocaleString()} searches queued in the extension.`;
      if (!start) { setQueueMsg(`${queued} Start them from the extension popup.`); setPicked([]); return; }
      // one window per batch just queued: a window takes one batch at a time
      const windows = Math.min(MAX_WINDOWS, batches);
      const started = runIn === 'adopt' ? await askExtension('batchStartAdopt', {}, 60_000)
        : await askExtension('batchStartQueue', runIn === 'tab' ? { inTab: true } : { windows }, 60_000);
      note(`start (${runIn}${runIn === 'each' ? `, ${windows} window(s)` : ''}) → ${JSON.stringify(started)}`);
      setPicked([]);
      if (!started.ok) { setQueueMsg(`${queued} Not started: ${EXT_ERROR[started.error || ''] || 'start it from the extension popup.'}`); setShowDebug(true); return; }
      setQueueMsg(`${queued} ${started.already ? 'The queue was already running.' : 'The queue is started.'} Checking that a window is working…`);
      // The start only asks Chrome for windows. Whether one opened and took a
      // search shows a few seconds later, so look again.
      let working = false;
      for (const waitMs of [4000, 6000, 10_000]) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        const st = await askExtension('batchStatus', {}, 5000);
        note(`status → active ${st.active ? 'yes' : 'no'}, windows ${st.workers ?? 0}, running ${st.running ?? 0}${st.current ? `, now: "${st.current}"` : ''}`);
        if (st.active && (st.running || 0) > 0) { working = true; break; }
      }
      const q = await askExtension('batchQueue', {}, 5000);
      for (const item of q.queue || []) note(`  queue: [${item.status}] ${item.label} (${item.doneInBatch}/${item.count})`);
      if (working) { setQueueMsg(`${queued} The queue is running.`); return; }
      setQueueMsg(`${queued} The queue was started, but no window is working after 20 seconds. The Google Maps tab may be hidden behind another tab (Chrome pauses hidden tabs), or Chrome blocked new windows: bring the Maps tab to the front, or open the extension popup and press Start. The log below has the details.`);
      setShowDebug(true);
    } catch (e) {
      note(`error: ${e instanceof Error ? e.message : 'unknown'}`);
      setQueueMsg('Network error. Check the queue in the extension popup before trying again.');
      setShowDebug(true);
    } finally {
      setQueueing(false);
    }
  };
  const openEditor = () => { setDraft(types.join('\n')); setEditing(true); };

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🧩 Coverage</div>
        <div className="spacer" />
        <select className="select" value={country} onChange={(e) => { setCountry(e.target.value); setPicked([]); }} aria-label="Country" disabled={!countries.length}>
          {(countries.length ? countries : [country]).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={kind} onChange={(e) => { setLevel(e.target.value as CoverageRow['kind']); setPicked([]); }} aria-label="Level" disabled={kinds.length < 2}>
          {(kinds.length ? kinds : [kind]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <button className={`chipbtn ${onlyOpen ? 'active' : ''}`} onClick={() => setOnlyOpen((v) => !v)}>Only unfinished</button>
        <button className="btn" onClick={() => (editing ? setEditing(false) : openEditor())}>Columns</button>
        <button className="btn" onClick={() => load(true)} disabled={loading}>⟳ Refresh</button>
      </div>

      {editing && (
        <div className="oseq-card">
          <div className="oseq-row">
            <b>Columns</b><span className="muted">{types.length} of {MAX_TYPES}. Kept in this browser. Spaces, capitals and a plural s do not matter: &quot;hairsalon&quot; also counts &quot;hair salons&quot;.</span>
            <div className="spacer" />
            <button className="mini" onClick={() => setEditing(false)}>Close</button>
          </div>

          <form className="oseq-row" onSubmit={(e) => { e.preventDefault(); addTypes(addText); }}>
            <input className="search cov-add" value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Add a type, or several with commas" aria-label="Add a business type" />
            <button className="btn" type="submit" disabled={!addText.trim() || types.length >= MAX_TYPES}>Add</button>
            <div className="spacer" />
            <button className="mini" type="button" title="Keep only the columns that already have projects" disabled={!types.some((t) => known.has(typeKey(t)))} onClick={() => saveTypes(types.filter((t) => known.has(typeKey(t))))}>Only types with projects</button>
            <button className="mini" type="button" title="Keep only the columns where a run is started or finished in this country and level" disabled={!rows.length} onClick={() => { const keep = types.filter((_, c) => rows.some((r) => r.missing[c] < r.total)); if (keep.length) saveTypes(keep); }}>Only started in {country}</button>
            <button className="mini" type="button" onClick={() => saveTypes([])}>Back to the default list</button>
          </form>

          <div className="oseq-row">
            <input className="search cov-add" value={colSearch} onChange={(e) => setColSearch(e.target.value)} placeholder="Find a column…" aria-label="Find a column" />
            <span className="muted">✕ removes a column, ‹ › move it. A removed type can be added again above.</span>
          </div>
          <div className="cov-cols">
            {types.filter((t) => !colSearch.trim() || typeKey(t).includes(typeKey(colSearch))).map((t) => (
              <span key={t} className="cov-col">
                <button className="mini" title="Move left" aria-label={`Move ${t} left`} disabled={types.indexOf(t) === 0} onClick={() => moveType(t, -1)}>‹</button>
                <span title={known.has(typeKey(t)) ? undefined : 'No project query starts with this type yet'}>{t}{!known.has(typeKey(t)) && <span className="cov-unknown"> ?</span>}</span>
                <button className="mini" title="Move right" aria-label={`Move ${t} right`} disabled={types.indexOf(t) === types.length - 1} onClick={() => moveType(t, 1)}>›</button>
                <button className="mini danger" title="Remove this column" aria-label={`Remove ${t}`} disabled={types.length <= 1} onClick={() => removeType(t)}>✕</button>
              </span>
            ))}
          </div>

          {otherTypes.length > 0 && (
            <>
              <div className="oseq-row"><span className="muted">Types in your projects that are not columns, with their project count. Click one to add it.</span></div>
              <div className="oseq-row">
                {otherTypes.map((t) => <button key={t.key} className="mini" onClick={() => addTypes(t.label)}>+ {t.label} · {t.projects.toLocaleString()}</button>)}
              </div>
            </>
          )}

          <details>
            <summary className="muted">Edit the whole list as text (to reorder many at once, or paste a list)</summary>
            <textarea className="wp-textarea" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Business types, one per line" />
            <div className="oseq-row">
              <button className="btn" onClick={() => saveTypes(parseTypes(draft))}>Save this list</button>
              <button className="mini" onClick={() => setDraft(types.join('\n'))}>Reset to the current columns</button>
            </div>
          </details>
        </div>
      )}

      {loading && !data && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load(false)}>Try again</button></div>}
      {data && !error && (
        <>
          <div className="log-tiles">
            <div className="log-tile"><div className="log-tile-n green">{doneCells.toLocaleString()}</div>Finished runs, out of {cells.toLocaleString()} (region × type)</div>
            <div className="log-tile"><div className="log-tile-n amber">{startedCells.toLocaleString()}</div>Started, not finished</div>
            <div className="log-tile"><div className="log-tile-n">{(cells - doneCells - startedCells).toLocaleString()}</div>Not started</div>
            <div className="log-tile"><div className="log-tile-n">{sums.reduce((a, b) => a + b, 0).toLocaleString()}</div>Places still to scrape in {country}</div>
          </div>
          <div className="muted oseq-hint">
            A cell is the number of places without a project for that type. <span className="chip green">✓</span> finished · <span className="chip amber">12</span> started, 12 left · <span className="chip gray">463</span> not started.
            A place counts when a project query names it exactly as the reference list does{data.at ? `. Counted at ${new Date(data.at).toLocaleTimeString()}` : ''}.
          </div>
          <div className="muted oseq-hint">
            ⬇ and ⧉ under a column give its missing places as JSON. In the extension popup type the Prefix (for example &quot;{types[0] || 'massage'} near&quot;), then &quot;Load batches from JSON&quot;.{exportMsg && <> <b>{exportMsg}</b></>}
          </div>
          {(picked.length > 0 || queueMsg || debug.length > 0) && (
            <div className="oseq-card">
              <div className="oseq-row">
                <b>{picked.length.toLocaleString()} {picked.length === 1 ? 'run' : 'runs'} picked</b>
                <span className="muted">Their missing places go into the extension&apos;s batch queue, in this browser. The prefix is the search text in front of each place.</span>
              </div>
              {picked.length > 0 && (
                <div className="oseq-row">
                  {picked.map((k) => {
                    const row = data.rows?.[Number(k.slice(0, k.indexOf('|')))];
                    const type = k.slice(k.indexOf('|') + 1);
                    if (!row || !present) return null;
                    return (
                      <button key={k} className="chipbtn active" disabled={queueing} title="Remove from the picked runs" onClick={() => setPicked((cur) => cur.filter((x) => x !== k))}>
                        {row.region} · {type} · {missingIn(present, type, Number(k.slice(0, k.indexOf('|'))), row.total).toLocaleString()} places ✕
                      </button>
                    );
                  })}
                </div>
              )}
              {pickedTypes.length > 0 && (
                <div className="oseq-row">
                  {pickedTypes.map((t) => (
                    <label key={t} className="orep-inline">{t}
                      <input className="search cov-prefix" value={prefixOf(t)} onChange={(e) => setPrefixes((p) => ({ ...p, [t]: e.target.value }))} aria-label={`Prefix for ${t}`} />
                    </label>
                  ))}
                </div>
              )}
              <div className="oseq-row">
                <button className="btn" disabled={queueing || !picked.length} onClick={() => queueRuns(false)}>{queueing ? 'Working…' : 'Queue in the extension'}</button>
                <button className="btn primary" disabled={queueing || !picked.length} onClick={() => queueRuns(true)}>Queue and start</button>
                <select className="select" value={runIn} onChange={(e) => setRunIn(e.target.value as 'each' | 'tab' | 'adopt')} aria-label="Where the searches run" disabled={queueing}>
                  <option value="each">each batch in its own window{picked.length ? ` (${Math.min(MAX_WINDOWS, picked.length)})` : ''}</option>
                  <option value="tab">in a tab of this window (one at a time)</option>
                  <option value="adopt">in my open Google Maps windows</option>
                </select>
                <button className="mini" disabled={queueing || !picked.length} onClick={() => { setPicked([]); setQueueMsg(''); }}>Clear</button>
                <div className="spacer" />
                <button className="mini" onClick={() => setShowDebug((v) => !v)}>{showDebug ? 'Hide the log' : `Show the log${debug.length ? ` (${debug.length})` : ''}`}</button>
              </div>
              {runIn === 'each' && picked.length > 0 && <div className="muted oseq-hint">Every picked run gets its own window of this browser and they work side by side{picked.length > MAX_WINDOWS ? `; ${MAX_WINDOWS} at a time, the rest follow as windows get free` : ''}. A window closes when its run is done. Keep the windows visible: Chrome pauses one that is minimised or covered completely.</div>}
              {runIn === 'tab' && picked.length > 0 && <div className="muted oseq-hint">A Google Maps tab opens in this window, or one already open is used, and comes to the front. It scrapes while it is the tab you see: Chrome pauses a hidden tab. To keep working here, drag that tab out into its own window.</div>}
              {queueMsg && <div className="oseq-note">{queueMsg}</div>}
              {showDebug && (
                <>
                  <div className="oseq-row">
                    <span className="muted">Every step and the extension&apos;s answers. For more, open chrome://extensions → GridLeads → &quot;service worker&quot; and read its console.</span>
                    <div className="spacer" />
                    <button className="mini" disabled={!debug.length} onClick={() => navigator.clipboard.writeText(debug.join('\n')).catch(() => setQueueMsg('Could not copy the log. Select it and copy by hand.'))}>Copy</button>
                    <button className="mini" disabled={!debug.length} onClick={() => setDebug([])}>Clear the log</button>
                  </div>
                  <pre className="wp-text cov-log">{debug.length ? debug.join('\n') : 'Nothing logged yet. Queue a run.'}</pre>
                </>
              )}
            </div>
          )}
          {!rows.length && <div className="empty">No reference list for {country}.</div>}
          {rows.length > 0 && !shown.length && <div className="empty">Every region of {country} is finished for these types.</div>}
          {shown.length > 0 && (
            <div className="tablewrap cov-wrap">
              <table className="cov-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Places</th>
                    {types.map((t) => (
                      <th key={t} title={known.has(typeKey(t)) ? undefined : 'No project query starts with this type. Check the spelling under Columns.'}>
                        {t}{!known.has(typeKey(t)) && <span className="cov-unknown"> ?</span>}
                        <button className="cov-x" title={`Remove the column ${t}`} aria-label={`Remove the column ${t}`} disabled={types.length <= 1} onClick={() => removeType(t)}>✕</button>
                      </th>
                    ))}
                  </tr>
                  <tr className="cov-sum">
                    <th>All of {country}</th>
                    <th>{rows.reduce((n, r) => n + r.total, 0).toLocaleString()}</th>
                    {sums.map((n, c) => (
                      <th key={types[c]}>
                        {n.toLocaleString()}
                        <div className="cov-export">
                          <button className="mini" title={`Download the missing places of ${types[c]} as JSON for the extension`} aria-label={`Download the missing places of ${types[c]}`} disabled={!n || !!exporting} onClick={() => exportColumn(types[c], 'download')}>{exporting === types[c] ? '…' : '⬇'}</button>
                          <button className="mini" title={`Copy the missing places of ${types[c]} as JSON`} aria-label={`Copy the missing places of ${types[c]}`} disabled={!n || !!exporting} onClick={() => exportColumn(types[c], 'copy')}>⧉</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={`${r.kind}:${r.region}`}>
                      <th>{r.region}</th>
                      <td className="muted">{r.total.toLocaleString()}</td>
                      {r.missing.map((m, c) => <td key={types[c]}><Cell missing={m} total={r.total} picked={picked.includes(`${r.i}|${types[c]}`)} onPick={() => togglePick(r.i, types[c])} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
