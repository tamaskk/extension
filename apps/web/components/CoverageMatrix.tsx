'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { CoverageMatrixData, CoverageRow } from '@/lib/api';
import { DEFAULT_COVERAGE_TYPES, missingIn, typeKey } from '@/lib/coverageMatrix.mjs';

// Coverage tab: business types across the top, the regions of one country down
// the side, and in each cell how many reference places still have no project.
// A full run of a type over a region ends at 0.

const TYPES_KEY = 'gridleads_cov_types';
const MAX_TYPES = 30;
const KIND_LABEL: Record<CoverageRow['kind'], string> = { state: 'States', city: 'Cities and their areas', cities: 'The country and its cities' };
const KIND_ORDER: CoverageRow['kind'][] = ['state', 'city', 'cities'];

// The columns are a per-browser convenience; without storage the default list is used.
function storedTypes(): string[] {
  try {
    const raw = localStorage.getItem(TYPES_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) && list.length ? list.map(String).slice(0, MAX_TYPES) : DEFAULT_COVERAGE_TYPES;
  } catch {
    return DEFAULT_COVERAGE_TYPES;
  }
}
function storeTypes(list: string[] | null) {
  try {
    if (list) localStorage.setItem(TYPES_KEY, JSON.stringify(list));
    else localStorage.removeItem(TYPES_KEY);
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

function Cell({ missing, total }: { missing: number; total: number }) {
  if (missing === 0) return <span className="chip green" title={`All ${total.toLocaleString()} done`}>✓</span>;
  if (missing === total) return <span className="chip gray" title="Not started">{missing.toLocaleString()}</span>;
  return <span className="chip amber" title={`${(total - missing).toLocaleString()} of ${total.toLocaleString()} done`}>{missing.toLocaleString()}</span>;
}

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
  const openEditor = () => { setDraft(types.join('\n')); setEditing(true); };

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🧩 Coverage</div>
        <div className="spacer" />
        <select className="select" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" disabled={!countries.length}>
          {(countries.length ? countries : [country]).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={kind} onChange={(e) => setLevel(e.target.value as CoverageRow['kind'])} aria-label="Level" disabled={kinds.length < 2}>
          {(kinds.length ? kinds : [kind]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <button className={`chipbtn ${onlyOpen ? 'active' : ''}`} onClick={() => setOnlyOpen((v) => !v)}>Only unfinished</button>
        <button className="btn" onClick={() => (editing ? setEditing(false) : openEditor())}>Columns</button>
        <button className="btn" onClick={() => load(true)} disabled={loading}>⟳ Refresh</button>
      </div>

      {editing && (
        <div className="oseq-card">
          <div className="oseq-row"><b>Business types</b><span className="muted">One per line, up to {MAX_TYPES}. Spaces, capitals and a plural s do not matter: &quot;hairsalon&quot; also counts &quot;hair salons&quot;. Kept in this browser.</span></div>
          <textarea className="wp-textarea" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Business types" />
          <div className="oseq-row">
            <button className="btn" onClick={() => { saveTypes(parseTypes(draft)); setEditing(false); }}>Save columns</button>
            <button className="mini" onClick={() => { saveTypes([]); setEditing(false); }}>Back to the default list</button>
            <button className="mini" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {otherTypes.length > 0 && (
            <>
              <div className="oseq-row"><span className="muted">Other types in your projects, with their project count. Click one to add it.</span></div>
              <div className="oseq-row">
                {otherTypes.map((t) => <button key={t.key} className="mini" onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${t.label}` : t.label))}>{t.label} · {t.projects.toLocaleString()}</button>)}
              </div>
            </>
          )}
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
          {!rows.length && <div className="empty">No reference list for {country}.</div>}
          {rows.length > 0 && !shown.length && <div className="empty">Every region of {country} is finished for these types.</div>}
          {shown.length > 0 && (
            <div className="tablewrap cov-wrap">
              <table className="cov-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Places</th>
                    {types.map((t) => <th key={t} title={known.has(typeKey(t)) ? undefined : 'No project query starts with this type. Check the spelling under Columns.'}>{t}{!known.has(typeKey(t)) && <span className="cov-unknown"> ?</span>}</th>)}
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
                      {r.missing.map((m, c) => <td key={types[c]}><Cell missing={m} total={r.total} /></td>)}
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
