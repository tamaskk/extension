'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type ActivityRow } from '@/lib/api';

const PAGE_SIZE = 100;

// filter chip → type prefixes (the part of `type` before the dot)
const GROUPS: { key: string; label: string; groups: string }[] = [
  { key: 'all', label: 'All', groups: '' },
  { key: 'leads', label: 'Leads in / changed', groups: 'leads' },
  { key: 'email', label: 'Emails', groups: 'email' },
  { key: 'edit', label: 'Manual edits', groups: 'lead' },
  { key: 'outreach', label: 'Outreach & calls', groups: 'outreach,call' },
  { key: 'org', label: 'Projects & folders', groups: 'project,folder,group,tag' },
  { key: 'other', label: 'Reviews · AI · system', groups: 'reviews,ai,system' },
];

// type → [chip colour, label]
const KIND: Record<string, [string, string]> = {
  'leads.new': ['green', 'New leads'], 'leads.change': ['amber', 'Changed'], 'leads.skip': ['gray', 'Duplicate'], 'leads.delete': ['red', 'Deleted'],
  'email.audit': ['green', 'Email audit'], 'email.found': ['green', 'Email found'], 'email.none': ['gray', 'No email'],
  'lead.edit': ['blue', 'Edit'], 'lead.note': ['blue', 'Note'], 'lead.bulk': ['blue', 'Bulk edit'],
  'outreach.draft': ['pink', 'Draft'], 'outreach.edit': ['pink', 'Draft edit'], 'outreach.sent': ['green', 'Email sent'], 'outreach.error': ['red', 'Send failed'], 'outreach.suppress': ['red', 'Suppression'], 'outreach.sender': ['blue', 'Sender'], 'outreach.sequence': ['blue', 'Sequence'], 'outreach.continue': ['green', 'Follow-ups started'], 'outreach.control': ['blue', 'Control'], 'outreach.seed': ['blue', 'Seed test'], 'outreach.offer': ['blue', 'Offer'], 'outreach.enroll': ['green', 'Enrolled'], 'outreach.step': ['green', 'Step sent'], 'outreach.unknown': ['amber', 'Unknown send'], 'outreach.bounced': ['red', 'Bounce'], 'outreach.replied': ['green', 'Reply'], 'outreach.skip': ['amber', 'Step skipped'], 'outreach.stopped': ['gray', 'Sequence stopped'],
  'call.start': ['pink', 'Call'], 'call.done': ['pink', 'Call'],
  'project.create': ['blue', 'Project'], 'project.rename': ['blue', 'Project'], 'project.move': ['blue', 'Project'], 'project.delete': ['red', 'Project'],
  'folder.create': ['blue', 'Folder'], 'folder.edit': ['blue', 'Folder'], 'folder.delete': ['red', 'Folder'],
  'group.create': ['blue', 'Group'], 'group.edit': ['blue', 'Group'], 'group.delete': ['red', 'Group'],
  'tag.edit': ['blue', 'Tag'], 'tag.delete': ['red', 'Tag'],
  'reviews.saved': ['amber', 'Reviews'], 'reviews.error': ['red', 'Reviews'], 'ai.enrich': ['amber', 'AI'],
  'system.organize': ['gray', 'System'], 'system.fix-suffix': ['gray', 'System'],
};

const RANGES: [string, string][] = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const show = (v: unknown) => (v === '' || v == null ? '∅' : Array.isArray(v) ? v.join(', ') : String(v));
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\//i.test(v);

function Val({ v }: { v: unknown }) {
  if (isUrl(v)) return <a href={v as string} target="_blank" rel="noopener noreferrer">{v as string}</a>;
  if (v && typeof v === 'object') return <span>{JSON.stringify(v)}</span>;
  return <span>{show(v)}</span>;
}

function DiffLines({ diff }: { diff: Record<string, [unknown, unknown]> }) {
  return <>{Object.entries(diff).map(([f, [a, b]]) => (
    <div key={f} className="log-diff"><span className="muted">{f}:</span> <span className="log-old">{show(a)}</span> → <span className="log-new">{show(b)}</span></div>
  ))}</>;
}

// One table for every "list of leads" payload; columns = whatever the rows carry.
function LeadTable({ leads }: { leads: Record<string, unknown>[] }) {
  const cols = ['name', 'status', 'email', 'source', 'error', 'note', 'category', 'phone', 'website', 'websiteStatus', 'in', 'project']
    .filter((c) => leads.some((l) => l[c] !== undefined && l[c] !== '' && l[c] !== null));
  return (
    <table className="log-table">
      <thead><tr>{cols.map((c) => <th key={c}>{c === 'in' ? 'already in project' : c}</th>)}</tr></thead>
      <tbody>{leads.map((l, i) => <tr key={i}>{cols.map((c) => { const v = l[c]; const none = v === undefined || v === null || v === ''; return <td key={c} className={c === 'email' && !none ? 'log-new' : ''}>{none ? '' : <Val v={v} />}</td>; })}</tr>)}</tbody>
    </table>
  );
}

function Detail({ e }: { e: ActivityRow }) {
  const d = (e.data || {}) as Record<string, any>;
  const { leads, changes, diff, ...rest } = d;
  const pairs = Object.entries(rest).filter(([, v]) => v !== '' && v != null);
  return (
    <div className="log-detail" onClick={(ev) => ev.stopPropagation()}>
      {diff && <DiffLines diff={diff} />}
      {Array.isArray(changes) && changes.map((c: any, i: number) => (
        <div key={i} className="log-change"><b>{c.name || c.key}</b><DiffLines diff={c.diff || {}} /></div>
      ))}
      {pairs.length > 0 && (
        <table className="log-kv"><tbody>{pairs.map(([k, v]) => (
          <tr key={k}><td className="muted">{k}</td><td>{Array.isArray(v) && v.length && typeof v[0] === 'object' ? <LeadTable leads={v} /> : <Val v={v} />}</td></tr>
        ))}</tbody></table>
      )}
      {Array.isArray(leads) && leads.length > 0 && <LeadTable leads={leads} />}
      <div className="muted log-meta">{new Date(e.at).toLocaleString()} · {e.type} · via {e.source || 'web'}</div>
    </div>
  );
}

// Changelog tab: the permanent record of everything that changed in the
// database — what came in, what was edited, what was sent, what was deleted.
export default function ChangelogView({ onOpenProject }: { onOpenProject?: (query: string) => void }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, { events: number; n: number }>>({});
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState('all');
  const [range, setRange] = useState('7');
  const [term, setTerm] = useState('');
  const [project, setProject] = useState('');
  const [deb, setDeb] = useState({ term: '', project: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDeb({ term: term.trim(), project: project.trim() }), 300); return () => clearTimeout(t); }, [term, project]);
  useEffect(() => { setPage(1); }, [deb, group, range]);

  const from = useMemo(() => {
    if (range === 'all') return undefined;
    const days = range === 'today' ? 0 : Number(range) - 1;
    return new Date(dayStart(new Date()).getTime() - days * 86400000).toISOString();
  }, [range, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getActivity({ groups: GROUPS.find((g) => g.key === group)?.groups, q: deb.term, project: deb.project, from, page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) { setError(r.error || 'failed to load'); return; }
        setError('');
        setRows(r.rows || []); setTotal(r.total || 0);
        if (r.summary) setSummary(r.summary);
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deb, group, from, page, reloadKey]);

  const n = (...types: string[]) => types.reduce((s, t) => s + (summary[t]?.n || 0), 0);
  const ev = (...types: string[]) => types.reduce((s, t) => s + (summary[t]?.events || 0), 0);
  const tiles: [string, string, string][] = [
    [n('leads.new').toLocaleString(), 'New leads in', 'green'],
    [n('leads.change').toLocaleString(), 'Leads changed on re-sync', 'amber'],
    [n('email.audit', 'email.found').toLocaleString(), 'Emails found', 'green'],
    [ev('lead.edit', 'lead.note', 'lead.bulk').toLocaleString(), 'Manual edits', 'blue'],
    [n('outreach.sent').toLocaleString(), 'Emails sent', 'pink'],
    [n('leads.delete').toLocaleString(), 'Leads deleted', 'red'],
  ];

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  let lastDay = '';

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🕘 Changelog</div>
        <span className="muted">{loading ? 'Loading…' : `${total.toLocaleString()} event(s)`}</span>
        <div className="spacer" />
        <div className="log-seg">
          {RANGES.map(([k, label]) => <button key={k} className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{label}</button>)}
        </div>
        <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>⟳ Refresh</button>
      </div>

      <div className="log-tiles">
        {tiles.map(([num, label, cls]) => <div key={label} className="log-tile"><div className={`log-tile-n ${cls}`}>{num}</div><div className="muted">{label}</div></div>)}
      </div>

      <div className="log-filters">
        {GROUPS.map((g) => <button key={g.key} className={`chipbtn ${group === g.key ? 'active' : ''}`} onClick={() => setGroup(g.key)}>{g.label}</button>)}
      </div>
      <div className="groups-bar">
        <input className="search" type="search" placeholder="Search anything — business, email, phone, field, value…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <input className="search" type="search" placeholder="Project contains…" value={project} onChange={(e) => setProject(e.target.value)} />
      </div>

      {error && <div className="empty" style={{ padding: 20 }}>⚠ {error}</div>}
      {!loading && !error && !rows.length && (
        <div className="empty" style={{ padding: 30 }}>
          Nothing recorded for this filter. Every change from now on is saved here permanently — leads synced from the extension,
          emails found, edits, outreach, moves and deletes. Activity from before the Changelog existed was never recorded.
        </div>
      )}

      <div className="log-list">
        {rows.map((e) => {
          const dt = new Date(e.at);
          const day = dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const head = day !== lastDay ? <div className="log-day">{day}</div> : null;
          lastDay = day;
          const [cls, label] = KIND[e.type] || ['gray', e.type];
          return (
            <div key={e.id}>
              {head}
              <div className={`log-row ${open.has(e.id) ? 'open' : ''}`} onClick={() => toggle(e.id)}>
                <span className="log-time muted">{dt.toLocaleTimeString(undefined, { hour12: false })}</span>
                <span><span className={`chip ${cls}`}>{label}</span></span>
                <span className="log-title">
                  {e.title}
                  {e.project && <span className="log-proj" title="Open this project" onClick={(ev) => { ev.stopPropagation(); if (onOpenProject) onOpenProject(e.project as string); }}>📁 {e.project}</span>}
                </span>
                <span className="muted log-caret">{open.has(e.id) ? '▾' : '▸'}</span>
                {open.has(e.id) && <Detail e={e} />}
              </div>
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div className="groups-pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Newer</button>
          <span className="muted">Page {page} / {pages.toLocaleString()}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older ›</button>
        </div>
      )}
    </div>
  );
}
